// 前端状态：只保存服务端按权限过滤后的数据；所有汇总值都来自服务端。
import { get, request, ApiError } from './api.js';

const listeners = new Set();
export const store = {
  ready: false, me: null, access: null, settings: null, today: '', seq: 0, lastSeenSeq: 0, lastSeenAt: null, onboarded: true,
  mode: 'formal', availableModes: [], demo: false, demoLive: false, people: new Map(), departments: [], goals: new Map(), kids: new Map(),
  online: 0, live: 'connecting', version: 0, recent: new Map(), feed: [], cheers: new Map(), cheersReceived: [], migration: null, directoryInitialization: null
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(kind = 'data') { store.version++; for (const fn of listeners) fn(kind); }

function index() {
  const kids = new Map();
  for (const goal of store.goals.values()) {
    if (!goal.parentId) continue;
    if (!kids.has(goal.parentId)) kids.set(goal.parentId, []);
    kids.get(goal.parentId).push(goal);
  }
  for (const list of kids.values()) list.sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
  store.kids = kids;
}

export function load(data) {
  Object.assign(store, {
    ready: true, me: data.me, access: data.access, settings: data.settings, today: data.today, seq: data.seq,
    lastSeenSeq: data.lastSeenSeq, lastSeenAt: data.lastSeenAt, onboarded: data.onboarded, mode: data.mode, availableModes: data.availableModes || [], demo: data.demo, demoLive: data.demoLive,
    cheersReceived: data.cheersReceived || [], migration: data.migration || null, directoryInitialization: data.directoryInitialization || null
  });
  store.people = new Map(data.people.map(person => [person.id, person]));
  store.departments = data.departments;
  store.goals = new Map(data.goals.map(goal => [goal.id, goal]));
  index();
  changed('load');
}

export async function reload() {
  const { data } = await get('/api/bootstrap');
  load(data);
}

// 合并增量：变化过的目标会被标记 3 秒，用于“呼吸”高亮
export function applyDelta(delta) {
  if (!delta) return;
  if (delta.reload) return reload();
  if (delta.seq <= store.seq && !delta.goals?.length) return;
  const at = Date.now();
  const affectedParents = new Set();
  store.goals = new Map(store.goals);
  for (const goal of delta.goals || []) {
    const previous = store.goals.get(goal.id);
    if (previous?.parentId) affectedParents.add(previous.parentId);
    if (goal.parentId) affectedParents.add(goal.parentId);
    store.goals.set(goal.id, goal);
    if (!previous || previous.stat?.value !== goal.stat?.value || previous.stat?.status !== goal.stat?.status || previous.title !== goal.title || previous.doneAt !== goal.doneAt) store.recent.set(goal.id, at);
  }
  for (const id of delta.removed || []) {
    const previous = store.goals.get(id);
    if (previous?.parentId) affectedParents.add(previous.parentId);
    store.goals.delete(id);
  }
  store.seq = Math.max(store.seq, delta.seq);
  if (delta.events?.length) {
    const known = new Set(store.feed.map(event => event.seq));
    const fresh = delta.events.filter(event => !known.has(event.seq)).map(event => ({ ...event, fresh: at }));
    store.feed = [...fresh, ...store.feed].sort((a, b) => b.seq - a.seq).slice(0, 300);
    store.lastEvents = fresh;
  } else store.lastEvents = [];
  const kids = new Map(store.kids);
  for (const parentId of affectedParents) {
    const list = [...store.goals.values()].filter(goal => goal.parentId === parentId);
    list.sort((a,b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
    if (list.length) kids.set(parentId,list); else kids.delete(parentId);
  }
  store.kids = kids;
  changed('delta');
}

let syncing = null, pending = false;
export async function sync() {
  if (syncing) { pending = true; return syncing; }
  syncing = (async () => {
    try { applyDelta(await get('/api/delta?since=' + store.seq)); }
    catch (error) { if (error.status === 401) location.reload(); }
    finally { syncing = null; if (pending) { pending = false; sync(); } }
  })();
  return syncing;
}

// 写操作：带上当前游标，服务端在同一个响应里返回增量，界面立刻更新
export async function mutate(method, url, body) {
  try {
    const response = await request(method, url, body, { since: store.seq });
    if (response.delta) await applyDelta(response.delta);
    return response.result;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) await sync();
    throw error;
  }
}

export function setLive(state) { if (store.live !== state) { store.live = state; changed('live'); } }
export function setOnline(count) { if (store.online !== count) { store.online = count; changed('live'); } }
export function touchFeed(seq, patch) {
  const item = store.feed.find(event => event.seq === seq);
  if (item) { Object.assign(item, patch); changed('feed'); }
}
// 点赞状态单独保存：动态页、目标页、首页共用同一份数字
export function setCheer(seq, patch) {
  store.cheers.set(seq, { ...(store.cheers.get(seq) || {}), ...patch });
  changed('feed');
}
export function markOnboarded() { store.onboarded = true; changed('data'); }
export function markSeen(seq) { store.lastSeenSeq = seq; }

// ---------- 读取辅助 ----------
export const goal = id => store.goals.get(id);
export const children = id => store.kids.get(id) || [];
export const person = id => store.people.get(id) || { id, name: '未知成员', dept: '', title: '', active: false };
export function ancestors(g) {
  const list = [];
  let cursor = g?.parentId ? store.goals.get(g.parentId) : null;
  while (cursor) { list.unshift(cursor); cursor = cursor.parentId ? store.goals.get(cursor.parentId) : null; }
  return list;
}
export function rootOf(g) { return ancestors(g)[0] || g; }
export function isMine(g) { return g.ownerId === store.me.id; }
export function isMember(g) { return g.memberIds.includes(store.me.id); }
export const isAdmin = () => store.access?.role === 'admin';
export const isLead = () => store.access?.role === 'lead' || store.access?.role === 'admin';
export function teamSet() { return new Set(store.access.teamIds); }
export function departmentName(id) { return id === null || id === undefined ? '公司直属' : store.departments.find(d => d.id === id)?.name || '未分配部门'; }
export function isRecent(id, ms = 4000) { const at = store.recent.get(id); return at && Date.now() - at < ms; }

export const hasCapability = value => store.access?.capabilities?.includes(value) || false;
export const canManageSettings = () => hasCapability('members.manage');

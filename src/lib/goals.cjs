'use strict';

// 目标领域：一棵可以一直往下拆的目标树。
// 公司目标、部门目标、个人份额、关键动作、自主目标都是 goal；每个 goal 有一个负责人和若干协作者。
// 汇总、可见范围和权限全部在服务端计算，前端只做展示。
const crypto = require('node:crypto');
const MAX_DEPTH = 6;
const DEFAULT_SETTINGS = {
  openness: 'path',
  staleDays: 7,
  healthLine: 0.05,
  watchLine: 0.15
};
const SIGNALS = new Set(['ok', 'watch', 'help']);
const DAY = 86400000;
const dayNum = s => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / DAY;
const round4 = v => Math.round(v * 10000) / 10000;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const monthRange = period => {
  const [y, m] = period.split('-').map(Number);
  return [`${period}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
};
function createGoalDomain(ctx) {
  const {
    db,
    RequestError,
    requireCondition,
    now,
    today,
    readMeta,
    writeMeta,
    allUsers,
    allDepartments,
    userById
  } = ctx;
  const fail = (status, message) => {
    throw new RequestError(status, message);
  };

  // ---------- 设置 ----------
  function settings() {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(readMeta('settings') || '{}')
    };
  }
  async function saveSettings(user, body) {
    requireCondition(user.role === 'owner', '只有公司负责人可以调整规则。', 403);
    const next = settings();
    if (body.openness !== undefined) {
      requireCondition(['path', 'open'].includes(body.openness), '可见范围设置无效。');
      next.openness = body.openness;
    }
    if (body.staleDays !== undefined) {
      requireCondition(Number.isInteger(body.staleDays) && body.staleDays >= 3 && body.staleDays <= 30, '多久没更新算“很久”，请填 3 到 30 天。');
      next.staleDays = body.staleDays;
    }
    for (const key of ['healthLine', 'watchLine']) if (body[key] !== undefined) {
      requireCondition(typeof body[key] === 'number' && body[key] >= 0 && body[key] <= 0.5, '节奏阈值需要在 0 到 50 个点之间。');
      next[key] = body[key];
    }
    requireCondition(next.watchLine >= next.healthLine, '“落后”阈值需要大于或等于“稍慢”阈值。');
    await writeMeta('settings', JSON.stringify(next));
    return emit(user.id, 'settings.changed', null, null, {});
  }

  // ---------- 事件与游标 ----------
  async function emit(actorId, type, goalId, refId, payload = {}) {
    const result = await db.run('INSERT INTO events(created_at,actor_id,type,goal_id,ref_id,payload) VALUES (?,?,?,?,?,?)', now(), actorId ?? null, type, goalId ?? null, refId ?? null, JSON.stringify(payload));
    const seq = Number(result.id);
    db.context().seq = seq;
    db.context().eventTypes.add(type);
    return seq;
  }
  const currentSeq = () => db.context().seq;
  async function touch(ids, seq) {
    const unique = [...new Set(ids)];
    if (unique.length) await db.run('UPDATE goals SET seq=? WHERE id=ANY(?::text[])', seq, unique);
    for (const id of unique) db.context().dirty.add(id);
  }

  // ---------- 读模型（按游标缓存） ----------
  let sharedCache = null;
  function model() {
    return db.context().model;
  }
  async function prepareModel() {
    const context = db.context();
    const key = currentSeq() + '|' + today();
    if (context.model && context.model.key === key) return context.model;
    if ((!context.write || context.eventTypes.size === 0) && sharedCache?.key === key) return context.model = sharedCache;
    const rows = await db.many('SELECT * FROM goals');
    const goals = new Map(rows.map(row => [row.id, {
      ...row,
      orgIds: JSON.parse(row.org_ids || '[]'),
      members: []
    }]));
    for (const member of await db.many('SELECT goal_id,user_id FROM goal_members ORDER BY added_at')) goals.get(member.goal_id)?.members.push(member.user_id);
    const kids = new Map();
    for (const goal of goals.values()) if (goal.parent_id && !goal.archived_at) {
      if (!kids.has(goal.parent_id)) kids.set(goal.parent_id, []);
      kids.get(goal.parent_id).push(goal);
    }
    for (const list of kids.values()) list.sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
    const t = today();
    const previous = context.model || context.previousModel || sharedCache;
    const incremental = previous && previous.day === t && context.dirty.size && [...context.eventTypes].every(type => ['checkin.created','checkin.voided','checkin.restored','goal.achieved'].includes(type));
    const changed = incremental ? [...context.dirty] : null;
    const agg = incremental ? new Map(previous.agg) : new Map();
    if (changed) for(const id of changed) agg.delete(id);
    for (const row of await db.many(`SELECT goal_id, SUM(CASE WHEN value IS NOT NULL AND date<=? THEN value ELSE 0 END) AS own,
        MAX(CASE WHEN (value IS NOT NULL OR signal IS NOT NULL) AND date<=? THEN date END) AS last_date,
        SUM(CASE WHEN value IS NOT NULL OR signal IS NOT NULL THEN 1 ELSE 0 END) AS updates
        FROM checkins WHERE voided_at IS NULL ${changed ? 'AND goal_id=ANY(?::text[])' : ''} GROUP BY goal_id`, t, t, ...(changed ? [changed] : []))) agg.set(row.goal_id, row);
    const signals = incremental ? new Map(previous.signals) : new Map();
    if(changed)for(const id of changed)signals.delete(id);
    for (const row of await db.many(`SELECT DISTINCT ON (goal_id) goal_id,signal FROM checkins WHERE voided_at IS NULL AND signal IS NOT NULL AND date<=? ${changed ? 'AND goal_id=ANY(?::text[])' : ''} ORDER BY goal_id,created_at DESC,ordinal DESC`,t,...(changed?[changed]:[]))) signals.set(row.goal_id,row.signal);
    const config = settings();
    const stats = incremental ? new Map(previous.stats) : new Map();
    if(changed)for(const id of changed)stats.delete(id);
    const T = dayNum(t);
    const visit = goal => {
      if (stats.has(goal.id)) return stats.get(goal.id);
      const children = kids.get(goal.id) || [];
      const childStats = children.map(visit);
      const a = agg.get(goal.id) || {
        own: 0,
        last_date: null,
        updates: 0
      };
      const S = dayNum(goal.start_date),
        E = dayNum(goal.end_date);
      const timeProgress = T < S ? 0 : T > E ? 1 : (T - S + 1) / (E - S + 1);
      let value = null,
        completion = null,
        assigned = null,
        gap = null;
      if (goal.kind === 'measure') {
        value = Number(a.own) || 0;
        assigned = 0;
        children.forEach((child, index) => {
          if (child.kind === 'measure' && child.unit === goal.unit) {
            value += childStats[index].value;
            assigned += child.target || 0;
          }
        });
        value = round4(value);
        assigned = round4(assigned);
        completion = goal.target > 0 ? value / goal.target : null;
        gap = round4((goal.target || 0) - assigned);
      } else if (children.length) {
        completion = childStats.reduce((sum, s) => sum + Math.min(1, s.completion ?? 0), 0) / children.length;
      } else completion = goal.done_at ? 1 : 0;
      const since = Math.max(S, isDate(String(goal.created_at).slice(0, 10)) ? dayNum(goal.created_at.slice(0, 10)) : S);
      let status;
      const done = Boolean(goal.done_at) || goal.kind === 'measure' && goal.target > 0 && value >= goal.target - 1e-9 || goal.kind === 'action' && children.length > 0 && completion >= 1 - 1e-9;
      if (done) status = 'done';else if (T < S) status = 'upcoming';else if (goal.kind === 'measure' && !(goal.target > 0)) status = 'neutral';else if (goal.kind === 'action' && !children.length) status = T > E ? 'risk' : E - T <= 2 ? 'watch' : 'ok';else {
        const deviation = completion - timeProgress;
        status = deviation >= -config.healthLine - 1e-9 ? 'ok' : deviation >= -config.watchLine - 1e-9 ? 'watch' : 'risk';
        // 观察期：目标开始（或创建）的头 3 天不判定落后，给大家起步的时间
        if (!children.length && T - since < 3 && status !== 'ok') status = 'ok';
      }
      const signal = signals.get(goal.id) || null;
      const lastDate = [a.last_date, ...childStats.map(s => s.lastDate)].filter(Boolean).sort().pop() || null;
      const ownLast = a.last_date || null;
      const active = !['done', 'upcoming'].includes(status) && !(goal.kind === 'measure' && !(goal.target > 0));
      const stale = !children.length && active && T - since >= config.staleDays && (!ownLast || T - dayNum(ownLast) > config.staleDays);
      const leaf = {
        total: 0,
        risk: 0,
        watch: 0,
        done: 0,
        help: 0,
        stale: 0
      };
      if (!children.length) {
        leaf.total = 1;
        if (status === 'risk') leaf.risk = 1;
        if (status === 'watch') leaf.watch = 1;
        if (status === 'done') leaf.done = 1;
        if (signal === 'help' && status !== 'done') leaf.help = 1;
        if (stale) leaf.stale = 1;
      } else for (const s of childStats) for (const k of Object.keys(leaf)) leaf[k] += s.leaf[k];
      if (children.length && signal === 'help' && status !== 'done') leaf.help += 1;
      const people = new Set([goal.owner_id, ...goal.members]);
      for (const s of childStats) for (const id of s.people) people.add(id);
      const stat = {
        value,
        target: goal.kind === 'measure' ? goal.target : null,
        completion: completion === null ? null : round4(completion),
        timeProgress: round4(timeProgress),
        deviation: completion === null ? null : round4(completion - timeProgress),
        status,
        signal,
        stale,
        assigned,
        gap,
        childCount: children.length,
        leaf,
        lastDate,
        ownLast,
        updates: Number(a.updates) || 0,
        daysLeft: Math.max(0, E - T),
        people
      };
      stats.set(goal.id, stat);
      return stat;
    };
    for (const goal of goals.values()) if (!goal.archived_at) visit(goal);
    context.model = {
      key,
      day: t, agg, signals,
      goals,
      kids,
      stats,
      settings: config,
      visibility: new Map(),
      teams: new Map()
    };
    if (!context.write) sharedCache = context.model;
    return context.model;
  }
  function ancestors(m, goal) {
    const list = [];
    let cursor = goal.parent_id ? m.goals.get(goal.parent_id) : null;
    while (cursor) {
      list.push(cursor);
      cursor = cursor.parent_id ? m.goals.get(cursor.parent_id) : null;
    }
    return list;
  }
  function descendants(m, goal, out = []) {
    for (const child of m.kids.get(goal.id) || []) {
      out.push(child);
      descendants(m, child, out);
    }
    return out;
  }
  const depthOf = (m, goal) => ancestors(m, goal).length + 1;
  const rootOf = (m, goal) => ancestors(m, goal).pop() || goal;

  // ---------- 组织关系：团队 = 汇报线下属 ∪ 所负责部门（含下级）成员 ----------
  function teamOf(userId) {
    const m = model();
    if (m.teams.has(userId)) return m.teams.get(userId);
    const users = allUsers();
    const reports = new Map();
    for (const u of users) if (u.manager_id) {
      if (!reports.has(u.manager_id)) reports.set(u.manager_id, []);
      reports.get(u.manager_id).push(u.id);
    }
    const team = new Set();
    const queue = [...(reports.get(userId) || [])];
    while (queue.length) {
      const id = queue.shift();
      if (id === userId || team.has(id)) continue;
      team.add(id);
      queue.push(...(reports.get(id) || []));
    }
    const departments = allDepartments();
    const managed = departments.filter(d => d.manager_id === userId).map(d => d.id);
    const deptIds = new Set(managed);
    for (let grown = true; grown;) {
      grown = false;
      for (const d of departments) if (d.parent_id && deptIds.has(d.parent_id) && !deptIds.has(d.id)) {
        deptIds.add(d.id);
        grown = true;
      }
    }
    for (const u of users) if (u.id !== userId && deptIds.has(u.department_id)) team.add(u.id);
    const active = new Set(users.filter(u => u.active).map(u => u.id));
    const result = {
      team,
      managedDepartmentIds: managed,
      directReports: (reports.get(userId) || []).filter(id => active.has(id)),
      activeTeam: [...team].filter(id => active.has(id)).length
    };
    m.teams.set(userId, result);
    return result;
  }
  function roleOf(user) {
    return user.role === 'owner' ? 'admin' : teamOf(user.id).activeTeam ? 'lead' : 'member';
  }

  // ---------- 可见范围 ----------
  function visibility(user) {
    const m = model();
    if (m.visibility.has(user.id)) return m.visibility.get(user.id);
    const {
      team
    } = teamOf(user.id);
    const visible = new Map(); // id -> 'own' | 'context'
    if (user.role === 'owner') {
      for (const goal of m.goals.values()) if (!goal.archived_at) visible.set(goal.id, 'own');
    } else {
      const involved = id => id === user.id || team.has(id);
      const seeds = [...m.goals.values()].filter(goal => !goal.archived_at && (involved(goal.owner_id) || goal.members.some(involved)));
      for (const seed of seeds) {
        visible.set(seed.id, 'own');
        for (const d of descendants(m, seed)) visible.set(d.id, 'own');
      }
      if (m.settings.openness === 'open') for (const goal of m.goals.values()) if (!goal.archived_at && goal.scope === 'company' && !visible.has(goal.id)) visible.set(goal.id, 'own');
      for (const id of [...visible.keys()]) for (const a of ancestors(m, m.goals.get(id))) if (!visible.has(a.id)) visible.set(a.id, 'context');
    }
    const result = {
      visible,
      team
    };
    m.visibility.set(user.id, result);
    return result;
  }
  function canSee(user, goal) {
    return visibility(user).visible.has(goal.id);
  }

  // ---------- 权限 ----------
  function isLinked(user, goal) {
    return goal.owner_id === user.id || goal.members.includes(user.id);
  }
  function canManage(user, goal, m = model()) {
    if (user.role === 'owner') return true;
    if (ancestors(m, goal).some(a => a.owner_id === user.id)) return true;
    return teamOf(user.id).team.has(goal.owner_id);
  }
  function canEditCore(user, goal, m = model()) {
    if (goal.scope === 'company' && !goal.parent_id) return user.role === 'owner';
    return canManage(user, goal, m) || goal.created_by === user.id || goal.scope === 'personal' && !goal.parent_id && goal.owner_id === user.id;
  }
  function canEditMeta(user, goal, m = model()) {
    return canEditCore(user, goal, m) || goal.owner_id === user.id;
  }
  function canAddChild(user, goal, m = model()) {
    return isLinked(user, goal) || canManage(user, goal, m);
  }
  function permsFor(user, goal, m) {
    return {
      edit: canEditMeta(user, goal, m),
      core: canEditCore(user, goal, m),
      child: canAddChild(user, goal, m) && depthOf(m, goal) < MAX_DEPTH,
      checkin: isLinked(user, goal),
      archive: canEditCore(user, goal, m),
      join: goal.scope === 'company' && goal.owner_id !== user.id
    };
  }

  // ---------- 序列化 ----------
  function publicGoal(user, goal, m, mode) {
    const stat = m.stats.get(goal.id);
    const visibleChildren = (m.kids.get(goal.id) || []).filter(child => canSee(user, child)).length;
    return {
      id: goal.id,
      parentId: goal.parent_id,
      scope: goal.scope,
      kind: goal.kind,
      title: goal.title,
      note: goal.note,
      unit: goal.unit,
      target: goal.target,
      startDate: goal.start_date,
      endDate: goal.end_date,
      ownerId: goal.owner_id,
      memberIds: goal.members,
      orgIds: goal.orgIds,
      alignId: goal.align_id,
      createdBy: goal.created_by,
      createdAt: goal.created_at,
      updatedAt: goal.updated_at,
      version: goal.version,
      doneAt: goal.done_at,
      sort: goal.sort,
      seq: goal.seq,
      context: mode === 'context',
      hiddenChildren: Math.max(0, (stat?.childCount || 0) - visibleChildren),
      stat: stat ? {
        ...stat,
        people: stat.people.size
      } : null,
      perms: permsFor(user, goal, m)
    };
  }
  function visibleGoals(user) {
    const m = model();
    const {
      visible
    } = visibility(user);
    return [...visible.entries()].map(([id, mode]) => publicGoal(user, m.goals.get(id), m, mode));
  }
  function publicEvent(user, row, cheerCounts, mine) {
    const payload = JSON.parse(row.payload || '{}');
    return {
      seq: row.seq,
      at: row.created_at,
      actorId: row.actor_id,
      type: row.type,
      goalId: row.goal_id,
      refId: row.ref_id,
      data: payload,
      cheers: cheerCounts.get(row.seq) || 0,
      cheered: mine.has(row.seq)
    };
  }
  const FEED_TYPES = ['goal.created', 'goal.split', 'goal.updated', 'goal.archived', 'goal.restored', 'goal.done', 'goal.reopened', 'goal.achieved', 'checkin.created', 'member.joined', 'member.added'];
  async function eventsFor(user, {
    before = null,
    after = null,
    limit = 30,
    goalId = null,
    subtree = false,
    filter = 'all',
    personId = null
  } = {}) {
    const m = model();
    const {
      visible,
      team
    } = visibility(user);
    let goalSet = null;
    if (goalId) {
      const goal = m.goals.get(goalId);
      requireCondition(goal && visible.has(goalId), '目标不存在或没有查看权限。', 404);
      goalSet = new Set([goalId, ...(subtree ? descendants(m, goal).map(g => g.id) : [])]);
    }
    const allowed = [...visible.keys()].filter(id => !goalSet || goalSet.has(id));
    if (!allowed.length) return { items: [], next: null };
    const clauses = ['type=ANY(?::text[])','goal_id=ANY(?::text[])'];
    const params = [FEED_TYPES,allowed];
    if(before){clauses.push('seq<?');params.push(Number(before));}
    if(after){clauses.push('seq>?');params.push(Number(after));}
    const ownerFor = id => '(actor_id=? OR goal_id IN (SELECT id FROM goals WHERE owner_id=?) OR payload->\'ownerIds\' @> ?::jsonb)';
    if(filter==='mine'){clauses.push('(actor_id=? OR goal_id IN (SELECT id FROM goals WHERE owner_id=?) OR goal_id IN (SELECT goal_id FROM goal_members WHERE user_id=?) OR payload->\'ownerIds\' @> ?::jsonb)');params.push(user.id,user.id,user.id,JSON.stringify([user.id]));}
    if(filter==='team'){clauses.push('(actor_id=ANY(?::integer[]) OR goal_id IN (SELECT id FROM goals WHERE owner_id=ANY(?::integer[])))');params.push([...team],[...team]);}
    if(filter==='help'){clauses.push("type='checkin.created' AND payload->>'signal'=ANY(?::text[])");params.push(['help','watch']);}
    if(filter==='new'){clauses.push('type=ANY(?::text[])');params.push(['goal.created','goal.split']);}
    if(personId){clauses.push(ownerFor(personId));params.push(personId,personId,JSON.stringify([personId]));}
    const want = Math.min(100,Math.max(1,Number(limit)||30));
    const out = await db.many(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`,...params,want);
    const cursor = out.at(-1)?.seq || null;
    const seqs = out.map(row => row.seq);
    const cheerCounts = new Map(),
      mine = new Set();
    if (seqs.length) {
      const marks = seqs.map(() => '?').join(',');
      for (const row of await db.many(`SELECT event_seq, COUNT(*) AS n FROM cheers WHERE event_seq IN (${marks}) GROUP BY event_seq`, ...seqs)) cheerCounts.set(row.event_seq, row.n);
      for (const row of await db.many(`SELECT event_seq FROM cheers WHERE user_id=? AND event_seq IN (${marks})`, user.id, ...seqs)) mine.add(row.event_seq);
    }
    return {
      items: out.map(row => publicEvent(user, row, cheerCounts, mine)),
      next: out.length >= want ? cursor : null
    };
  }

  // ---------- 引导、来访 ----------
  async function userState(userId) {
    return (await db.one('SELECT * FROM user_state WHERE user_id=?', userId)) || {
      user_id: userId,
      last_seen_seq: 0,
      onboarded: 0
    };
  }
  async function markSeen(user, body) {
    const state = await userState(user.id);
    const seq = body.seq === undefined ? state.last_seen_seq : Math.min(currentSeq(), Math.max(0, Number(body.seq) || 0));
    const onboarded = body.onboarded === true ? 1 : state.onboarded;
    await db.run('INSERT INTO user_state(user_id,last_seen_seq,onboarded) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen_seq=GREATEST(user_state.last_seen_seq,excluded.last_seen_seq), onboarded=excluded.onboarded', user.id, seq, onboarded);
  }

  // ---------- 引导数据 ----------
  function peopleList() {
    const departments = new Map(allDepartments().map(d => [d.id, d]));
    return allUsers().map(u => ({
      id: u.id,
      name: u.name,
      title: u.title || '',
      departmentId: u.department_id,
      dept: u.department_id === null ? '公司直属' : departments.get(u.department_id)?.name || '未分配部门',
      managerId: u.manager_id || null,
      active: Boolean(u.active),
      admin: u.role === 'owner', version: u.version
    }));
  }
  async function bootstrap(user, extras = {}) {
    const m = model();
    const {
      team,
      managedDepartmentIds,
      directReports
    } = teamOf(user.id);
    const state = await userState(user.id);
    return {
      me: {
        id: user.id,
        name: user.name,
        title: user.title || '',
        departmentId: user.department_id,
        managerId: user.manager_id || null
      },
      access: {
        role: roleOf(user),
        teamIds: [...team],
        directReportIds: directReports,
        managedDepartmentIds
      },
      settings: m.settings,
      today: today(),
      seq: currentSeq(),
      lastSeenSeq: state.last_seen_seq,
      onboarded: Boolean(state.onboarded),
      lastSeenAt: state.last_seen_seq ? (await db.one('SELECT created_at FROM events WHERE seq<=? ORDER BY seq DESC LIMIT 1', state.last_seen_seq))?.created_at || null : null,
      cheersReceived: await db.many(`SELECT c.user_id AS "userId", c.event_seq AS seq, c.created_at AS at, e.type, e.goal_id AS "goalId" FROM cheers c JOIN events e ON e.seq=c.event_seq
        WHERE e.actor_id=? AND c.user_id<>? ORDER BY c.created_at DESC LIMIT 12`, user.id, user.id),
      people: peopleList(),
      departments: allDepartments().map(d => ({
        id: d.id,
        name: d.name,
        parentId: d.parent_id,
        version: d.version, managerId: d.manager_id
      })),
      goals: visibleGoals(user),
      ...extras
    };
  }
  async function delta(user, since) {
    since = Math.max(0, Number(since) || 0);
    const seq = currentSeq();
    if (seq === since) return {
      seq,
      goals: [],
      removed: [],
      events: [],
      reload: false
    };
    const orgChange = (await db.one("SELECT COUNT(*) AS n FROM events WHERE seq>? AND type IN ('org.changed','settings.changed')", since)).n > 0;
    if (orgChange || seq - since > 500) return {
      seq,
      reload: true
    };
    const m = model();
    const {
      visible
    } = visibility(user);
    const changed = (await db.many('SELECT id FROM goals WHERE seq>?', since)).map(row => row.id);
    const goals = [],
      removed = [];
    for (const id of changed) {
      if (visible.has(id)) goals.push(publicGoal(user, m.goals.get(id), m, visible.get(id)));else removed.push(id);
    }
    const events = (await eventsFor(user, {
      after: since,
      limit: 50
    })).items;
    return {
      seq,
      goals,
      removed,
      events,
      reload: false
    };
  }

  // ---------- 校验 ----------
  function cleanText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
  function activeUser(id, label) {
    const u = userById(id);
    requireCondition(u && u.active, `${label}需要是在职的成员。`);
    return u;
  }
  function validNumber(value, label) {
    requireCondition(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12, `${label}需要是有效数字。`);
    return round4(value);
  }
  function normalizeGoalInput(user, body, existing, parent, m) {
    const scope = existing ? existing.scope : parent ? parent.scope : body.scope === 'company' ? 'company' : 'personal';
    const kind = body.kind !== undefined ? body.kind : existing ? existing.kind : 'measure';
    requireCondition(['measure', 'action'].includes(kind), '目标类型只能是“有数字”或“做完就行”。');
    const title = body.title !== undefined ? cleanText(body.title, 60) : existing?.title;
    requireCondition(title, '给目标起个名字吧，最多 60 个字。');
    const note = body.note !== undefined ? cleanText(body.note, 500) : existing?.note || '';
    let unit = '',
      target = null;
    if (kind === 'measure') {
      unit = body.unit !== undefined ? cleanText(body.unit, 8) : existing?.unit || parent?.unit || '';
      requireCondition(unit, '有数字的目标需要一个单位，例如 万元、个、场。');
      target = validNumber(body.target !== undefined ? body.target : existing?.target, '目标值');
      requireCondition(target >= 0, '目标值不能是负数。');
    }
    const startDate = body.startDate !== undefined ? body.startDate : existing?.start_date || parent?.start_date;
    const endDate = body.endDate !== undefined ? body.endDate : existing?.end_date || parent?.end_date;
    requireCondition(isDate(startDate) && isDate(endDate), '请选择有效的开始和结束日期。');
    requireCondition(endDate >= startDate, '结束日期不能早于开始日期。');
    requireCondition(dayNum(endDate) - dayNum(startDate) <= 400, '一个目标的周期最长约 13 个月，长期方向可以拆成多段。');
    const ownerId = body.ownerId !== undefined ? Number(body.ownerId) : existing ? existing.owner_id : user.id;
    if (!existing || ownerId !== existing.owner_id) activeUser(ownerId, '负责人');
    let memberIds = body.memberIds !== undefined ? body.memberIds : existing ? existing.members : [];
    requireCondition(Array.isArray(memberIds) && memberIds.length <= 30, '协作者最多 30 位。');
    memberIds = [...new Set(memberIds.map(Number))].filter(id => id !== ownerId);
    const previousMembers = new Set(existing?.members || []);
    for (const id of memberIds) if (!previousMembers.has(id)) activeUser(id, '协作者');
    let orgIds = body.orgIds !== undefined ? body.orgIds : existing ? existing.orgIds : parent?.orgIds || [];
    requireCondition(Array.isArray(orgIds) && orgIds.length <= 10, '归属组织最多选 10 个。');
    const departments = new Set(allDepartments().map(d => d.id));
    orgIds = [...new Set(orgIds.map(Number))];
    requireCondition(orgIds.every(id => departments.has(id)), '请选择现有的组织。');
    let alignId = body.alignId !== undefined ? body.alignId || null : existing?.align_id || null;
    if (alignId) {
      requireCondition(scope === 'personal' && !(existing?.parent_id || parent), '只有最上层的自主目标可以挂靠到组织目标。');
      const align = m.goals.get(alignId);
      requireCondition(align && !align.archived_at && align.scope === 'company' && (canSee(user, align) || canSee(userById(ownerId), align)), '挂靠的组织目标不存在或你看不到它。');
    }
    return {
      scope,
      kind,
      title,
      note,
      unit,
      target,
      startDate,
      endDate,
      ownerId,
      memberIds,
      orgIds,
      alignId
    };
  }

  // ---------- 写操作 ----------
  async function createGoal(user, body) {
    const m = model();
    const id = typeof body.id === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.id) ? body.id : 'g-' + crypto.randomUUID();
    const existingRow = m.goals.get(id);
    if (existingRow) {
      requireCondition(existingRow.created_by === user.id, '目标编号重复。', 409);
      return {
        id,
        seq: currentSeq(),
        duplicate: true
      };
    }
    let parent = null;
    if (body.parentId) {
      parent = m.goals.get(body.parentId);
      requireCondition(parent && !parent.archived_at && canSee(user, parent), '上级目标不存在或你看不到它。', 404);
      requireCondition(canAddChild(user, parent, m), '只有这个目标的负责人、协作者或上级可以在下面继续拆。', 403);
      requireCondition(depthOf(m, parent) < MAX_DEPTH, `目标最多拆 ${MAX_DEPTH} 层，再往下建议直接写成关键动作的说明。`);
    } else if (body.scope === 'company') {
      requireCondition(user.role === 'owner', '公司层面的目标由公司负责人创建；你可以在已关联的目标下面继续拆，或发起自主目标。', 403);
    }
    const input = normalizeGoalInput(user, body, null, parent, m);
    if (!parent && input.scope === 'personal' && input.ownerId !== user.id) {
      requireCondition(user.role === 'owner' || teamOf(user.id).team.has(input.ownerId), '只能为自己或团队成员发起自主目标。', 403);
    }
    const siblings = parent ? m.kids.get(parent.id) || [] : [];
    const sort = siblings.length ? Math.max(...siblings.map(s => s.sort)) + 1 : 0;
    const at = now();
    await db.run(`INSERT INTO goals(id,parent_id,scope,kind,title,note,unit,target,start_date,end_date,owner_id,org_ids,align_id,created_by,created_at,updated_at,sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, parent?.id || null, input.scope, input.kind, input.title, input.note, input.unit, input.target, input.startDate, input.endDate, input.ownerId, JSON.stringify(input.orgIds), input.alignId, user.id, at, at, sort);
    const addMember = 'INSERT INTO goal_members(goal_id,user_id,added_by,added_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING';
    for (const memberId of input.memberIds) await db.run(addMember, id, memberId, user.id, at);
    const seq = await emit(user.id, 'goal.created', id, null, {
      title: input.title,
      kind: input.kind,
      scope: input.scope,
      target: input.target,
      unit: input.unit,
      parentTitle: parent?.title || null,
      ownerIds: [input.ownerId, ...input.memberIds],
      simulated: Boolean(body.simulated)
    });
    await touch([id, ...(parent ? [parent.id, ...ancestors(m, parent).map(a => a.id)] : [])], seq);
    if (input.alignId) await touch([input.alignId], seq);
    return {
      id,
      seq
    };
  }
  async function splitGoal(user, goalId, body) {
    const m = model();
    const parent = m.goals.get(goalId);
    requireCondition(parent && !parent.archived_at && canSee(user, parent), '目标不存在。', 404);
    requireCondition(canManage(user, parent, m) || parent.owner_id === user.id, '只有目标负责人或上级可以把它拆给成员。', 403);
    requireCondition(depthOf(m, parent) < MAX_DEPTH, `目标最多拆 ${MAX_DEPTH} 层。`);
    const items = Array.isArray(body.items) ? body.items : [];
    requireCondition(items.length > 0 && items.length <= 80, '一次可以拆给 1 到 80 位成员。');
    const existingOwners = new Set((m.kids.get(parent.id) || []).map(child => child.owner_id));
    const seen = new Set();
    const prepared = items.map(item => {
      const ownerId = Number(item.ownerId);
      activeUser(ownerId, '负责人');
      requireCondition(!seen.has(ownerId), '同一位成员在这次拆解里出现了两次。');
      seen.add(ownerId);
      requireCondition(!existingOwners.has(ownerId) || item.allowSecond === true, `${userById(ownerId).name} 已经负责这个目标下面的一项了，可以直接调整那一项。`);
      const title = cleanText(item.title, 60) || `${userById(ownerId).name} · ${parent.title}`.slice(0, 60);
      let target = null;
      if (parent.kind === 'measure') {
        target = validNumber(item.target, '份额');
        requireCondition(target >= 0, '份额不能是负数。');
      }
      return {
        ownerId,
        title,
        target,
        note: cleanText(item.note, 200)
      };
    });
    const at = now();
    const siblings = m.kids.get(parent.id) || [];
    let sort = siblings.length ? Math.max(...siblings.map(s => s.sort)) + 1 : 0;
    const ids = [];
    const insert = `INSERT INTO goals(id,parent_id,scope,kind,title,note,unit,target,start_date,end_date,owner_id,org_ids,created_by,created_at,updated_at,sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    for (const item of prepared) {
      const id = 'g-' + crypto.randomUUID();
      ids.push(id);
      await db.run(insert, id, parent.id, parent.scope, parent.kind, item.title, item.note, parent.unit, item.target, parent.start_date, parent.end_date, item.ownerId, JSON.stringify(parent.orgIds), user.id, at, at, sort++);
    }
    const total = round4(prepared.reduce((sum, item) => sum + (item.target || 0), 0));
    const seq = await emit(user.id, 'goal.split', parent.id, null, {
      title: parent.title,
      count: prepared.length,
      ownerIds: prepared.map(p => p.ownerId),
      total,
      unit: parent.unit,
      childIds: ids
    });
    await touch([...ids, parent.id, ...ancestors(m, parent).map(a => a.id)], seq);
    return {
      ids,
      seq
    };
  }
  async function updateGoal(user, goalId, body) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && !goal.archived_at && canSee(user, goal), '目标不存在。', 404);
    requireCondition(body.version === goal.version, `这个目标刚刚被更新过，已为你载入最新内容，请再确认一次。`, 409);
    requireCondition(canEditMeta(user, goal, m), '只有负责人、创建人或上级可以修改这个目标。', 403);
    const coreFields = ['kind', 'unit', 'target', 'ownerId'];
    const touchesCore = coreFields.some(key => body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify({
      kind: goal.kind,
      unit: goal.unit,
      target: goal.target,
      ownerId: goal.owner_id
    }[key]));
    if (touchesCore) requireCondition(canEditCore(user, goal, m), '目标值、单位和负责人由分配这个目标的人调整；你可以在进展里说明情况。', 403);
    const parent = goal.parent_id ? m.goals.get(goal.parent_id) : null;
    const input = normalizeGoalInput(user, body, goal, parent, m);
    if (input.kind !== goal.kind) requireCondition(!(m.kids.get(goal.id) || []).length && !(await db.one('SELECT 1 FROM checkins WHERE goal_id=? AND value IS NOT NULL AND voided_at IS NULL', goal.id)), '已经有进展或子目标的目标不能切换类型。');
    const changes = {};
    const compare = {
      title: goal.title,
      note: goal.note,
      unit: goal.unit,
      target: goal.target,
      startDate: goal.start_date,
      endDate: goal.end_date,
      ownerId: goal.owner_id,
      kind: goal.kind,
      alignId: goal.align_id,
      orgIds: goal.orgIds,
      memberIds: goal.members
    };
    for (const [key, old] of Object.entries(compare)) if (JSON.stringify(old) !== JSON.stringify(input[key])) changes[key] = [old, input[key]];
    if (!Object.keys(changes).length) return {
      id: goal.id,
      seq: currentSeq(),
      unchanged: true
    };
    const at = now();
    const updated = await db.run(`UPDATE goals SET kind=?,title=?,note=?,unit=?,target=?,start_date=?,end_date=?,owner_id=?,org_ids=?,align_id=?,updated_at=?,version=version+1 WHERE id=? AND version=?`, input.kind, input.title, input.note, input.unit, input.target, input.startDate, input.endDate, input.ownerId, JSON.stringify(input.orgIds), input.alignId, at, goal.id, body.version);
    requireCondition(updated.rowCount === 1, '目标已被其他同事修改，请载入最新内容后重试。', 409);
    if (changes.memberIds) {
      await db.run('DELETE FROM goal_members WHERE goal_id=?', goal.id);
      const add = 'INSERT INTO goal_members(goal_id,user_id,added_by,added_at) VALUES (?,?,?,?)';
      for (const id of input.memberIds) await db.run(add, goal.id, id, user.id, at);
    }
    const added = changes.memberIds ? input.memberIds.filter(id => !goal.members.includes(id)) : [];
    const summary = Object.fromEntries(Object.entries(changes).filter(([key]) => !['note', 'orgIds'].includes(key)));
    const seq = await emit(user.id, 'goal.updated', goal.id, null, {
      title: input.title,
      changes: summary,
      unit: input.unit,
      ownerIds: [...(changes.ownerId ? [input.ownerId] : []), ...added]
    });
    const affected = [goal.id, ...ancestors(m, goal).map(a => a.id)];
    if (changes.ownerId || changes.memberIds) affected.push(...descendants(m, goal).map(d => d.id));
    if (changes.alignId) affected.push(...[goal.align_id, input.alignId].filter(Boolean));
    await touch(affected, seq);
    return {
      id: goal.id,
      seq
    };
  }
  async function joinGoal(user, goalId, body) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && !goal.archived_at && canSee(user, goal), '目标不存在。', 404);
    requireCondition(goal.scope === 'company', '自主目标由发起人邀请协作者。');
    requireCondition(goal.owner_id !== user.id, '你已经是这个目标的负责人。');
    const leave = body.leave === true;
    if (leave) {
      requireCondition(goal.members.includes(user.id), '你还没有加入这个目标。');
      await db.run('DELETE FROM goal_members WHERE goal_id=? AND user_id=?', goal.id, user.id);
    } else {
      requireCondition(!goal.members.includes(user.id), '你已经在协作者里了。');
      requireCondition(goal.members.length < 30, '这个目标的协作者已满 30 位。');
      await db.run('INSERT INTO goal_members(goal_id,user_id,added_by,added_at) VALUES (?,?,?,?)', goal.id, user.id, user.id, now());
    }
    await db.run('UPDATE goals SET version=version+1, updated_at=? WHERE id=?', now(), goal.id);
    const seq = await emit(user.id, leave ? 'member.left' : 'member.joined', goal.id, null, {
      title: goal.title
    });
    await touch([goal.id, ...ancestors(m, goal).map(a => a.id), ...descendants(m, goal).map(d => d.id)], seq);
    return {
      id: goal.id,
      seq
    };
  }
  async function setDone(user, goalId, body) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && !goal.archived_at && canSee(user, goal), '目标不存在。', 404);
    requireCondition(isLinked(user, goal) || canEditMeta(user, goal, m), '只有负责人、协作者或上级可以标记完成。', 403);
    const done = body.done !== false;
    requireCondition(Boolean(goal.done_at) !== done, done ? '这个目标已经标记为完成了。' : '这个目标还没有标记完成。', 409);
    await db.run('UPDATE goals SET done_at=?, done_by=?, version=version+1, updated_at=? WHERE id=?', done ? now() : null, done ? user.id : null, now(), goal.id);
    const seq = await emit(user.id, done ? 'goal.done' : 'goal.reopened', goal.id, null, {
      title: goal.title,
      note: cleanText(body.note, 300)
    });
    await touch([goal.id, ...ancestors(m, goal).map(a => a.id)], seq);
    return {
      id: goal.id,
      seq
    };
  }
  async function archiveGoal(user, goalId, body) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && !goal.archived_at && canSee(user, goal), '目标不存在。', 404);
    requireCondition(body.version === goal.version, '这个目标刚刚被更新过，请确认最新内容后再归档。', 409);
    requireCondition(canEditCore(user, goal, m), goal.scope === 'company' && !goal.parent_id ? '公司层面的目标只能由公司负责人归档。' : '只有分配这个目标的人或上级可以归档它。', 403);
    const subtree = [goal, ...descendants(m, goal)];
    const at = now();
    const statement = 'UPDATE goals SET archived_at=?, archived_by=?, archive_root=?, version=version+1 WHERE id=?';
    for (const g of subtree) await db.run(statement, at, user.id, goal.id, g.id);
    const seq = await emit(user.id, 'goal.archived', goal.id, null, {
      title: goal.title,
      count: subtree.length,
      reason: cleanText(body.reason, 200)
    });
    await touch([...subtree.map(g => g.id), ...ancestors(m, goal).map(a => a.id)], seq);
    return {
      id: goal.id,
      seq,
      count: subtree.length
    };
  }
  async function restoreGoal(user, goalId) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && goal.archived_at && goal.archive_root === goal.id, '只能恢复整组归档的最上层目标。', 404);
    if (goal.parent_id) {
      const parent = m.goals.get(goal.parent_id);
      requireCondition(parent && !parent.archived_at, '上级目标也已归档，请先恢复上级目标。', 409);
    }
    requireCondition(user.role === 'owner' || canEditCore(user, goal, m) && goal.archived_by === user.id || canManage(user, goal, m), '你没有恢复这个目标的权限。', 403);
    const rows = (await db.many('SELECT id FROM goals WHERE archive_root=?', goal.id)).map(r => r.id);
    await db.run('UPDATE goals SET archived_at=NULL, archived_by=NULL, archive_root=NULL, version=version+1 WHERE archive_root=?', goal.id);
    const seq = await emit(user.id, 'goal.restored', goal.id, null, {
      title: goal.title,
      count: rows.length
    });
    await touch([...rows, ...ancestors(m, goal).map(a => a.id)], seq);
    return {
      id: goal.id,
      seq
    };
  }
  async function archivedList(user) {
    const m = model();
    return await Promise.all([...m.goals.values()].filter(goal => goal.archived_at && goal.archive_root === goal.id && (user.role === 'owner' || goal.archived_by === user.id || canManage(user, goal, m))).sort((a, b) => b.archived_at.localeCompare(a.archived_at)).slice(0, 200).map(async goal => ({
      id: goal.id,
      title: goal.title,
      scope: goal.scope,
      ownerId: goal.owner_id,
      archivedAt: goal.archived_at,
      archivedBy: goal.archived_by,
      count: [...m.goals.values()].filter(item => item.archive_root === goal.id).length,
      parentTitle: goal.parent_id ? m.goals.get(goal.parent_id)?.title || '' : ''
    })));
  }
  async function createCheckin(user, goalId, body) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && !goal.archived_at && canSee(user, goal), '目标不存在。', 404);
    const id = typeof body.id === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.id) ? body.id : 'c-' + crypto.randomUUID();
    const duplicate = await db.one('SELECT author_id FROM checkins WHERE id=?', id);
    if (duplicate) {
      requireCondition(duplicate.author_id === user.id, '记录编号重复。', 409);
      return {
        id,
        seq: currentSeq(),
        duplicate: true
      };
    }
    const hasValue = body.value !== undefined && body.value !== null && body.value !== '';
    const note = cleanText(body.note, 300);
    const signal = body.signal ? String(body.signal) : null;
    requireCondition(!signal || SIGNALS.has(signal), '“感觉怎么样”的选项无效。');
    requireCondition(hasValue || note || signal, '写一句话，或者填一个数字再提交。');
    const linked = isLinked(user, goal);
    if (hasValue || signal) requireCondition(linked, '进展数字和状态由负责人和协作者更新；你可以留言支持。', 403);
    const t = today();
    const date = body.date || t;
    requireCondition(isDate(date), '日期格式不正确。');
    let value = null;
    if (hasValue) {
      requireCondition(goal.kind === 'measure', '“做完就行”的目标不用填数字，完成后点“标记完成”。');
      value = validNumber(body.value, '新增值');
      requireCondition(value !== 0 || note, '新增值为 0 时，写一句说明吧。');
      requireCondition(date >= goal.start_date && date <= goal.end_date, `日期需要在目标周期内（${goal.start_date} 至 ${goal.end_date}）。`);
      requireCondition(date <= t, '不能记录未来日期的进展。');
      if (value < 0) requireCondition(note, '冲减或退款请写一句原因，方便以后核对。');
      const own = Number((await db.one('SELECT COALESCE(SUM(value),0) AS s FROM checkins WHERE goal_id=? AND voided_at IS NULL AND value IS NOT NULL', goal.id)).s);
      requireCondition(own + value >= -1e-7, '冲减后这个目标自己的累计会变成负数，请检查数字。');
    } else requireCondition(date <= t, '不能记录未来日期。');
    const before = m.stats.get(goal.id);
    await db.run('INSERT INTO checkins(id,goal_id,author_id,date,value,note,signal,created_at,simulated) VALUES (?,?,?,?,?,?,?,?,?)', id, goal.id, user.id, date, value, note, signal, now(), body.simulated ? 1 : 0);
    const total = goal.kind === 'measure' && value !== null ? round4((before?.value || 0) + value) : before?.value ?? null;
    const completion = goal.kind === 'measure' && goal.target > 0 && total !== null ? round4(total / goal.target) : null;
    const seq = await emit(user.id, 'checkin.created', goal.id, id, {
      title: goal.title,
      value,
      unit: goal.unit,
      note,
      signal,
      total,
      target: goal.target,
      completion,
      comment: !hasValue && !signal,
      simulated: Boolean(body.simulated)
    });
    const affected = [goal.id, ...ancestors(m, goal).map(a => a.id)];
    await touch(affected, seq);
    // 刚好越过 100% 时发一条“达成”喜报
    let achievedSeq = null;
    if (goal.kind === 'measure' && goal.target > 0 && before && before.value < goal.target && total >= goal.target - 1e-9) {
      achievedSeq = await emit(user.id, 'goal.achieved', goal.id, id, {
        title: goal.title,
        total,
        target: goal.target,
        unit: goal.unit,
        simulated: Boolean(body.simulated)
      });
      await touch(affected, achievedSeq);
    }
    // 上级目标被这笔进展带过 100% 时也报喜
    db.context().previousModel = db.context().model;
    db.context().model = null;
    await prepareModel();
    const after = model();
    for (const a of ancestors(m, goal)) {
      const prev = m.stats.get(a.id),
        next = after.stats.get(a.id);
      if (a.kind === 'measure' && a.target > 0 && prev && next && prev.value < a.target && next.value >= a.target - 1e-9) {
        achievedSeq = await emit(user.id, 'goal.achieved', a.id, id, {
          title: a.title,
          total: next.value,
          target: a.target,
          unit: a.unit,
          via: goal.title,
          simulated: Boolean(body.simulated)
        });
        await touch([a.id, ...ancestors(after, a).map(x => x.id)], achievedSeq);
      }
    }
    return {
      id,
      seq: achievedSeq || seq
    };
  }
  async function voidCheckin(user, checkinId, body) {
    const m = model();
    const row = await db.one('SELECT * FROM checkins WHERE id=?', checkinId);
    requireCondition(row, '记录不存在。', 404);
    requireCondition(row.author_id === user.id, '只能撤回自己写的记录。', 403);
    const goal = m.goals.get(row.goal_id);
    requireCondition(goal && !goal.archived_at, '这条记录所在的目标已归档。', 409);
    const restore = body.restore === true;
    requireCondition(Boolean(row.voided_at) === restore, restore ? '这条记录本来就有效。' : '这条记录已经撤回了。', 409);
    if (row.value !== null) {
      const own = Number((await db.one('SELECT COALESCE(SUM(value),0) AS s FROM checkins WHERE goal_id=? AND voided_at IS NULL AND value IS NOT NULL', goal.id)).s);
      const next = restore ? own + row.value : own - row.value;
      requireCondition(next >= -1e-7, restore ? '恢复后累计会变成负数，请先恢复对应的原始记录。' : '撤回后累计会变成负数，请先撤回对应的冲减记录。');
    }
    if (restore) await db.run('UPDATE checkins SET voided_at=NULL, voided_by=NULL, void_reason=NULL WHERE id=?', row.id);else await db.run('UPDATE checkins SET voided_at=?, voided_by=?, void_reason=? WHERE id=?', now(), user.id, cleanText(body.reason, 200), row.id);
    await db.run("UPDATE events SET payload=jsonb_set(payload,'{voided}',?::jsonb) WHERE type='checkin.created' AND ref_id=?", restore ? 'false' : 'true', row.id);
    const seq = await emit(user.id, restore ? 'checkin.restored' : 'checkin.voided', goal.id, row.id, {
      title: goal.title,
      value: row.value,
      unit: goal.unit
    });
    await touch([goal.id, ...ancestors(m, goal).map(a => a.id)], seq);
    return {
      id: row.id,
      seq
    };
  }
  async function myCheckins(user, {
    before = null,
    limit = 30
  } = {}) {
    const m = model();
    const rows = await db.many(`SELECT * FROM checkins WHERE author_id=?${before ? ' AND created_at < ?' : ''} ORDER BY created_at DESC LIMIT ?`, ...[user.id, ...(before ? [before] : []), Math.min(100, Number(limit) || 30)]);
    return {
      items: rows.map(row => ({
        id: row.id,
        goalId: row.goal_id,
        goalTitle: m.goals.get(row.goal_id)?.title || '',
        unit: m.goals.get(row.goal_id)?.unit || '',
        archived: Boolean(m.goals.get(row.goal_id)?.archived_at),
        date: row.date,
        value: row.value,
        note: row.note,
        signal: row.signal,
        createdAt: row.created_at,
        voided: Boolean(row.voided_at)
      })),
      next: rows.length ? rows[rows.length - 1].created_at : null
    };
  }
  async function goalDetail(user, goalId) {
    const m = model();
    const goal = m.goals.get(goalId);
    requireCondition(goal && !goal.archived_at && canSee(user, goal), '目标不存在或没有查看权限。', 404);
    const {
      visible
    } = visibility(user);
    // 谁在这个目标下面做了什么：
    //   value  = 此人亲手记录的同单位进展（按记录人，不重复计算汇总值）
    //   target = 此人负责的份额（上一层不是他自己的同单位目标；他自己再往下拆的部分不重复计入）
    //   goals/risk/help/stale = 此人关联的末端目标数与风险数
    const contributions = new Map();
    const entry = id => {
      if (!contributions.has(id)) contributions.set(id, {
        userId: id,
        goals: 0,
        value: 0,
        target: 0,
        risk: 0,
        help: 0,
        stale: 0,
        lastDate: null
      });
      return contributions.get(id);
    };
    const nodes = [goal, ...descendants(m, goal)];
    const shown = nodes.filter(node => visible.get(node.id) === 'own');
    const hiddenLeaves = nodes.filter(node => visible.get(node.id) !== 'own' && !(m.kids.get(node.id) || []).length).length;
    const measureNodes = goal.kind === 'measure' ? shown.filter(node => node.kind === 'measure' && node.unit === goal.unit) : [];
    const t = today();
    if (measureNodes.length) {
      const marks = measureNodes.map(() => '?').join(',');
      for (const row of await db.many(`SELECT author_id, SUM(value) AS v, MAX(date) AS last_date FROM checkins WHERE voided_at IS NULL AND value IS NOT NULL AND date<=? AND goal_id IN (${marks}) GROUP BY author_id`, t, ...measureNodes.map(n => n.id))) {
        const c = entry(row.author_id);
        c.value += Number(row.v) || 0;
        c.lastDate = row.last_date;
      }
      for (const node of measureNodes) {
        const parent = node.parent_id ? m.goals.get(node.parent_id) : null;
        if (node.id === goal.id) continue;
        if (!parent || parent.owner_id !== node.owner_id) entry(node.owner_id).target += node.target || 0;
      }
    }
    for (const node of shown) {
      if ((m.kids.get(node.id) || []).length) continue;
      const stat = m.stats.get(node.id);
      for (const id of new Set([node.owner_id, ...node.members])) {
        const c = entry(id);
        c.goals += 1;
        if (stat.status === 'risk') c.risk += 1;
        if (stat.signal === 'help' && stat.status !== 'done') c.help += 1;
        if (stat.stale) c.stale += 1;
        if (stat.ownLast && (!c.lastDate || stat.ownLast > c.lastDate)) c.lastDate = stat.ownLast;
      }
    }
    const aligned = [...m.goals.values()].filter(g => g.align_id === goal.id && !g.archived_at && canSee(user, g)).map(g => g.id);
    return {
      goal: publicGoal(user, goal, m, visible.get(goal.id)),
      contributions: [...contributions.values()].map(c => ({
        ...c,
        value: round4(c.value),
        target: round4(c.target)
      })).sort((x, y) => y.value - x.value || y.goals - x.goals),
      aligned,
      hiddenLeaves
    };
  }
  async function toggleCheer(user, seq) {
    const event = await db.one('SELECT * FROM events WHERE seq=?', Number(seq));
    requireCondition(event && event.goal_id && canSee(user, model().goals.get(event.goal_id) || {}), '这条动态不存在。', 404);
    const existing = await db.one('SELECT 1 FROM cheers WHERE event_seq=? AND user_id=?', event.seq, user.id);
    if (existing) await db.run('DELETE FROM cheers WHERE event_seq=? AND user_id=?', event.seq, user.id);else await db.run('INSERT INTO cheers(event_seq,user_id,created_at) VALUES (?,?,?)', event.seq, user.id, now());
    const count = (await db.one('SELECT COUNT(*) AS n FROM cheers WHERE event_seq=?', event.seq)).n;
    return {
      seq: event.seq,
      count,
      cheered: !existing,
      actorId: event.actor_id
    };
  }

  // ---------- 通讯录汇报关系 ----------
  async function applyDirectoryManagers(user) {
    requireCondition(require('./permissions.cjs').can(user,'directory.import'), '没有批量设置汇报关系的权限。', 403);
    let changed = 0;
    const parents=new Map(allUsers().map(u=>[u.id,u.manager_id]));
    for (const profile of await db.many('SELECT user_id, direct_manager_id FROM directory_profiles WHERE direct_manager_id IS NOT NULL')) {
      const target=userById(profile.user_id),manager=userById(profile.direct_manager_id);
      if(!target?.active || !manager?.active || parents.get(target.id) || user.role!=='owner' && target.role!=='member')continue;
      let cycle=false; const seen=new Set();
      for(let cursor=manager.id;cursor;cursor=parents.get(cursor)){if(cursor===target.id||seen.has(cursor)){cycle=true;break;}seen.add(cursor);}
      if(cycle)continue;
      changed += Number((await db.run('UPDATE users SET manager_id=?,version=version+1 WHERE id=? AND manager_id IS NULL',manager.id,target.id)).rowCount);
      parents.set(target.id,manager.id);
    }
    const seq = await emit(user.id, 'org.changed', null, null, {
      directoryManagers: changed
    });
    return {
      changed,
      seq
    };
  }

  // 交接：把某位成员（通常是已离职成员或旧版的演示角色）名下的全部目标，一次性交给一位在职同事负责。
  // 只改负责人；拆解结构、协作者和历史进展（记录人仍是原来的人）都保持原样。已归档的也一起交接，恢复后不会断档。
  async function ownedCounts() {
    const out = new Map();
    for (const row of await db.many('SELECT owner_id, COUNT(*) AS n FROM goals WHERE archived_at IS NULL GROUP BY owner_id')) out.set(row.owner_id, row.n);
    return out;
  }
  async function handoverGoals(user, fromId, body) {
    requireCondition(user.role === 'owner', '只有公司负责人可以交接目标。', 403);
    const from = userById(fromId);
    requireCondition(from, '成员不存在。', 404);
    const to = userById(Number(body.toId));
    requireCondition(to && to.active, '接手的人需要是在职成员。');
    requireCondition(to.id !== from.id, '请选择另一位成员接手。');
    const ids = (await db.many('SELECT id FROM goals WHERE owner_id=?', from.id)).map(row => row.id);
    requireCondition(ids.length, `${from.name} 名下已经没有需要交接的目标。`, 409);
    const open = (await db.one('SELECT COUNT(*) AS n FROM goals WHERE owner_id=? AND archived_at IS NULL', from.id)).n;
    const at = now();
    await db.run('UPDATE goals SET owner_id=?, updated_at=?, version=version+1 WHERE owner_id=?', to.id, at, from.id);
    const dropMember = 'DELETE FROM goal_members WHERE goal_id=? AND user_id=?';
    for (const id of ids) await db.run(dropMember, id, to.id);
    const seq = await emit(user.id, 'org.changed', null, null, {
      action: 'goal.handover',
      from: from.id,
      to: to.id,
      count: ids.length
    });
    await touch(ids, seq);
    return {
      count: ids.length,
      open,
      seq
    };
  }
  function invalidate() {
    sharedCache = null;
    if (db.context()) db.context().model = null;
  }
  return {
    commit: context => { if(context.model) sharedCache=context.model; },
    settings,
    saveSettings,
    emit,
    currentSeq,
    model,
    prepareModel,
    invalidate,
    teamOf,
    roleOf,
    visibility,
    canSee,
    bootstrap,
    delta,
    eventsFor,
    createGoal,
    splitGoal,
    updateGoal,
    joinGoal,
    setDone,
    archiveGoal,
    restoreGoal,
    archivedList,
    createCheckin,
    voidCheckin,
    myCheckins,
    goalDetail,
    toggleCheer,
    markSeen,
    applyDirectoryManagers,
    ownedCounts,
    handoverGoals,
    peopleList,
    isLinked,
    canManage
  };
}
module.exports = {
  createGoalDomain,
  DEFAULT_SETTINGS,
  MAX_DEPTH,
  monthRange,
  dayNum,
  isDate
};

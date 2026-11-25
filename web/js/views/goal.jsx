import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 目标页：一页讲清楚“这个目标是什么、谁在做、做到哪了、往下由哪些路径组成”。
import { get } from "../api.js";
import { store, goal as getGoal, children, ancestors, person, mutate, isAdmin } from "../store.js";
import { esc, icon, num, pct, points, bar, ring, statusChip, flags, avatar, avatarStack, period, shortDate, kindLabel, emptyState, toast, busy, relTime, daysSince } from "../ui.jsx";
import { childRow, outline, byAttention, needsCare, goalCard, lastText, flashAttr } from "./cards.jsx";
import { grouped } from "./feed.jsx";
import { uid } from "../forms.jsx";
const PAGE = 12;
let s = fresh(null);
function fresh(id) {
  return {
    id,
    detail: null,
    detailError: null,
    events: [],
    next: null,
    eventsLoaded: false,
    loadingMore: false,
    filter: 'all',
    mode: 'next',
    limit: PAGE,
    loadedSeq: 0,
    timer: null
  };
}
async function loadDetail() {
  const id = s.id;
  try {
    const detail = await get('/api/goals/' + encodeURIComponent(id));
    if (s.id === id) {
      s.detail = detail;
      s.detailError = null;
    }
  } catch (error) {
    if (s.id === id) s.detailError = error;
  }
}
async function loadEvents() {
  const id = s.id;
  try {
    const {
      items,
      next
    } = await get(`/api/events?goal=${encodeURIComponent(id)}&subtree=1&limit=20`);
    if (s.id !== id) return;
    const known = new Map(s.events.map(e => [e.seq, e]));
    const merged = new Map(known);
    const freshAt = Date.now();
    for (const e of items) merged.set(e.seq, known.has(e.seq) ? {
      ...e,
      fresh: known.get(e.seq).fresh
    } : {
      ...e,
      fresh: s.eventsLoaded ? freshAt : 0
    });
    s.events = [...merged.values()].sort((a, b) => b.seq - a.seq);
    if (!s.eventsLoaded) s.next = next;
    s.eventsLoaded = true;
  } catch {
    s.eventsLoaded = true;
  }
}
function refreshSoon(ctx) {
  clearTimeout(s.timer);
  s.timer = setTimeout(async () => {
    await Promise.all([loadDetail(), loadEvents()]);
    ctx.refresh();
  }, 400);
}
function breadcrumb(g) {
  const chain = ancestors(g);
  const crumbs = [<Ui as="a" href={"#/map"}>{icon('map')}{"目标地图"}</Ui>];
  if (g.scope === 'personal' && !chain.length) crumbs[0] = <Ui as="a" href={"#/"}>{icon('sprout')}{"自主目标"}</Ui>;
  for (const a of chain) crumbs.push(<Ui as="a" href={`#/g/${esc(a.id)}`}>{esc(a.title)}</Ui>);
  return <Ui as="nav" className={"crumbs"} aria-label={"目标路径"}>{joinNodes(crumbs, <Ui as="span" className={"sep"}>{icon('chevron-right')}</Ui>)}<Ui as="span" className={"sep"}>{icon('chevron-right')}</Ui><Ui as="span" aria-current={"page"}>{esc(g.title)}</Ui></Ui>;
}
function roles(g) {
  const parent = g.parentId ? getGoal(g.parentId) : null;
  const assigner = g.createdBy !== g.ownerId ? g.createdBy : null;
  return <Ui as="div" className={"roles"}>{"\n    "}<Ui as="div" className={"role"}><Ui as="span" className={"role-k"}>{"负责人"}</Ui><Ui as="a" href={`#/p/${g.ownerId}`} className={"role-v"}>{avatar(g.ownerId, 'sm')}{esc(person(g.ownerId).name)}{g.ownerId === store.me.id ? <Ui as="em">{"我"}</Ui> : ''}</Ui></Ui>{"\n    "}<Ui as="div" className={"role"}><Ui as="span" className={"role-k"}>{"协作者"}</Ui><Ui as="span" className={"role-v"}>{g.memberIds.length ? <>{avatarStack(g.memberIds, 5)}<Ui as="span">{joinNodes(g.memberIds.slice(0, 2).map(id => esc(person(id).name)), '、')}{g.memberIds.length > 2 ? ` 等 ${g.memberIds.length} 人` : ''}</Ui></> : <Ui as="span" className={"muted"}>{"暂无"}</Ui>}</Ui></Ui>{"\n    "}{assigner ? <Ui as="div" className={"role"}><Ui as="span" className={"role-k"}>{parent ? '分配人' : '发起人'}</Ui><Ui as="a" href={`#/p/${assigner}`} className={"role-v"}>{avatar(assigner, 'sm')}{esc(person(assigner).name)}</Ui></Ui> : ''}{"\n    "}<Ui as="div" className={"role"}><Ui as="span" className={"role-k"}>{"周期"}</Ui><Ui as="span" className={"role-v"}>{icon('calendar')}{period(g)}{g.stat && !['done'].includes(g.stat.status) ? <Ui as="small">{g.stat.status === 'upcoming' ? '未开始' : `还剩 ${g.stat.daysLeft} 天`}</Ui> : ''}</Ui></Ui>{"\n  "}</Ui>;
}
function headline(g) {
  const st = g.stat;
  if (g.kind === 'measure') {
    if (!(g.target > 0)) return <><Ui as="div" className={"big-num"}><Ui as="b">{num(st.value)}</Ui><Ui as="span">{esc(g.unit)}</Ui></Ui><Ui as="p" className={"pace muted"}>{"还没有设定目标值，进展会照常累计。"}</Ui></>;
    const left = Math.max(0, g.target - st.value);
    return <><Ui as="div" className={"big-num"}><Ui as="b">{num(st.value)}</Ui><Ui as="span">{"/ "}{num(g.target)}{" "}{esc(g.unit)}</Ui><Ui as="em" className={`t-${st.status === 'done' ? 'done' : st.status}`}>{pct(st.completion)}</Ui></Ui>{"\n      "}<Ui as="p" className={"pace"}>{st.status === 'done' ? <>{icon('party-popper')}{"已经达成，超出 "}{num(st.value - g.target)}{" "}{esc(g.unit)}</> : st.status === 'upcoming' ? <>{icon('sunrise')}{shortDate(g.startDate)}{" 开始"}</> : <>{icon('hourglass')}{"时间过去 "}{pct(st.timeProgress)}{"，"}{points(st.deviation)}{"；还差 "}<Ui as="b">{num(left)}</Ui>{" "}{esc(g.unit)}</>}</Ui></>;
  }
  if (st.childCount) return <><Ui as="div" className={"big-num"}><Ui as="b">{st.leaf.done}</Ui><Ui as="span">{"/ "}{st.leaf.total}{" 项完成"}</Ui><Ui as="em" className={`t-${st.status}`}>{pct(st.completion)}</Ui></Ui><Ui as="p" className={"pace"}>{icon('hourglass')}{"时间过去 "}{pct(st.timeProgress)}{"，"}{points(st.deviation)}</Ui></>;
  if (g.doneAt) return <Ui as="div" className={"big-num"}><Ui as="b" className={"t-done"}>{"已完成"}</Ui><Ui as="span">{shortDate(g.doneAt.slice(0, 10))}{" · "}{esc(person(g.ownerId).name)}</Ui></Ui>;
  return <Ui as="div" className={"big-num"}><Ui as="b">{st.status === 'risk' ? '已超期' : st.status === 'upcoming' ? '未开始' : `还剩 ${st.daysLeft} 天`}</Ui><Ui as="span">{"做完就行 · 截止 "}{shortDate(g.endDate)}</Ui></Ui>;
}
function actionBar(g) {
  const st = g.stat;
  const canRecord = g.perms.checkin && !(g.kind === 'action' && st.childCount) && !g.doneAt && (g.kind === 'measure' || st.status !== 'done');
  const canSplit = g.perms.child && (g.ownerId === store.me.id || g.perms.core);
  const menu = [g.perms.edit ? <Ui as="button" type={"button"} data-act={"edit"} data-id={esc(g.id)}>{icon('pencil')}{"编辑目标"}</Ui> : '', g.kind === 'action' && !st.childCount && !g.doneAt && g.perms.checkin ? <Ui as="button" type={"button"} data-act={"mark-done"} data-id={esc(g.id)}>{icon('circle-check')}{"标记完成"}</Ui> : '', g.doneAt && (g.perms.checkin || g.perms.edit) ? <Ui as="button" type={"button"} data-act={"reopen"} data-id={esc(g.id)}>{icon('rotate-ccw')}{"重新打开"}</Ui> : '', g.perms.join && g.memberIds.includes(store.me.id) ? <Ui as="button" type={"button"} data-act={"join"} data-id={esc(g.id)}>{icon('log-out')}{"退出协作"}</Ui> : ''].filter(Boolean);
  return <Ui as="div" className={"actions"}>{"\n    "}{canRecord ? <Ui as="button" type={"button"} className={"btn primary"} data-act={"checkin"} data-id={esc(g.id)}>{icon('pencil')}{"记一笔"}</Ui> : ''}{"\n    "}{g.perms.join && !g.memberIds.includes(store.me.id) ? <Ui as="button" type={"button"} className={`btn ${canRecord ? 'soft' : 'primary'}`} data-act={"join"} data-id={esc(g.id)}>{icon('hand-heart')}{"加入协作"}</Ui> : ''}{"\n    "}{g.perms.child ? <Ui as="details" className={"menu split-menu"} data-keep={""}><Ui as="summary" className={"btn soft"}>{icon('git-fork')}{"往下拆"}{icon('chevron-down', 'caret')}</Ui><Ui as="div" className={"menu-pop"}>{"\n        "}{canSplit ? <Ui as="button" type={"button"} data-act={"split"} data-id={esc(g.id)}>{icon('users')}<Ui as="span"><Ui as="b">{"拆给成员"}</Ui><Ui as="small">{g.kind === 'measure' ? '一次分好每个人的份额' : '每人一项'}</Ui></Ui></Ui> : ''}{"\n        "}<Ui as="button" type={"button"} data-act={"new-goal"} data-parent={esc(g.id)}>{icon('route')}<Ui as="span"><Ui as="b">{"添加一条关键路径"}</Ui><Ui as="small">{"新的打法、项目或关键动作"}</Ui></Ui></Ui></Ui></Ui> : ''}{"\n    "}<Ui as="button" type={"button"} className={"btn ghost"} data-act={"comment"} data-id={esc(g.id)}>{icon('message-circle')}{"说一句"}</Ui>{"\n    "}{menu.length ? <Ui as="details" className={"menu more-menu"} data-keep={""}><Ui as="summary" className={"btn ghost icon-only"} aria-label={"更多操作"}>{icon('ellipsis')}</Ui><Ui as="div" className={"menu-pop right"}>{joinNodes(menu, '')}</Ui></Ui> : ''}{"\n  "}</Ui>;
}
function pathTab(g) {
  const st = g.stat;
  const kids = children(g.id);
  const hidden = g.hiddenChildren || 0;
  const gapHint = g.kind === 'measure' && g.target > 0 && kids.length ? st.gap > 1e-6 ? <Ui as="div" className={"gap-hint"}>{icon('git-fork')}<Ui as="span">{"已分到下一层 "}<Ui as="b">{num(st.assigned)}</Ui>{" / "}{num(g.target)}{" "}{esc(g.unit)}{"，还有 "}<Ui as="b">{num(st.gap)}</Ui>{" "}{esc(g.unit)}{" 没有落到具体路径上。"}</Ui>{g.perms.child && (g.ownerId === store.me.id || g.perms.core) ? <Ui as="button" type={"button"} className={"btn soft sm"} data-act={"split"} data-id={esc(g.id)}>{"拆给成员"}</Ui> : ''}</Ui> : st.gap < -1e-6 ? <Ui as="div" className={"gap-hint over"}>{icon('rocket')}<Ui as="span">{"下一层合计 "}{num(st.assigned)}{" "}{esc(g.unit)}{"，比目标多了 "}{num(-st.gap)}{"，相当于给团队留了冲刺空间。"}</Ui></Ui> : '' : '';
  if (!kids.length) {
    return <>{hidden ? <Ui as="p" className={"scope-note"}>{icon('eye-off')}{"下面有 "}{hidden}{" 项属于其他团队，你看不到细节，但它们的进展已计入上面的总数。"}</Ui> : ''}{"\n      "}<Ui as="div" className={"leaf-empty"}>{icon('corner-down-right')}<Ui as="div"><Ui as="b">{hidden ? '你能看到的拆解就到这里了' : '这是一条末端路径'}</Ui><Ui as="p">{g.perms.checkin ? '进展直接记在这里就好。' : '进展由负责人和协作者记录。'}{g.perms.child ? '如果它需要多人或多步完成，也可以继续往下拆。' : ''}</Ui>{"\n      "}{g.perms.child ? <Ui as="div" className={"row-btns"}>{g.ownerId === store.me.id || g.perms.core ? <Ui as="button" type={"button"} className={"btn soft sm"} data-act={"split"} data-id={esc(g.id)}>{icon('users')}{"拆给成员"}</Ui> : ''}<Ui as="button" type={"button"} className={"btn ghost sm"} data-act={"new-goal"} data-parent={esc(g.id)}>{icon('route')}{"添加关键路径"}</Ui></Ui> : ''}</Ui></Ui>{"\n      "}{feedList(g, {
        limit: 6,
        title: '最近的进展'
      })}</>;
  }
  const care = kids.filter(needsCare),
    done = kids.filter(k => k.stat?.status === 'done');
  const list = (s.filter === 'care' ? care : s.filter === 'done' ? done : kids).slice().sort(s.filter === 'all' ? (a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt) : byAttention);
  return <>{gapHint}{"\n    "}<Ui as="div" className={"tab-tools"}>{"\n      "}<Ui as="div" className={"seg"} role={"group"} aria-label={"显示方式"}><Ui as="button" type={"button"} className={s.mode === 'next' ? 'on' : ''} data-act={"mode"} data-mode={"next"}>{"下一层"}</Ui><Ui as="button" type={"button"} className={s.mode === 'all' ? 'on' : ''} data-act={"mode"} data-mode={"all"}>{"全部层级"}</Ui></Ui>{"\n      "}{s.mode === 'next' ? <Ui as="div" className={"chips"}>{joinNodes([['all', `全部 ${kids.length}`], ['care', `需要关注 ${care.length}`], ['done', `已达成 ${done.length}`]].map(([k, l]) => <Ui as="button" type={"button"} className={`chip-btn${s.filter === k ? ' on' : ''}`} data-act={"filter"} data-filter={k}>{l}</Ui>), '')}</Ui> : ''}{"\n    "}</Ui>{"\n    "}{s.mode === 'all' ? <Ui as="div" className={"outline"}>{outline(g)}</Ui> : list.length ? <><Ui as="div" className={"rows"}>{joinNodes(list.slice(0, s.limit).map(k => childRow(k, g)), '')}</Ui>{list.length > s.limit ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"more-rows"}>{icon('chevron-down')}{"再显示 "}{Math.min(PAGE, list.length - s.limit)}{" 项（共 "}{list.length}{" 项）"}</Ui> : ''}</> : <Ui as="div" className={"soft-empty ok"}>{icon('sun')}<Ui as="span">{s.filter === 'care' ? '这一层没有需要特别关注的路径。' : '这一层还没有达成的路径，加油。'}</Ui></Ui>}{"\n    "}{hidden ? <Ui as="p" className={"scope-note"}>{icon('eye-off')}{"另有 "}{hidden}{" 项属于其他团队，你看不到细节，但它们的进展已计入上面的总数。"}</Ui> : ''}{"\n    "}{alignedBlock()}</>;
}
function alignedBlock() {
  const ids = s.detail?.aligned || [];
  const list = ids.map(getGoal).filter(Boolean);
  if (!list.length) return '';
  return <Ui as="div" className={"aligned"}><Ui as="h3">{icon('sprout')}{"挂靠在这里的自主目标"}<Ui as="small">{list.length}</Ui></Ui><Ui as="p" className={"muted small"}>{"大家自己发起、为这个目标出力的事，不计入上面的数字。"}</Ui><Ui as="div" className={"grid"}>{joinNodes(list.map(x => goalCard(x, {
        showPath: false,
        showOwner: true,
        quick: false
      })), '')}</Ui></Ui>;
}
function peopleTab(g) {
  if (!s.detail) return <Ui as="div" className={"loading"}>{icon('orbit')}{"正在整理成员贡献…"}</Ui>;
  const list = s.detail.contributions;
  if (!list.length) return <Ui as="div" className={"soft-empty"}>{icon('users')}<Ui as="span">{"还没有成员参与。"}</Ui></Ui>;
  const measure = g.kind === 'measure';
  const maxValue = Math.max(...list.map(c => Math.max(c.value, c.target)), 1e-9);
  return <><Ui as="p" className={"muted small"}>{measure ? `贡献 = 每个人亲手记下的进展（${esc(g.unit)}）；份额 = 分给 TA 的目标值。` : ''}{"共 "}{list.length}{" 人在这条路径上。"}{s.detail.hiddenLeaves ? `另有 ${s.detail.hiddenLeaves} 项属于其他团队，未列出成员。` : ''}</Ui>{"\n  "}<Ui as="div" className={"people"}>{joinNodes(list.map(c => {
        const p = person(c.userId);
        const share = measure && c.target > 0 ? c.value / c.target : null;
        return <Ui as="a" className={"person-row"} href={`#/p/${c.userId}`} data-key={`pc-${c.userId}`} key={`pc-${c.userId}`}>{"\n      "}{avatar(c.userId, 'md')}{"\n      "}<Ui as="span" className={"pr-main"}><Ui as="b">{esc(p.name)}{c.userId === store.me.id ? <Ui as="em">{"我"}</Ui> : ''}</Ui><Ui as="small">{esc(p.title || '')}{p.title ? ' · ' : ''}{esc(p.dept)}</Ui>{"\n        "}{measure ? <Ui as="span" className={"contrib"}><Ui as="i" style={{
                "width": `${Math.min(100, c.value / maxValue * 100).toFixed(1)}%`
              }} />{c.target > 0 ? <Ui as="b" className={"share-mark"} style={{
                "left": `${Math.min(100, c.target / maxValue * 100).toFixed(1)}%`
              }} /> : ''}</Ui> : ''}</Ui>{"\n      "}<Ui as="span" className={"pr-num"}>{measure ? <><Ui as="b">{num(c.value)}</Ui><Ui as="small">{c.target > 0 ? `/ 份额 ${num(c.target)}${share !== null ? ` · ${pct(share)}` : ''}` : esc(g.unit)}</Ui></> : ''}{"\n        "}<Ui as="span" className={"pr-flags"}>{c.goals ? <Ui as="span" className={"muted"}>{c.goals}{" 项"}</Ui> : ''}{c.risk ? <Ui as="span" className={"chip tone-risk sm"}>{c.risk}{" 落后"}</Ui> : ''}{c.help ? <Ui as="span" className={"chip tone-help sm"}>{icon('life-buoy')}{c.help}</Ui> : ''}{c.stale ? <Ui as="span" className={"chip tone-quiet sm"}>{icon('clock')}{c.stale}</Ui> : ''}</Ui>{"\n        "}<Ui as="small" className={"muted"}>{lastText(c.lastDate)}</Ui></Ui>{"\n    "}</Ui>;
      }), '')}</Ui></>;
}
function feedList(g, {
  limit = null,
  title = ''
} = {}) {
  if (!s.eventsLoaded) return <Ui as="div" className={"loading"}>{icon('orbit')}{"正在加载动态…"}</Ui>;
  const list = limit ? s.events.slice(0, limit) : s.events;
  return <>{title ? <Ui as="h3" className={"sub-title"}>{title}</Ui> : ''}{list.length ? grouped(list, {
      showPath: false
    }) : <Ui as="div" className={"soft-empty"}>{icon('messages-square')}<Ui as="span">{"还没有动态。第一条进展记下来，大家就能看到。"}</Ui></Ui>}{"\n    "}{!limit && s.next ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"more-events"} disabled={!!s.loadingMore}>{icon('chevron-down')}{"看更早的动态"}</Ui> : ''}</>;
}
function feedTab(g) {
  return <><Ui as="form" className={"comment-box"} data-act-form={"comment"}>{"\n      "}{avatar(store.me.id, 'sm')}<Ui as="textarea" data-keep={`cm-${esc(g.id)}`} name={"comment"} rows={"1"} maxLength={"300"} placeholder={g.perms.checkin ? '说说最新情况，或者给协作者一句鼓励…' : '给大家一句鼓励、建议或支持…'} />{"\n      "}<Ui as="button" type={"button"} className={"btn primary sm"} data-act={"send-comment"} data-id={esc(g.id)}>{icon('send')}{"发送"}</Ui></Ui>{"\n    "}{feedList(g)}</>;
}
export default {
  title: params => getGoal(params.id)?.title || '目标',
  enter(params, ctx) {
    if (s.id !== params.id) {
      clearTimeout(s.timer);
      s = fresh(params.id);
    }
    s.loadedSeq = store.seq;
    Promise.all([loadDetail(), loadEvents()]).then(() => ctx.refresh());
  },
  leave() {
    clearTimeout(s.timer);
  },
  onStore(kind, params, ctx) {
    if (kind === 'load') return refreshSoon(ctx);
    if (kind === 'delta' && store.seq > s.loadedSeq) {
      const at = store.recent.get(params.id);
      const inTree = id => id === params.id || ancestors(getGoal(id)).some(a => a.id === params.id);
      if (at && Date.now() - at < 2000 || (store.lastEvents || []).some(e => inTree(e.goalId))) {
        s.loadedSeq = store.seq;
        refreshSoon(ctx);
      }
    }
  },
  render(params) {
    const g = getGoal(params.id);
    if (!g) return <Ui as="div" className={"page"}>{emptyState({
        image: 'ip-think',
        title: '找不到这个目标',
        text: '它可能已经被归档，或者不在你的可见范围里。',
        action: <Ui as="a" className={"btn primary"} href={"#/map"}>{"回到目标地图"}</Ui>
      })}</Ui>;
    const st = g.stat;
    const tab = params.tab || (st.childCount || g.hiddenChildren ? 'path' : 'feed');
    const peopleCount = s.detail?.contributions?.length ?? st.people;
    const scopeChip = g.scope === 'personal' ? <Ui as="span" className={"chip tone-new sm"}>{icon('sprout')}{"自主目标"}{!g.parentId && g.alignId && getGoal(g.alignId) ? ` · 挂靠「${esc(getGoal(g.alignId).title)}」` : ''}</Ui> : !g.parentId ? <Ui as="span" className={"chip tone-brand sm"}>{icon('crown')}{"公司目标"}</Ui> : '';
    return <Ui as="div" className={"page goal-page"}>{"\n      "}{breadcrumb(g)}{"\n      "}<Ui as="section" className={`goal-head tone-${st.status}`} data-key={`gh-${esc(g.id)}`} key={`gh-${esc(g.id)}`} {...flashAttr(g.id)}>{"\n        "}<Ui as="div" className={"gh-main"}>{"\n          "}<Ui as="div" className={"gh-tags"}>{scopeChip}<Ui as="span" className={"chip tone-muted sm"}>{icon(g.kind === 'action' ? 'square-check-big' : 'target')}{kindLabel(g)}</Ui>{statusChip(st)}{flags(st)}{g.context ? <Ui as="span" className={"chip tone-quiet sm"}>{icon('eye')}{"上层目标，仅供了解方向"}</Ui> : ''}</Ui>{"\n          "}<Ui as="h1">{esc(g.title)}</Ui>{"\n          "}{headline(g)}{"\n          "}{bar(st, {
            size: 'lg'
          })}{"\n          "}{g.note ? <Ui as="p" className={"gh-note"}>{icon('info')}{esc(g.note)}</Ui> : ''}{"\n        "}</Ui>{"\n        "}<Ui as="div" className={"gh-side"}>{ring(st, 112)}<Ui as="div" className={"gh-facts"}>{"\n          "}{st.childCount ? <Ui as="span"><Ui as="b">{st.childCount}</Ui>{"条路径"}</Ui> : ''}{"\n          "}<Ui as="span"><Ui as="b">{st.people}</Ui>{"人参与"}</Ui>{"\n          "}<Ui as="span"><Ui as="b">{st.lastDate ? (d => d <= 0 ? '今天' : d === 1 ? '昨天' : `${d} 天前`)(daysSince(st.lastDate)) : '—'}</Ui>{"最近进展"}</Ui>{"\n        "}</Ui></Ui>{"\n        "}{roles(g)}{"\n        "}{actionBar(g)}{"\n      "}</Ui>{"\n      "}<Ui as="nav" className={"tabs"} role={"tablist"} aria-label={"目标详情"}>{"\n        "}<Ui as="a" role={"tab"} href={`#/g/${esc(g.id)}/path`} className={tab === 'path' ? 'on' : ''} aria-selected={tab === 'path'}>{icon('git-fork')}{"拆解路径"}{st.childCount ? <Ui as="small">{st.childCount}</Ui> : ''}</Ui>{"\n        "}<Ui as="a" role={"tab"} href={`#/g/${esc(g.id)}/people`} className={tab === 'people' ? 'on' : ''} aria-selected={tab === 'people'}>{icon('users')}{"成员"}<Ui as="small">{peopleCount}</Ui></Ui>{"\n        "}<Ui as="a" role={"tab"} href={`#/g/${esc(g.id)}/feed`} className={tab === 'feed' ? 'on' : ''} aria-selected={tab === 'feed'}>{icon('activity')}{"动态"}{s.events.some(e => e.fresh && Date.now() - e.fresh < 8000) ? <Ui as="i" className={"new-dot"} /> : ''}</Ui>{"\n      "}</Ui>{"\n      "}<Ui as="div" className={"tab-body"} data-key={`tab-${tab}`} key={`tab-${tab}`}>{tab === 'people' ? peopleTab(g) : tab === 'feed' ? feedTab(g) : pathTab(g)}</Ui>{"\n    "}</Ui>;
  },
  actions: {
    filter: (el, e, ctx) => {
      s.filter = el.dataset.filter;
      s.limit = PAGE;
      ctx.refresh();
    },
    mode: (el, e, ctx) => {
      s.mode = el.dataset.mode;
      ctx.refresh();
    },
    'more-rows': (el, e, ctx) => {
      s.limit += PAGE;
      ctx.refresh();
    },
    'more-events': async (el, e, ctx) => {
      if (!s.next || s.loadingMore) return;
      s.loadingMore = true;
      ctx.refresh();
      try {
        const {
          items,
          next
        } = await get(`/api/events?goal=${encodeURIComponent(s.id)}&subtree=1&limit=20&before=${s.next}`);
        const known = new Set(s.events.map(x => x.seq));
        s.events = [...s.events, ...items.filter(x => !known.has(x.seq))];
        s.next = next;
      } finally {
        s.loadingMore = false;
        ctx.refresh();
      }
    },
    'send-comment': async (el, e, ctx) => {
      const box = el.closest('form').querySelector('textarea');
      const note = box.value.trim();
      if (!note) {
        box.focus();
        return;
      }
      busy(el);
      try {
        await mutate('POST', `/api/goals/${encodeURIComponent(el.dataset.id)}/checkins`, {
          id: uid('c'),
          note
        });
        box.value = '';
        toast('已发送');
        await loadEvents();
        ctx.refresh();
      } catch (error) {
        toast(esc(error.message), 'error');
      } finally {
        busy(el, false);
      }
    },
    'mark-done': async (el, e, ctx) => {
      try {
        await mutate('POST', `/api/goals/${encodeURIComponent(el.dataset.id)}/done`, {
          done: true
        });
        toast('已标记完成，干得漂亮');
      } catch (error) {
        toast(esc(error.message), 'error');
      }
    }
  }
};
export { isAdmin };

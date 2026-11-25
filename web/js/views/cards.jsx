import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 目标在各处的展示形态：卡片（首页）、拆解行（目标页）、大纲（全部层级）、成员统计。
import { store, goal as getGoal, person, children, ancestors, isRecent, departmentName } from "../store.js";
import { esc, icon, num, pct, bar, statusChip, flags, leafSummary, avatar, avatarStack, relTime, shortDate, ring, STATUS, daysSince } from "../ui.jsx";
const RANK = {
  risk: 0,
  watch: 1,
  ok: 2,
  neutral: 3,
  upcoming: 4,
  done: 5
};
export function attention(g) {
  const s = g.stat || {};
  return (s.signal === 'help' && s.status !== 'done' ? -2 : 0) + (RANK[s.status] ?? 3) + (s.stale ? -0.5 : 0) + (s.leaf?.risk ? -0.3 : 0);
}
export const byAttention = (a, b) => attention(a) - attention(b) || (a.sort ?? 0) - (b.sort ?? 0) || a.createdAt.localeCompare(b.createdAt);
export const needsCare = g => g.stat && g.stat.status !== 'done' && (['risk', 'watch'].includes(g.stat.status) || g.stat.signal === 'help' || g.stat.stale || g.stat.leaf?.risk > 0 || g.stat.leaf?.help > 0);
export function flashAttr(id) {
  return isRecent(id) ? {
    'data-flash': store.recent.get(id)
  } : {};
}
export function pathText(g, {
  includeSelf = false,
  max = 3
} = {}) {
  const chain = [...ancestors(g), ...(includeSelf ? [g] : [])];
  if (!chain.length) return g.scope === 'personal' ? g.alignId && getGoal(g.alignId) ? `自主目标 · 挂靠「${esc(getGoal(g.alignId).title)}」` : '自主目标' : '公司目标';
  const names = chain.map(x => esc(x.title));
  if (names.length > max) return <>{names[0]}{" › … › "}{joinNodes(names.slice(-(max - 1)), ' › ')}</>;
  return joinNodes(names, ' › ');
}
export function numbers(g, {
  big = false
} = {}) {
  const s = g.stat;
  if (!s) return '';
  if (g.kind === 'measure') {
    if (!(g.target > 0)) return <Ui as="div" className={"nums"}><Ui as="b">{num(s.value)}</Ui><Ui as="small">{esc(g.unit)}</Ui></Ui>;
    return <Ui as="div" className={"nums"}><Ui as="b">{num(s.value)}</Ui><Ui as="small">{"/ "}{num(g.target)}{" "}{esc(g.unit)}</Ui><Ui as="em" className={`pct t-${s.completion ? STATUS[s.status]?.tone || 'muted' : 'muted'}`}>{pct(s.completion)}</Ui></Ui>;
  }
  if (s.childCount) return <Ui as="div" className={"nums"}><Ui as="b">{s.leaf.done}</Ui><Ui as="small">{"/ "}{s.leaf.total}{" 项完成"}</Ui><Ui as="em" className={`pct t-${STATUS[s.status]?.tone || 'muted'}`}>{pct(s.completion)}</Ui></Ui>;
  if (g.doneAt) return <Ui as="div" className={"nums"}><Ui as="b" className={"t-done"}>{"已完成"}</Ui>{big ? <Ui as="small">{shortDate(g.doneAt.slice(0, 10))}</Ui> : ''}</Ui>;
  return <Ui as="div" className={"nums"}><Ui as="b">{s.status === 'risk' ? '已超期' : s.status === 'upcoming' ? '未开始' : `还剩 ${s.daysLeft} 天`}</Ui><Ui as="small">{"截止 "}{shortDate(g.endDate)}</Ui></Ui>;
}
function updated(g) {
  if (g.doneAt) {
    const gap = daysSince(g.doneAt.slice(0, 10));
    return <Ui as="span" className={"muted"}>{gap <= 0 ? '今天' : gap === 1 ? '昨天' : `${gap} 天前`}{"完成"}</Ui>;
  }
  const last = g.stat?.lastDate;
  if (!last) return <Ui as="span" className={"muted"}>{"还没有进展"}</Ui>;
  const gap = daysSince(last);
  return <Ui as="span" className={"muted"}>{gap <= 0 ? '今天' : gap === 1 ? '昨天' : `${gap} 天前`}{"有进展"}</Ui>;
}

// 首页 / 个人页的目标卡片
export function goalCard(g, {
  showPath = true,
  showOwner = false,
  quick = true
} = {}) {
  const s = g.stat || {};
  const tone = STATUS[s.status]?.tone || 'muted';
  // 数字目标达标后还能继续累计（例如 GMV 超额），所以只有“做完就行”的目标完成后才不再记
  const canRecord = quick && g.perms.checkin && !s.childCount && !g.doneAt && (g.kind === 'measure' || s.status !== 'done');
  const canSplit = quick && !canRecord && g.perms.child && s.childCount === 0 && g.kind === 'measure' && s.status !== 'done';
  return <Ui as="article" className={`gcard tone-${tone}`} data-key={`gc-${esc(g.id)}`} key={`gc-${esc(g.id)}`} {...flashAttr(g.id)}>{"\n    "}<Ui as="a" className={"cover"} href={`#/g/${esc(g.id)}`} aria-label={`打开「${esc(g.title)}」`} />{"\n    "}{showPath ? <Ui as="div" className={"gc-path"}>{icon(g.scope === 'personal' && !g.parentId ? 'sprout' : 'goal')}<Ui as="span">{pathText(g)}</Ui></Ui> : ''}{"\n    "}<Ui as="div" className={"gc-head"}><Ui as="h3">{esc(g.title)}</Ui>{statusChip(s, {
        small: true
      })}</Ui>{"\n    "}{numbers(g)}{"\n    "}{bar(s)}{"\n    "}<Ui as="div" className={"gc-foot"}>{"\n      "}{flags(s, {
        compact: true
      })}{"\n      "}{s.childCount ? <Ui as="span" className={"muted"}>{leafSummary(s)}</Ui> : ''}{"\n      "}{showOwner ? <Ui as="span" className={"who"}>{avatar(g.ownerId, 'xs')}{esc(person(g.ownerId).name)}</Ui> : g.memberIds.length ? <Ui as="span" className={"who"}>{avatarStack([g.ownerId, ...g.memberIds], 4)}</Ui> : ''}{"\n      "}<Ui as="span" className={"grow"} />{"\n      "}{!s.childCount && !flags(s) ? updated(g) : ''}{"\n      "}{canRecord ? <Ui as="button" type={"button"} className={"btn soft sm lift"} data-act={"checkin"} data-id={esc(g.id)}>{icon('pencil')}{"记一笔"}</Ui> : ''}{"\n      "}{canSplit ? <Ui as="button" type={"button"} className={"btn ghost sm lift"} data-act={"split"} data-id={esc(g.id)}>{icon('git-fork')}{"拆给成员"}</Ui> : ''}{"\n    "}</Ui>{"\n  "}</Ui>;
}

// 目标页的“下一层”行
export function childRow(g, parent) {
  const s = g.stat || {};
  const tone = STATUS[s.status]?.tone || 'muted';
  const share = parent && parent.kind === 'measure' && g.kind === 'measure' && g.unit === parent.unit && parent.target > 0 && g.target > 0 ? g.target / parent.target : null;
  const people = [g.ownerId, ...g.memberIds];
  const sub = joinNodes([`${esc(person(g.ownerId).name)}${g.memberIds.length ? ` 等 ${people.length} 人` : ''}`, s.childCount ? leafSummary(s) : '', share !== null ? `占上级 ${pct(share)}` : parent && g.kind === 'measure' && parent.kind === 'measure' && g.unit !== parent.unit ? '辅助指标' : '', g.scope === 'personal' && !parent ? '自主目标' : ''].filter(Boolean), ' · ');
  return <Ui as="article" className={`crow tone-${tone}`} data-key={`cr-${esc(g.id)}`} key={`cr-${esc(g.id)}`} {...flashAttr(g.id)}>{"\n    "}<Ui as="a" className={"cover"} href={`#/g/${esc(g.id)}`} aria-label={`下探到「${esc(g.title)}」`} />{"\n    "}<Ui as="div" className={"crow-who"}>{avatar(g.ownerId, 'md')}{g.memberIds.length ? <Ui as="em">{"+"}{g.memberIds.length}</Ui> : ''}</Ui>{"\n    "}<Ui as="div" className={"crow-main"}>{"\n      "}<Ui as="div" className={"crow-title"}><Ui as="b">{esc(g.title)}</Ui>{statusChip(s, {
          small: true
        })}{flags(s, {
          compact: true
        })}</Ui>{"\n      "}<Ui as="div" className={"crow-meta"}>{sub}</Ui>{"\n      "}{bar(s, {
        size: 'sm'
      })}{"\n    "}</Ui>{"\n    "}<Ui as="div" className={"crow-num"}>{numbers(g)}</Ui>{"\n    "}<Ui as="span" className={"chev"}>{icon('chevron-right')}</Ui>{"\n  "}</Ui>;
}

// 全部层级：一屏看清整条拆解路径
export function outline(rootGoal, {
  depth = 0,
  budget = {
    n: 0
  }
} = {}) {
  const kids = children(rootGoal.id);
  return joinNodes(kids.map(g => {
    if (budget.n++ > 400) return '';
    const s = g.stat || {};
    const tone = STATUS[s.status]?.tone || 'muted';
    const sub = children(g.id);
    const row = <Ui as="span" className={"ol-row"} style={{
      "--d": depth
    }}>{"\n        "}{sub.length ? <Ui as="span" className={"ol-caret"}>{icon('chevron-right')}</Ui> : <Ui as="span" className={"ol-dot"} />}{"\n        "}{avatar(g.ownerId, 'xs')}<Ui as="a" href={`#/g/${esc(g.id)}`} className={"ol-title"}>{esc(g.title)}</Ui>{"\n        "}{s.signal === 'help' && s.status !== 'done' ? <Ui as="span" className={"chip tone-help sm"}>{icon('life-buoy')}</Ui> : ''}{s.stale ? <Ui as="span" className={"chip tone-quiet sm"} title={"很久没更新"}>{icon('clock')}</Ui> : ''}{"\n        "}<Ui as="span" className={"ol-bar"}>{bar(s, {
          size: 'xs'
        })}</Ui><Ui as="span" className={`ol-pct t-${tone}`}>{s.completion === null ? '—' : pct(s.completion)}</Ui><Ui as="i" className={`dot tone-${tone}`} title={STATUS[s.status]?.label || ''} />{"\n      "}</Ui>;
    if (!sub.length) return <Ui as="div" className={"ol-node leaf"} data-key={`ol-${esc(g.id)}`} key={`ol-${esc(g.id)}`} {...flashAttr(g.id)}>{row}</Ui>;
    return <Ui as="details" className={"ol-node"} open={depth < 1} data-keep={""} data-key={`ol-${esc(g.id)}`} key={`ol-${esc(g.id)}`} {...flashAttr(g.id)}><Ui as="summary">{row}</Ui>{outline(g, {
        depth: depth + 1,
        budget
      })}</Ui>;
  }), '');
}

// 北极星卡片（目标地图）
export function northStar(g) {
  const s = g.stat || {};
  const tone = STATUS[s.status]?.tone || 'muted';
  return <Ui as="article" className={`star tone-${tone}`} data-key={`ns-${esc(g.id)}`} key={`ns-${esc(g.id)}`} {...flashAttr(g.id)}>{"\n    "}<Ui as="a" className={"cover"} href={`#/g/${esc(g.id)}`} aria-label={`下探「${esc(g.title)}」`} />{"\n    "}<Ui as="div" className={"star-top"}>{ring(s, 72)}<Ui as="div" className={"star-title"}><Ui as="h3">{esc(g.title)}</Ui><Ui as="p">{avatar(g.ownerId, 'xs')}{esc(person(g.ownerId).name)}{" 负责 · "}{shortDate(g.startDate)}{"–"}{shortDate(g.endDate)}</Ui></Ui></Ui>{"\n    "}{numbers(g)}{"\n    "}{bar(s)}{"\n    "}<Ui as="div" className={"star-foot"}>{statusChip(s, {
        small: true
      })}{s.leaf?.help ? <Ui as="span" className={"chip tone-help sm"}>{icon('life-buoy')}{s.leaf.help}{" 需要支持"}</Ui> : ''}{s.leaf?.risk ? <Ui as="span" className={"chip tone-risk sm"}>{icon('triangle-alert')}{s.leaf.risk}{" 项落后"}</Ui> : ''}{"\n      "}<Ui as="span" className={"grow"} /><Ui as="span" className={"muted"}>{s.childCount ? `${s.leaf.total} 项 · ${s.people} 人` : '还没拆解'}</Ui></Ui>{"\n    "}{g.context ? <Ui as="p" className={"ctx-note"}>{icon('eye')}{"你在这条路径上，所以能看到它的全貌"}</Ui> : ''}{"\n  "}</Ui>;
}

// 某个人关联的目标与状态（只基于你能看到的目标）
export function personSummary(id) {
  const list = [...store.goals.values()];
  const owned = list.filter(g => g.ownerId === id);
  const joined = list.filter(g => g.memberIds.includes(id) && g.ownerId !== id);
  const linked = [...owned, ...joined];
  const active = linked.filter(g => g.stat && g.stat.status !== 'done');
  const count = st => linked.filter(g => g.stat?.status === st).length;
  const help = active.filter(g => g.stat.signal === 'help').length;
  const stale = active.filter(g => g.stat.stale && g.ownerId === id).length;
  const last = linked.map(g => g.stat?.ownLast).filter(Boolean).sort().pop() || null;
  // 只负责上层目标的人自己不直接记进展，用下层路径的最近进展代替
  const pathLast = last ? null : owned.filter(g => g.stat?.childCount).map(g => g.stat.lastDate).filter(Boolean).sort().pop() || null;
  const worst = help ? 'help' : count('risk') ? 'risk' : count('watch') ? 'watch' : stale ? 'stale' : linked.length ? count('done') === linked.length ? 'done' : 'ok' : 'none';
  return {
    owned,
    joined,
    linked,
    risk: count('risk'),
    watch: count('watch'),
    ok: count('ok'),
    done: count('done'),
    help,
    stale,
    last,
    pathLast,
    worst
  };
}
export function worstChip(summary) {
  const map = {
    help: ['tone-help', 'life-buoy', '需要支持'],
    risk: ['tone-risk', 'triangle-alert', `${summary.risk} 项落后`],
    watch: ['tone-watch', 'hourglass', `${summary.watch} 项稍慢`],
    stale: ['tone-quiet', 'clock', `${summary.stale} 项没更新`],
    ok: ['tone-ok', 'sun', '都顺利'],
    done: ['tone-done', 'party-popper', '全部达成'],
    none: ['tone-muted', 'circle-dot', '暂无目标']
  };
  const [tone, ic, label] = map[summary.worst];
  return <Ui as="span" className={`chip ${tone} sm`}>{icon(ic)}{label}</Ui>;
}
export function statusDots(goals, max = 10) {
  const list = [...goals].sort(byAttention).slice(0, max);
  return <Ui as="span" className={"dots"}>{joinNodes(list.map(g => <Ui as="i" className={`dot tone-${STATUS[g.stat?.status]?.tone || 'muted'}`} title={`${esc(g.title)}：${STATUS[g.stat?.status]?.label || ''}`} />), '')}{goals.length > max ? <Ui as="small">{"+"}{goals.length - max}</Ui> : ''}</Ui>;
}
function dayWord(date) {
  const gap = daysSince(date);
  return gap <= 0 ? '今天' : gap === 1 ? '昨天' : `${gap} 天前`;
}
export function lastText(date, sum) {
  if (date) return `${dayWord(date)}有更新`;
  if (sum?.pathLast) return `下层${dayWord(sum.pathLast)}有进展`;
  if (sum && !sum.linked.length) return '';
  return '还没记过进展';
}
export function section(title, count, body, {
  action = '',
  id = '',
  hint = ''
} = {}) {
  return <Ui as="section" className={"sec"} {...id ? ` id="${id}"` : ''} data-key={`sec-${esc(id || title)}`} key={`sec-${esc(id || title)}`}><Ui as="header" className={"sec-head"}><Ui as="h2">{title}{count !== null && count !== undefined ? <Ui as="small">{count}</Ui> : ''}</Ui>{hint ? <Ui as="p" className={"sec-hint"}>{hint}</Ui> : ''}{action}</Ui>{body}</Ui>;
}
export { departmentName, relTime };

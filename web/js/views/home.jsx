import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// “我的”：打开就知道三件事——我和哪些公司目标有关、哪些要我动手、刚刚发生了什么。
import { store, rootOf, isLead, isAdmin, teamSet, person } from "../store.js";
import { esc, icon, greeting, avatar, avatarStack, emptyState, relTime, shortDate } from "../ui.jsx";
import { goalCard, byAttention, section, personSummary, needsCare, worstChip } from "./cards.jsx";
import { awaySummary, ticker } from "./feed.jsx";
import { assistantCard } from "./insights.jsx";
const expanded = new Set();
const MAX = 6;
const isPersonalRoot = g => g.scope === 'personal' && !g.parentId;
function lists() {
  const me = store.me.id;
  const all = [...store.goals.values()];
  const owned = all.filter(g => g.ownerId === me && !isPersonalRoot(g)).sort(byAttention);
  const joined = all.filter(g => g.memberIds.includes(me) && !isPersonalRoot(g)).sort(byAttention);
  const personal = all.filter(g => isPersonalRoot(g) && (g.ownerId === me || g.memberIds.includes(me))).sort(byAttention);
  return {
    owned,
    joined,
    personal
  };
}
function summaryLine({
  owned,
  joined,
  personal
}) {
  const linked = [...owned, ...joined, ...personal];
  if (!linked.length) return '你还没有关联的目标。可以去目标地图找一个想参与的，或者先发起一个自主目标。';
  const c = st => linked.filter(g => g.stat?.status === st).length;
  const me = store.me.id;
  const open = g => g.stat && g.stat.status !== 'done' && !g.doneAt;
  const stale = linked.filter(g => open(g) && g.stat.stale && g.ownerId === me).length;
  const staleOther = linked.filter(g => open(g) && g.stat.stale && g.ownerId !== me).length;
  const help = linked.filter(g => g.stat?.signal === 'help' && g.stat.status !== 'done').length;
  const leafRisk = owned.filter(g => open(g) && g.stat.childCount && g.stat.leaf?.risk).reduce((n, g) => n + g.stat.leaf.risk, 0);
  const parts = joinNodes([c('ok') ? `${c('ok')} 个顺利` : '', c('watch') ? `${c('watch')} 个稍慢` : '', c('risk') ? `${c('risk')} 个落后` : '', c('done') ? `${c('done')} 个已达成` : '', c('upcoming') ? `${c('upcoming')} 个还没开始` : ''].filter(Boolean), '、');
  const upcoming = linked.filter(g => g.stat?.status === 'upcoming');
  let nudge = '节奏不错，继续保持。';
  if (upcoming.length && upcoming.length === linked.filter(g => g.stat && g.stat.status !== 'done').length) {
    const first = upcoming.map(g => g.startDate).sort()[0];
    nudge = `新周期从 ${shortDate(first)} 开始，现在正好把拆解路径和份额理顺。`;
  }
  if (stale) nudge = `有 ${stale} 个超过 ${store.settings.staleDays} 天没记进展，花半分钟记一笔吧。`;else if (c('risk')) nudge = '落后的那个，可以在“记一笔”里选“需要支持”，让上级和协作者一起想办法。';else if (help) nudge = `你点过“需要支持”的 ${help} 个目标，大家都看得到。`;else if (c('watch')) nudge = '稍慢的可以点进去看看拆解路径，找到拖慢节奏的那一条。';else if (leafRisk) nudge = `你负责的路径下有 ${leafRisk} 项落后，点进去看看是哪一条。`;else if (staleOther) nudge = `有 ${staleOther} 个你参与的目标很久没人记进展，可以顺手记一笔，或提醒一下负责人。`;
  return <>{"你关联了 "}<Ui as="b">{linked.length}</Ui>{" 个目标"}{parts ? <>{"："}{parts}</> : ''}{"。"}{nudge}</>;
}
function rootChips({
  owned,
  joined,
  personal
}) {
  const roots = new Map();
  for (const g of [...owned, ...joined]) {
    const r = rootOf(g);
    if (r.scope === 'company') roots.set(r.id, r);
  }
  for (const g of personal) if (g.alignId && store.goals.get(g.alignId)) {
    const r = rootOf(store.goals.get(g.alignId));
    roots.set(r.id, r);
  }
  if (!roots.size) return '';
  return <Ui as="div" className={"roots"}><Ui as="span" className={"muted"}>{"你在为这些公司目标出力"}</Ui>{joinNodes([...roots.values()].map(r => <Ui as="a" className={`root-chip tone-${r.stat?.status === 'done' ? 'done' : r.stat?.status || 'muted'}`} href={`#/g/${esc(r.id)}`}><Ui as="i" className={"dot"} />{esc(r.title)}</Ui>), '')}</Ui>;
}
function awayStrip() {
  const a = awaySummary();
  if (!a) return '';
  const bits = joinNodes([a.progress ? `${a.progress} 条新进展` : '', a.created ? `${a.created} 个新目标` : '', a.achieved ? <Ui as="b" className={"t-done"}>{a.achieved}{" 个达成"}</Ui> : '', a.help ? <Ui as="b" className={"t-help"}>{a.help}{" 处需要支持"}</Ui> : '', a.comments ? `${a.comments} 条留言` : ''].filter(Boolean), ' · ');
  return <Ui as="a" className={"away"} href={"#/pulse"} data-key={"away"} key={"away"}>{icon('history')}<Ui as="span"><Ui as="b">{"你不在的时候"}{a.since ? `（${relTime(a.since)}以来）` : ''}</Ui>{a.people}{" 位同事带来了 "}{bits}{a.more ? '等' : ''}</Ui>{icon('arrow-right')}</Ui>;
}
function handoverStrip() {
  if (!isAdmin()) return '';
  const n = [...store.goals.values()].filter(g => !person(g.ownerId).active).length;
  if (!n) return '';
  return <Ui as="a" className={"away warn"} href={"#/admin/members?show=inactive"} data-key={"handover"} key={"handover"}>{icon('move-right')}<Ui as="span"><Ui as="b">{"有 "}{n}{" 个目标等待交接"}</Ui>{"负责人账号已停用（多为旧版的演示角色），交给在职同事后才有人继续推进"}</Ui>{icon('arrow-right')}</Ui>;
}
function cheersLine() {
  const recent = (store.cheersReceived || []).filter(c => Date.now() - Date.parse(c.at) < 3 * 86400000);
  if (!recent.length) return '';
  const ids = [...new Set(recent.map(c => c.userId))];
  return <Ui as="div" className={"cheers-line"} data-key={"cheers"} key={"cheers"}>{icon('heart')}{avatarStack(ids, 5)}<Ui as="span">{joinNodes(ids.slice(0, 2).map(id => esc(person(id).name)), '、')}{ids.length > 2 ? ` 等 ${ids.length} 人` : ''}{" 最近给你的进展点了赞"}</Ui></Ui>;
}
function onboarding({
  owned,
  joined
}) {
  if (store.onboarded) return '';
  const first = [...owned, ...joined].find(g => g.perms.checkin && !g.stat.childCount && !g.doneAt);
  return <Ui as="section" className={"onboard"} data-key={"onboard"} key={"onboard"}>{"\n    "}<Ui as="img" src={"/assets/brand/ip-full.webp"} alt={""} width={"150"} height={"152"} />{"\n    "}<Ui as="div"><Ui as="h2">{"欢迎来到锅气家族目标共创台"}</Ui><Ui as="p">{"这里没有考核表，只有大家一起往前推的目标。三步就会用："}</Ui>{"\n      "}<Ui as="ol">{"\n        "}<Ui as="li"><Ui as="b">{"1"}</Ui><Ui as="span">{"看看下面的卡片："}<Ui as="em">{"每张卡片顶上写着它属于哪个公司目标"}</Ui>{"，你的努力会一路汇总上去。"}</Ui></Ui>{"\n        "}<Ui as="li"><Ui as="b">{"2"}</Ui><Ui as="span">{"有进展就点 "}<Ui as="em">{"记一笔"}</Ui>{"，只填这次新增的数字，一句话说明可写可不写。"}</Ui>{first ? <Ui as="button" type={"button"} className={"btn soft sm"} data-act={"checkin"} data-id={esc(first.id)}>{icon('pencil')}{"试着记第一笔"}</Ui> : ''}</Ui>{"\n        "}<Ui as="li"><Ui as="b">{"3"}</Ui><Ui as="span">{"想到能带来增长的新点子，点 "}<Ui as="em">{"新建"}</Ui>{"，挂在任何你参与的目标下面，大家会实时看到。"}</Ui><Ui as="button" type={"button"} className={"btn ghost sm"} data-act={"new-goal"}>{icon('plus')}{"新建一个"}</Ui></Ui>{"\n      "}</Ui>{"\n      "}<Ui as="button" type={"button"} className={"btn primary"} data-act={"onboard-done"}>{icon('check')}{"知道了，开始用"}</Ui></Ui>{"\n  "}</Ui>;
}
function teamGlance() {
  if (!isLead()) return '';
  const team = [...teamSet()].map(id => person(id)).filter(p => p.active);
  if (!team.length) return '';
  const rows = team.map(p => ({
    p,
    s: personSummary(p.id)
  }));
  const care = rows.filter(r => ['help', 'risk', 'stale', 'watch'].includes(r.s.worst));
  const order = {
    help: 0,
    risk: 1,
    stale: 2,
    watch: 3
  };
  care.sort((a, b) => order[a.s.worst] - order[b.s.worst]);
  const count = key => rows.filter(r => r.s[key] > 0).length;
  return <Ui as="section" className={"glance"} data-key={"glance"} key={"glance"}><Ui as="header" className={"sec-head"}><Ui as="h2">{isAdmin() ? '团队与组织' : '我的团队'}<Ui as="small">{team.length}{" 人"}</Ui></Ui><Ui as="a" className={"link"} href={"#/team"}>{"看全部 "}{icon('arrow-right')}</Ui></Ui>{"\n    "}<Ui as="div" className={"glance-stats"}>{"\n      "}<Ui as="span"><Ui as="b">{rows.filter(r => r.s.worst === 'ok' || r.s.worst === 'done').length}</Ui>{"人都顺利"}</Ui>{"\n      "}<Ui as="span" className={"t-watch"}><Ui as="b">{count('watch')}</Ui>{"人有稍慢"}</Ui>{"\n      "}<Ui as="span" className={"t-risk"}><Ui as="b">{count('risk')}</Ui>{"人有落后"}</Ui>{"\n      "}<Ui as="span" className={"t-help"}><Ui as="b">{count('help')}</Ui>{"人需要支持"}</Ui>{"\n      "}<Ui as="span" className={"t-quiet"}><Ui as="b">{count('stale')}</Ui>{"人很久没更新"}</Ui>{"\n    "}</Ui>{"\n    "}{care.length ? <Ui as="div" className={"glance-list"}>{joinNodes(care.slice(0, 4).map(({
        p,
        s
      }) => <Ui as="a" className={"glance-row"} href={`#/p/${p.id}`} data-key={`gl-${p.id}`} key={`gl-${p.id}`}>{avatar(p.id, 'sm')}<Ui as="span" className={"grow"}><Ui as="b">{esc(p.name)}</Ui><Ui as="small">{esc(p.title || p.dept)}</Ui></Ui>{worstChip(s)}</Ui>), '')}</Ui> : <Ui as="p" className={"muted"}>{"团队节奏都不错，去动态里给大家点个赞吧。"}</Ui>}{"\n  "}</Ui>;
}
function list(key, goals, emptyHtml) {
  if (!goals.length) return emptyHtml;
  const open = expanded.has(key);
  const shown = open ? goals : goals.slice(0, MAX);
  return <><Ui as="div" className={"grid"}>{joinNodes(shown.map(g => goalCard(g)), '')}</Ui>{goals.length > MAX ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"toggle-list"} data-list={key}>{open ? <>{icon('chevron-up')}{"收起"}</> : <>{icon('chevron-down')}{"展开全部 "}{goals.length}{" 个"}</>}</Ui> : ''}</>;
}
export default {
  title: () => '我的',
  render() {
    const data = lists();
    const me = person(store.me.id);
    const first = me.name.length > 2 && /^[\u4e00-\u9fa5]+$/.test(me.name) ? me.name.slice(-2) : me.name;
    const linkedAll = [...data.owned, ...data.joined, ...data.personal];
    const careCount = linkedAll.filter(needsCare).length;
    const openAll = linkedAll.filter(g => g.stat && g.stat.status !== 'done');
    const allUpcoming = openAll.length > 0 && openAll.every(g => g.stat.status === 'upcoming');
    return <>{"\n    "}<Ui as="div" className={"page home"}>{"\n      "}<Ui as="section" className={"hero"} data-key={"hero"} key={"hero"}>{"\n        "}<Ui as="div" className={"hero-text"}>{"\n          "}<Ui as="p" className={"eyebrow"}>{greeting()}{"，"}{esc(first)}</Ui>{"\n          "}<Ui as="h1">{careCount ? `今天有 ${careCount} 件事值得看一眼` : allUpcoming ? '新周期就要开跑了' : '今天节奏不错'}</Ui>{"\n          "}<Ui as="p" className={"lead"}>{summaryLine(data)}</Ui>{"\n          "}{rootChips(data)}{"\n        "}</Ui>{"\n        "}<Ui as="img" className={"hero-ip"} src={"/assets/brand/ip-happy.webp"} alt={""} width={"190"} height={"154"} />{"\n        "}<Ui as="div" className={"ticker"} aria-live={"off"}><Ui as="span" className={"ticker-label"}><Ui as="i" className={"live-dot live"} />{"刚刚"}</Ui><Ui as="div" className={"ticker-track"}>{ticker(1) || <Ui as="span" className={"muted"}>{"等第一条进展出现…"}</Ui>}</Ui><Ui as="a" className={"link"} href={"#/pulse"}>{"全部动态"}</Ui></Ui>{"\n      "}</Ui>{"\n      "}{awayStrip()}{"\n      "}{handoverStrip()}{"\n      "}{cheersLine()}{"\n      "}{onboarding(data)}{"\n      "}{section('我负责的', data.owned.length, list('owned', data.owned, <Ui as="div" className={"soft-empty"}>{icon('target')}<Ui as="span">{"还没有分配给你的目标。负责人把目标拆给你之后，会第一时间出现在这里。"}</Ui></Ui>), {
          id: 'owned',
          hint: '按需要关注的程度排序'
        })}{"\n      "}{data.joined.length ? section('我参与的', data.joined.length, list('joined', data.joined, ''), {
          id: 'joined',
          hint: '你是协作者，可以一起记进展'
        }) : ''}{"\n      "}{section('我的自主目标', data.personal.length, list('personal', data.personal, <Ui as="div" className={"soft-empty"}>{icon('sprout')}<Ui as="span">{"自主目标是你自己想推进的事：可以挂靠到公司目标表明方向，进度自己维护，不计入公司汇总。"}</Ui></Ui>), {
          id: 'personal',
          action: <Ui as="button" type={"button"} className={"btn soft sm"} data-act={"new-goal"} data-scope={"personal"}>{icon('plus')}{"发起自主目标"}</Ui>
        })}{"\n      "}{teamGlance()}{"\n      "}{isLead() ? assistantCard({
          limit: 3,
          compact: true
        }) : ''}{"\n      "}{!data.owned.length && !data.joined.length && !data.personal.length ? emptyState({
          image: 'ip-think',
          title: '先找到你的第一个目标',
          text: '去目标地图看看公司在推进什么，找到想出力的目标点“加入协作”；或者直接发起一个自主目标。',
          action: <Ui as="a" className={"btn primary"} href={"#/map"}>{"打开目标地图"}</Ui>
        }) : ''}{"\n    "}</Ui></>;
  },
  actions: {
    'toggle-list': (el, event, ctx) => {
      const key = el.dataset.list;
      expanded.has(key) ? expanded.delete(key) : expanded.add(key);
      ctx.refresh();
    }
  }
};

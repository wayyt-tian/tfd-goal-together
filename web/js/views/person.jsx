import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 个人页：这个人负责什么、参与什么、自己发起了什么，最近在推进什么。
import { get } from "../api.js";
import { store, person, teamSet, isAdmin } from "../store.js";
import { esc, icon, avatar, emptyState } from "../ui.jsx";
import { personSummary, goalCard, byAttention, section, worstChip, lastText } from "./cards.jsx";
import { grouped } from "./feed.jsx";
let s = {
  id: null,
  events: [],
  loaded: false,
  timer: null
};
async function loadEvents(ctx) {
  const id = s.id;
  try {
    const {
      items
    } = await get(`/api/events?person=${id}&limit=12`);
    if (s.id === id) {
      s.events = items;
      s.loaded = true;
    }
  } catch {
    s.loaded = true;
  }
  ctx.refresh();
}
const isPersonalRoot = g => g.scope === 'personal' && !g.parentId;
export default {
  title: params => params.id === store.me.id ? '我的主页' : person(params.id).name,
  enter(params, ctx) {
    if (s.id !== params.id) s = {
      id: params.id,
      events: [],
      loaded: false,
      timer: null
    };
    loadEvents(ctx);
  },
  onStore(kind, params, ctx) {
    if (kind === 'delta' && (store.lastEvents || []).length) {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => loadEvents(ctx), 500);
    }
  },
  render(params) {
    const p = store.people.get(params.id);
    if (!p) return <Ui as="div" className={"page"}>{emptyState({
        image: 'ip-think',
        title: '找不到这位同事',
        action: <Ui as="a" className={"btn primary"} href={"#/"}>{"回到我的"}</Ui>
      })}</Ui>;
    const sum = personSummary(p.id);
    const owned = sum.owned.filter(g => !isPersonalRoot(g)).sort(byAttention);
    const joined = sum.joined.filter(g => !isPersonalRoot(g)).sort(byAttention);
    const personal = sum.linked.filter(isPersonalRoot).sort(byAttention);
    const manager = p.managerId ? person(p.managerId) : null;
    const reports = [...store.people.values()].filter(x => x.active && x.managerId === p.id);
    const self = p.id === store.me.id;
    const limited = !self && !isAdmin() && !teamSet().has(p.id);
    return <Ui as="div" className={"page person-page"}>{"\n      "}<Ui as="section" className={"person-head"} data-key={`ph-${p.id}`} key={`ph-${p.id}`}>{"\n        "}{avatar(p.id, 'xl')}{"\n        "}<Ui as="div" className={"ph-main"}><Ui as="h1">{esc(p.name)}{p.active ? '' : <Ui as="small" className={"muted"}>{"（已离职）"}</Ui>}</Ui>{"\n          "}<Ui as="p" className={"muted"}>{esc(p.title || '成员')}{" · "}{esc(p.dept)}</Ui>{"\n          "}<Ui as="div" className={"ph-rel"}>{manager ? <Ui as="a" href={`#/p/${manager.id}`}>{icon('corner-down-right')}{"汇报给 "}{avatar(manager.id, 'xs')}{esc(manager.name)}</Ui> : ''}{reports.length ? <Ui as="span">{icon('users')}{reports.length}{" 位直属成员"}</Ui> : ''}</Ui></Ui>{"\n        "}<Ui as="div" className={"ph-state"}>{worstChip(sum)}<Ui as="small" className={"muted"}>{lastText(sum.last, sum)}</Ui></Ui>{"\n      "}</Ui>{"\n      "}{limited ? <Ui as="p" className={"scope-note"}>{icon('eye')}{"你只能看到和你相关的目标路径上的内容。"}</Ui> : ''}{"\n      "}<Ui as="div" className={"mini-stats"}>{"\n        "}<Ui as="span"><Ui as="b">{owned.length}</Ui>{"负责"}</Ui><Ui as="span"><Ui as="b">{joined.length}</Ui>{"参与"}</Ui><Ui as="span"><Ui as="b">{personal.length}</Ui>{"自主"}</Ui>{"\n        "}<Ui as="span" className={"t-risk"}><Ui as="b">{sum.risk}</Ui>{"落后"}</Ui><Ui as="span" className={"t-help"}><Ui as="b">{sum.help}</Ui>{"需要支持"}</Ui><Ui as="span" className={"t-done"}><Ui as="b">{sum.done}</Ui>{"已达成"}</Ui>{"\n      "}</Ui>{"\n      "}{section(self ? '我负责的' : 'TA 负责的', owned.length, owned.length ? <Ui as="div" className={"grid"}>{joinNodes(owned.map(g => goalCard(g, {
          quick: self
        })), '')}</Ui> : <Ui as="div" className={"soft-empty"}>{icon('target')}<Ui as="span">{"暂无你能看到的负责目标。"}</Ui></Ui>, {
        id: 'p-owned'
      })}{"\n      "}{joined.length ? section(self ? '我参与的' : 'TA 参与的', joined.length, <Ui as="div" className={"grid"}>{joinNodes(joined.map(g => goalCard(g, {
          quick: self,
          showOwner: true
        })), '')}</Ui>, {
        id: 'p-joined'
      }) : ''}{"\n      "}{personal.length ? section('自主目标', personal.length, <Ui as="div" className={"grid"}>{joinNodes(personal.map(g => goalCard(g, {
          quick: self
        })), '')}</Ui>, {
        id: 'p-personal'
      }) : ''}{"\n      "}{reports.length ? section('直属成员', reports.length, <Ui as="div" className={"person-list"}>{joinNodes(reports.map(r => {
          const rs = personSummary(r.id);
          return <Ui as="a" className={"team-row"} href={`#/p/${r.id}`} data-key={`rp-${r.id}`} key={`rp-${r.id}`}>{avatar(r.id, 'md')}<Ui as="span" className={"tr-name"}><Ui as="b">{esc(r.name)}</Ui><Ui as="small">{esc(r.title || r.dept)}</Ui></Ui><Ui as="span" className={"tr-state"}>{worstChip(rs)}<Ui as="small" className={"muted"}>{lastText(rs.last, rs)}</Ui></Ui>{icon('chevron-right', 'chev')}</Ui>;
        }), '')}</Ui>, {
        id: 'p-reports'
      }) : ''}{"\n      "}{section('最近动态', null, s.loaded ? s.events.length ? grouped(s.events) : <Ui as="div" className={"soft-empty"}>{icon('messages-square')}<Ui as="span">{"最近还没有动态。"}</Ui></Ui> : <Ui as="div" className={"loading"}>{icon('orbit')}{"正在加载…"}</Ui>, {
        id: 'p-feed'
      })}{"\n    "}</Ui>;
  }
};

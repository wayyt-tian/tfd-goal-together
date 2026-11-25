import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 目标地图：最上层只放公司北极星，点进去逐层下探。
import { store, isAdmin, person } from "../store.js";
import { esc, icon, pct, avatar, statusChip, flags, emptyState } from "../ui.jsx";
import { northStar, byAttention, needsCare, pathText, goalCard, section, flashAttr } from "./cards.jsx";
import { ticker } from "./feed.jsx";
import { assistantCard } from "./insights.jsx";
const state = {
  allPersonal: false
};
function careList() {
  const leaves = [...store.goals.values()].filter(g => !g.context && g.stat && !g.stat.childCount && needsCare(g)).sort(byAttention);
  if (!leaves.length) return <Ui as="div" className={"soft-empty ok"}>{icon('sun')}<Ui as="span">{"没有需要特别关注的末端目标，节奏都不错。"}</Ui></Ui>;
  return <><Ui as="div" className={"care-list"}>{joinNodes(leaves.slice(0, 6).map(g => <Ui as="a" className={"care-row"} href={`#/g/${esc(g.id)}`} data-key={`care-${esc(g.id)}`} key={`care-${esc(g.id)}`} {...flashAttr(g.id)}>{"\n    "}{avatar(g.ownerId, 'sm')}<Ui as="span" className={"grow"}><Ui as="b">{esc(g.title)}</Ui><Ui as="small">{esc(person(g.ownerId).name)}{" · "}{pathText(g, {
              max: 2
            })}</Ui></Ui>{"\n    "}<Ui as="span" className={"care-flags"}>{['risk', 'watch'].includes(g.stat.status) ? statusChip(g.stat, {
            small: true
          }) : ''}{flags(g.stat, {
            compact: true
          })}</Ui></Ui>), '')}</Ui>{"\n    "}{leaves.length > 6 ? <Ui as="p" className={"muted small"}>{"还有 "}{leaves.length - 6}{" 项，可以在各目标的“需要关注”里查看。"}</Ui> : ''}</>;
}
export default {
  title: () => '目标地图',
  render() {
    const roots = [...store.goals.values()].filter(g => !g.parentId && g.scope === 'company').sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
    const personal = [...store.goals.values()].filter(g => g.scope === 'personal' && !g.parentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const tp = roots.length ? Math.max(...roots.map(r => r.stat?.timeProgress || 0)) : null;
    const partial = !isAdmin() && store.settings.openness !== 'open';
    return <Ui as="div" className={"page map"}>{"\n      "}<Ui as="header" className={"page-head"} data-key={"head"} key={"head"}>{"\n        "}<Ui as="div"><Ui as="h1">{"目标地图"}</Ui><Ui as="p" className={"lead"}>{"从公司目标开始，一层层点下去，就能看到每条路径上的人、进展和风险。"}</Ui></Ui>{"\n        "}{tp !== null ? <Ui as="div" className={"time-chip"}>{icon('hourglass')}<Ui as="span">{"本期时间已过 "}<Ui as="b">{pct(tp)}</Ui></Ui></Ui> : ''}{"\n      "}</Ui>{"\n      "}<Ui as="div" className={"ticker wide"}><Ui as="span" className={"ticker-label"}><Ui as="i" className={"live-dot live"} />{"刚刚"}</Ui><Ui as="div" className={"ticker-track"}>{ticker(1) || <Ui as="span" className={"muted"}>{"等第一条进展出现…"}</Ui>}</Ui><Ui as="a" className={"link"} href={"#/pulse"}>{"全部动态"}</Ui></Ui>{"\n      "}{partial ? <Ui as="p" className={"scope-note"}>{icon('eye')}{"地图展示与你和你的团队相关的路径；上层目标会完整显示，方便你看清方向。"}</Ui> : ''}{"\n      "}{roots.length ? <Ui as="div" className={"stars"}>{joinNodes(roots.map(northStar), '')}{isAdmin() ? <Ui as="button" type={"button"} className={"star add"} data-act={"new-goal"} data-scope={"company"}>{icon('plus')}<Ui as="b">{"添加公司目标"}</Ui><Ui as="small">{"比如“本月 GMV”“本季度浪花收入”"}</Ui></Ui> : ''}</Ui> : emptyState({
        image: 'ip-think',
        title: '还没有公司目标',
        text: isAdmin() ? '从一个最重要的数字开始，比如“本月 GMV 1000 万元”，再一层层拆给业务和成员。' : '公司负责人设置好公司目标后，这里会出现整张地图。',
        action: isAdmin() ? <Ui as="button" type={"button"} className={"btn primary"} data-act={"new-goal"} data-scope={"company"}>{icon('plus')}{"添加第一个公司目标"}</Ui> : ''
      })}{"\n      "}<Ui as="div" className={"two-col"}>{"\n        "}{section('现在最需要关注', null, careList(), {
          id: 'care',
          hint: '落后、需要支持或很久没更新的末端目标'
        })}{"\n        "}{assistantCard({
          limit: 4,
          compact: true
        })}{"\n      "}</Ui>{"\n      "}{personal.length ? section(isAdmin() ? '大家发起的自主目标' : '自主目标', personal.length, <><Ui as="div" className={"grid"}>{joinNodes((state.allPersonal ? personal : personal.slice(0, 6)).map(g => goalCard(g, {
            showOwner: true,
            quick: false
          })), '')}</Ui>{personal.length > 6 ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"toggle-personal"}>{state.allPersonal ? <>{icon('chevron-up')}{"收起"}</> : <>{icon('chevron-down')}{"展开全部 "}{personal.length}{" 个"}</>}</Ui> : ''}</>, {
        id: 'personal',
        hint: '自己发起、自己维护进度，不计入公司汇总'
      }) : ''}{"\n    "}</Ui>;
  },
  actions: {
    'toggle-personal': (el, e, ctx) => {
      state.allPersonal = !state.allPersonal;
      ctx.refresh();
    }
  }
};

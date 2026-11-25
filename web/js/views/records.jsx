import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 我记过的进展：记错了可以撤回，撤回不会删除，随时可以恢复。
import { get } from "../api.js";
import { store, goal as getGoal } from "../store.js";
import { esc, icon, num, shortDate, relTime } from "../ui.jsx";
const s = {
  items: [],
  next: null,
  loaded: false,
  loadingMore: false
};
async function load(ctx) {
  try {
    const {
      items,
      next
    } = await get('/api/checkins');
    s.items = items;
    s.next = items.length >= 30 ? next : null;
    s.loaded = true;
  } catch {
    s.loaded = true;
  }
  ctx.refresh();
}
const SIG = {
  ok: ['tone-ok', 'sun', '顺利'],
  watch: ['tone-watch', 'hourglass', '有点担心'],
  help: ['tone-help', 'life-buoy', '需要支持']
};
export default {
  title: () => '我记过的进展',
  enter(params, ctx) {
    load(ctx);
  },
  onStore(kind, params, ctx) {
    if (kind === 'records') load(ctx);
  },
  render() {
    return <Ui as="div" className={"page records"}>{"\n      "}<Ui as="header" className={"page-head"}><Ui as="div"><Ui as="h1">{"我记过的进展"}</Ui><Ui as="p" className={"lead"}>{"记错了可以撤回：撤回后不再计入进度，但会留下痕迹，随时可以恢复。"}</Ui></Ui></Ui>{"\n      "}{!s.loaded ? <Ui as="div" className={"loading"}>{icon('orbit')}{"正在加载…"}</Ui> : s.items.length ? <><Ui as="ul" className={"record-list"}>{joinNodes(s.items.map(r => {
            const sig = r.signal ? SIG[r.signal] : null;
            const g = getGoal(r.goalId);
            return <Ui as="li" className={`record${r.voided ? ' voided' : ''}`} data-key={`rc-${esc(r.id)}`} key={`rc-${esc(r.id)}`}>{"\n          "}<Ui as="div" className={"rc-date"}><Ui as="b">{shortDate(r.date)}</Ui><Ui as="small">{relTime(r.createdAt)}</Ui></Ui>{"\n          "}<Ui as="div" className={"rc-main"}>{g ? <Ui as="a" href={`#/g/${esc(r.goalId)}`}>{esc(r.goalTitle)}</Ui> : <Ui as="span">{esc(r.goalTitle)}</Ui>}{r.archived ? <Ui as="small" className={"muted"}>{"（已归档）"}</Ui> : ''}{"\n            "}<Ui as="p">{r.value !== null ? <><Ui as="b" className={"plus"}>{r.value >= 0 ? '+' : ''}{num(r.value)}</Ui>{" "}{esc(r.unit)}</> : ''}{sig ? <>{" "}<Ui as="span" className={`chip ${sig[0]} sm`}>{icon(sig[1])}{sig[2]}</Ui></> : ''}{r.note ? <>{" "}<Ui as="span" className={"rc-note"}>{esc(r.note)}</Ui></> : ''}</Ui></Ui>{"\n          "}<Ui as="div" className={"rc-act"}>{r.voided ? <><Ui as="span" className={"muted small"}>{"已撤回"}</Ui>{!r.archived ? <Ui as="button" type={"button"} className={"btn ghost sm"} data-act={"void-checkin"} data-id={esc(r.id)} data-restore={"1"}>{icon('undo-2')}{"恢复"}</Ui> : ''}</> : !r.archived ? <Ui as="button" type={"button"} className={"btn ghost sm"} data-act={"void-checkin"} data-id={esc(r.id)}>{icon('rotate-ccw')}{"撤回"}</Ui> : ''}</Ui>{"\n        "}</Ui>;
          }), '')}</Ui>{s.next ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"records-more"}>{icon('chevron-down')}{"更早的记录"}</Ui> : ''}</> : <Ui as="div" className={"soft-empty"}>{icon('pencil')}<Ui as="span">{"你还没有记过进展。在“我的”页面点任意目标上的“记一笔”就可以开始。"}</Ui></Ui>}{"\n    "}</Ui>;
  },
  actions: {
    'records-more': async (el, e, ctx) => {
      if (!s.next) return;
      const {
        items,
        next
      } = await get('/api/checkins?before=' + encodeURIComponent(s.next));
      s.items = [...s.items, ...items];
      s.next = items.length >= 30 ? next : null;
      ctx.refresh();
    }
  }
};
export { store };

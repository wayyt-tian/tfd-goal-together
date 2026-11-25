import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 动态：整个组织的“呼吸”。新进展会从顶部滑进来，点赞和回复都在原地完成。
import { get } from "../api.js";
import { store, isLead } from "../store.js";
import { icon } from "../ui.jsx";
import { grouped } from "./feed.jsx";
import { assistantCard } from "./insights.jsx";
const s = {
  filter: 'all',
  items: [],
  next: null,
  loaded: false,
  loadingMore: false,
  timer: null,
  token: 0
};
const FILTERS = () => [['all', '全部'], ['mine', '和我有关'], ...(isLead() ? [['team', '我的团队']] : []), ['help', '需要支持'], ['new', '新目标']];
async function load(ctx, {
  merge = false
} = {}) {
  const token = ++s.token;
  try {
    const {
      items,
      next
    } = await get(`/api/events?limit=30&filter=${s.filter}`);
    if (token !== s.token) return;
    if (merge) {
      const known = new Map(s.items.map(e => [e.seq, e]));
      const at = Date.now();
      const fresh = items.filter(e => !known.has(e.seq)).map(e => ({
        ...e,
        fresh: at
      }));
      s.items = [...fresh, ...s.items].sort((a, b) => b.seq - a.seq);
    } else {
      s.items = items;
      s.next = next;
    }
    s.loaded = true;
  } catch {
    s.loaded = true;
  }
  ctx.refresh();
}
export default {
  title: () => '动态',
  enter(params, ctx) {
    const wanted = params.query?.filter;
    if (wanted && FILTERS().some(([k]) => k === wanted)) s.filter = wanted;
    s.loaded = s.items.length > 0 && !wanted;
    load(ctx);
  },
  leave() {
    clearTimeout(s.timer);
  },
  onStore(kind, params, ctx) {
    if (kind === 'delta' && (store.lastEvents || []).length) {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => load(ctx, {
        merge: true
      }), 250);
    }
    if (kind === 'load') load(ctx);
  },
  render() {
    return <Ui as="div" className={"page pulse"}>{"\n      "}<Ui as="header" className={"page-head"}><Ui as="div"><Ui as="h1">{"动态"}</Ui><Ui as="p" className={"lead"}>{"大家的进展、新目标和求助会实时出现在这里。点 "}{icon('heart', 'inline')}{" 给同事鼓劲，点“回复”直接说一句。"}</Ui></Ui>{"\n        "}<Ui as="div" className={`live-chip ${store.live}`}><Ui as="i" className={`live-dot ${store.live}`} />{store.live === 'live' ? '实时' : '重连中'}</Ui></Ui>{"\n      "}{assistantCard({
        limit: 5
      })}{"\n      "}<Ui as="div" className={"chips sticky-chips"}>{joinNodes(FILTERS().map(([k, l]) => <Ui as="button" type={"button"} className={`chip-btn${s.filter === k ? ' on' : ''}`} data-act={"pulse-filter"} data-filter={k}>{l}</Ui>), '')}</Ui>{"\n      "}<Ui as="div" className={"feed"} data-key={`feed-${s.filter}`} key={`feed-${s.filter}`}>{!s.loaded ? <Ui as="div" className={"loading"}>{icon('orbit')}{"正在加载动态…"}</Ui> : s.items.length ? grouped(s.items) : <Ui as="div" className={"soft-empty"}>{icon('messages-square')}<Ui as="span">{s.filter === 'help' ? '现在没有人需要支持，真好。' : '这里还没有动态。'}</Ui></Ui>}</Ui>{"\n      "}{s.next ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"pulse-more"} disabled={!!s.loadingMore}>{icon('chevron-down')}{"看更早的动态"}</Ui> : s.loaded && s.items.length ? <Ui as="p" className={"muted center small"}>{"没有更早的动态了"}</Ui> : ''}{"\n    "}</Ui>;
  },
  actions: {
    'pulse-filter': (el, e, ctx) => {
      s.filter = el.dataset.filter;
      s.loaded = false;
      s.items = [];
      s.next = null;
      ctx.refresh();
      load(ctx);
    },
    'pulse-more': async (el, e, ctx) => {
      if (!s.next || s.loadingMore) return;
      s.loadingMore = true;
      ctx.refresh();
      try {
        const {
          items,
          next
        } = await get(`/api/events?limit=30&filter=${s.filter}&before=${s.next}`);
        const known = new Set(s.items.map(x => x.seq));
        s.items = [...s.items, ...items.filter(x => !known.has(x.seq))];
        s.next = next;
      } finally {
        s.loadingMore = false;
        ctx.refresh();
      }
    }
  }
};

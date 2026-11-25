import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 团队：上级看下属——谁顺利、谁需要支持、谁很久没更新，一眼看清，点进去看个人。
import { store, person, teamSet, isAdmin, departmentName } from "../store.js";
import { esc, icon, avatar, emptyState } from "../ui.jsx";
import { personSummary, worstChip, statusDots, lastText } from "./cards.jsx";
const state = {
  filter: 'all',
  q: '',
  open: new Map(),
  shown: new Map()
};
const PAGE = 12;
const FILTERS = [['all', '全部'], ['care', '需要关注'], ['help', '需要支持'], ['stale', '很久没更新'], ['ok', '都顺利']];
const test = {
  all: () => true,
  care: s => ['help', 'risk', 'watch', 'stale'].includes(s.worst),
  help: s => s.help > 0,
  stale: s => s.stale > 0,
  ok: s => s.worst === 'ok' || s.worst === 'done'
};
function deptOrder() {
  const order = new Map();
  let i = 0;
  const tops = store.departments.filter(d => !d.parentId);
  for (const top of tops) {
    order.set(top.id, i++);
    for (const sub of store.departments.filter(d => d.parentId === top.id)) order.set(sub.id, i++);
  }
  return order;
}
function topOf(id) {
  let d = store.departments.find(x => x.id === id);
  while (d && d.parentId) d = store.departments.find(x => x.id === d.parentId) || null;
  return d ? d.id : id;
}
function subName(id) {
  const d = store.departments.find(x => x.id === id);
  return d && d.parentId ? d.name : '';
}
function deptLabel(id) {
  const d = store.departments.find(x => x.id === id);
  if (!d) return departmentName(id);
  const parent = d.parentId ? store.departments.find(x => x.id === d.parentId) : null;
  return parent ? `${esc(parent.name)} · ${esc(d.name)}` : esc(d.name);
}
export default {
  title: () => '团队',
  enter(params) {
    if (params.query?.filter && test[params.query.filter]) state.filter = params.query.filter;
  },
  render() {
    const ids = [...teamSet()];
    const people = ids.map(id => person(id)).filter(p => p.active);
    if (!people.length) return <Ui as="div" className={"page"}>{emptyState({
        image: 'ip-think',
        title: '你还没有团队成员',
        text: '在“设置 → 成员”里给同事设置直属上级，或设置部门负责人后，团队就会出现在这里。'
      })}</Ui>;
    const rows = people.map(p => ({
      p,
      s: personSummary(p.id)
    }));
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, rows.filter(r => test[k](r.s)).length]));
    const q = state.q.trim();
    const shown = rows.filter(r => test[state.filter](r.s) && (!q || r.p.name.includes(q) || r.p.title.includes(q) || r.p.dept.includes(q)));
    const order = deptOrder();
    const many = people.length > 20;
    // 人多时按一级部门分组（二级部门名写在每一行里），人少时按所在部门分组
    const groupOf = r => r.p.departmentId == null ? 'none' : many ? topOf(r.p.departmentId) : r.p.departmentId;
    const groups = new Map();
    for (const r of shown) {
      const key = groupOf(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const rank = {
      help: 0,
      risk: 1,
      stale: 2,
      watch: 3,
      ok: 4,
      done: 5,
      none: 6
    };
    const sorted = [...groups].sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999));
    // 人多时默认只展开最需要关注的两个部门，其余收起，只显示摘要
    const careOf = list => list.filter(r => test.care(r.s)).length;
    const topCare = new Set([...groups].map(([k, l]) => [k, l.filter(r => r.s.help || r.s.risk).length * 10 + careOf(l)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k));
    const goalsTotal = new Set(rows.flatMap(r => r.s.linked.map(g => g.id))).size;
    const direct = store.access.directReportIds.length;
    return <Ui as="div" className={"page team"}>{"\n      "}<Ui as="header" className={"page-head"}><Ui as="div"><Ui as="h1">{isAdmin() ? '全公司成员' : '我的团队'}</Ui>{"\n        "}<Ui as="p" className={"lead"}>{people.length}{" 位同事"}{direct && !isAdmin() ? `（${direct} 位直属）` : ''}{"，关联 "}{goalsTotal}{" 个目标。按“需要关注”的程度排在前面。"}</Ui></Ui></Ui>{"\n      "}<Ui as="div" className={"team-stats"}>{"\n        "}<Ui as="div" className={"stat-tile tone-ok"}><Ui as="b">{counts.ok}</Ui><Ui as="span">{"人都顺利"}</Ui></Ui>{"\n        "}<Ui as="div" className={"stat-tile tone-risk"}><Ui as="b">{rows.filter(r => r.s.risk).length}</Ui><Ui as="span">{"人有落后"}</Ui></Ui>{"\n        "}<Ui as="div" className={"stat-tile tone-help"}><Ui as="b">{counts.help}</Ui><Ui as="span">{"人需要支持"}</Ui></Ui>{"\n        "}<Ui as="div" className={"stat-tile tone-quiet"}><Ui as="b">{counts.stale}</Ui><Ui as="span">{"人很久没更新"}</Ui></Ui>{"\n      "}</Ui>{"\n      "}<Ui as="div" className={"toolbar"}>{"\n        "}<Ui as="div" className={"chips"}>{joinNodes(FILTERS.map(([k, l]) => <Ui as="button" type={"button"} className={`chip-btn${state.filter === k ? ' on' : ''}`} data-act={"team-filter"} data-filter={k}>{l}<Ui as="small">{counts[k]}</Ui></Ui>), '')}</Ui>{"\n        "}<Ui as="label" className={"search"}>{icon('search')}<Ui as="input" type={"search"} data-keep={"team-q"} data-input={"team-search"} placeholder={"搜姓名、职位或部门"} value={esc(state.q)} aria-label={"搜索成员"} /></Ui>{"\n      "}</Ui>{"\n      "}{shown.length ? joinNodes(sorted.map(([key, list]) => {
        list.sort((a, b) => rank[a.s.worst] - rank[b.s.worst] || a.p.name.localeCompare(b.p.name, 'zh-CN'));
        const care = list.filter(r => test.care(r.s)).length;
        const helpN = list.filter(r => r.s.help).length,
          riskN = list.filter(r => r.s.risk).length;
        const open = state.open.has(key) ? state.open.get(key) : !many || topCare.has(key) || q || state.filter !== 'all';
        const limit = state.shown.get(key) || PAGE;
        return <Ui as="details" className={"dept"} data-key={`dept-${key}`} key={`dept-${key}`} data-dept={key} open={!!open}>{"\n          "}<Ui as="summary"><Ui as="span" className={"dept-name"}>{key === 'none' ? '公司直属' : deptLabel(key)}</Ui><Ui as="small">{list.length}{" 人"}</Ui>{care ? <Ui as="span" className={"chip tone-watch sm"}>{care}{" 人需要关注"}</Ui> : <Ui as="span" className={"chip tone-ok sm"}>{icon('sun')}{"都顺利"}</Ui>}{helpN ? <Ui as="span" className={"chip tone-help sm extra"}>{helpN}{" 人需要支持"}</Ui> : ''}{riskN ? <Ui as="span" className={"chip tone-risk sm extra"}>{riskN}{" 人有落后"}</Ui> : ''}<Ui as="span" className={"grow"} />{icon('chevron-down', 'caret')}</Ui>{"\n          "}<Ui as="div" className={"person-list"}>{joinNodes(list.slice(0, limit).map(({
              p,
              s
            }) => <Ui as="a" className={"team-row"} href={`#/p/${p.id}`} data-key={`tr-${p.id}`} key={`tr-${p.id}`}>{"\n            "}{avatar(p.id, 'md')}<Ui as="span" className={"tr-name"}><Ui as="b">{esc(p.name)}</Ui><Ui as="small">{esc(p.title || '成员')}{many && subName(p.departmentId) ? ` · ${esc(subName(p.departmentId))}` : ''}</Ui></Ui>{"\n            "}<Ui as="span" className={"tr-goals"}>{s.linked.length ? statusDots(s.linked) : ''}<Ui as="small">{joinNodes([s.owned.length ? `负责 ${s.owned.length}` : '', s.joined.length ? `参与 ${s.joined.length}` : ''].filter(Boolean), ' · ') || '暂无目标'}</Ui></Ui>{"\n            "}<Ui as="span" className={"tr-state"}>{worstChip(s)}<Ui as="small" className={"muted"}>{lastText(s.last, s)}</Ui></Ui>{icon('chevron-right', 'chev')}</Ui>), '')}{"\n          "}{list.length > limit ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"team-more"} data-dept={key}>{icon('chevron-down')}{"再显示 "}{Math.min(PAGE, list.length - limit)}{" 位"}</Ui> : ''}</Ui>{"\n        "}</Ui>;
      }), '') : <Ui as="div" className={"soft-empty"}>{icon('search')}<Ui as="span">{"没有符合条件的同事。"}</Ui></Ui>}{"\n    "}</Ui>;
  },
  after(root) {
    for (const d of root.querySelectorAll('details.dept')) if (!d._bound) {
      d._bound = true;
      d.addEventListener('toggle', () => {
        const key = d.dataset.dept;
        state.open.set(key === 'none' ? 'none' : Number(key), d.open);
      });
    }
  },
  actions: {
    'team-filter': (el, e, ctx) => {
      state.filter = el.dataset.filter;
      ctx.refresh();
    },
    'team-search': (el, e, ctx) => {
      state.q = el.value;
      ctx.refresh();
    },
    'team-more': (el, e, ctx) => {
      const key = el.dataset.dept === 'none' ? 'none' : Number(el.dataset.dept);
      state.shown.set(key, (state.shown.get(key) || PAGE) + PAGE);
      ctx.refresh();
    }
  }
};

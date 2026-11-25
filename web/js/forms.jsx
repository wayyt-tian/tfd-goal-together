import { Ui, joinNodes, renderInto } from "./react-runtime.jsx";
// 所有“动手”的操作单。原则：先问最少的问题，其余收在“更多设置”里；能推断的都替用户填好。
import { store, goal as getGoal, person, children, ancestors, mutate, isAdmin, teamSet, departmentName, setCheer } from "./store.js";
import { post } from "./api.js";
import { esc, icon, sheet, toast, busy, fieldError, num, plainUnit, pct, avatar, statusChip, celebrate, confirmSheet, $, $$ } from "./ui.jsx";

// 局域网 http 访问时浏览器不提供 crypto.randomUUID，用 getRandomValues 兜底
export const uid = prefix => [prefix + '-', crypto.randomUUID ? crypto.randomUUID() : [Date.now().toString(36) + '-', joinNodes([...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')), '')]];
const navigate = hash => {
  if (location.hash !== hash) location.hash = hash;
};
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function ranges() {
  const [y, m, d] = store.today.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const monday = new Date(today);
  monday.setDate(d - (today.getDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const q = Math.floor((m - 1) / 3);
  return {
    week: ['本周', ymd(monday), ymd(sunday)],
    month: ['本月', ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))],
    next: ['下个月', ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))],
    quarter: ['本季度', ymd(new Date(y, q * 3, 1)), ymd(new Date(y, q * 3 + 3, 0))]
  };
}
function personPill(id, {
  action = 'pick-owner',
  label = '换人'
} = {}) {
  const p = person(id);
  return <Ui as="span" className={"pill person-pill"}>{avatar(id, 'xs')}<Ui as="span">{esc(p.name)}{id === store.me.id ? '（我）' : ''}</Ui><Ui as="button" type={"button"} className={"link"} {...{
      [`data-${action}`]: true
    }}>{label}</Ui></Ui>;
}
function peopleChips(ids, attr = 'remove-member') {
  return joinNodes(ids.map(id => <Ui as="span" className={"pill"}>{avatar(id, 'xs')}<Ui as="span">{esc(person(id).name)}</Ui><Ui as="button" type={"button"} className={"icon-btn xs"} {...{
      [`data-${attr}`]: id
    }} aria-label={`移除 ${esc(person(id).name)}`}>{icon('x')}</Ui></Ui>), '');
}
function goalLine(g) {
  if (!g) return '';
  return <Ui as="span" className={"goal-line"}>{icon(g.kind === 'action' ? 'square-check-big' : 'target')}<Ui as="span">{esc(g.title)}</Ui></Ui>;
}
function showError(form, error) {
  fieldError(form, error.message || String(error));
}

// ---------- 选人 ----------
export function pickPeople({
  title = '选择成员',
  multiple = false,
  selected = [],
  only = null,
  exclude = [],
  hint = ''
} = {}) {
  return new Promise(resolve => {
    let picked = new Set(selected);
    let result = null;
    const pool = [...store.people.values()].filter(p => p.active && (!only || only.has(p.id)) && !exclude.includes(p.id));
    const depts = [...new Set(pool.map(p => p.dept))];
    const listHtml = (query, dept) => {
      const q = query.trim();
      const list = pool.filter(p => (!dept || p.dept === dept) && (!q || p.name.includes(q) || p.title.includes(q) || p.dept.includes(q)));
      if (!list.length) return <Ui as="p" className={"muted center pad"}>{"没有找到“"}{esc(q)}{"”，换个关键词试试（可以搜姓名、职位或部门）。"}</Ui>;
      const groups = new Map();
      for (const p of list) {
        if (!groups.has(p.dept)) groups.set(p.dept, []);
        groups.get(p.dept).push(p);
      }
      return joinNodes([...groups].map(([name, members]) => <Ui as="div" className={"pick-group"}><Ui as="h4">{esc(name)}{" "}<Ui as="small">{members.length}</Ui></Ui>{joinNodes(members.map(p => <>{"\n        "}<Ui as="button" type={"button"} className={`pick-row${picked.has(p.id) ? ' on' : ''}`} data-person={p.id} aria-pressed={picked.has(p.id)}>{"\n          "}{avatar(p.id, 'sm')}<Ui as="span" className={"grow"}><Ui as="b">{esc(p.name)}{p.id === store.me.id ? '（我）' : ''}</Ui><Ui as="small">{esc(p.title || p.dept)}</Ui></Ui>{"\n          "}<Ui as="span" className={"tick"}>{icon('check')}</Ui></Ui></>), '')}</Ui>), '');
    };
    sheet({
      title,
      subtitle: hint || (multiple ? '可以多选，点一下选中，再点一下取消' : '点一下就选好了'),
      body: <><Ui as="div" className={"pick-tools"}><Ui as="label" className={"search"}>{icon('search')}<Ui as="input" type={"search"} placeholder={"搜姓名、职位或部门"} data-q={""} aria-label={"搜索成员"} /></Ui>{"\n        "}<Ui as="select" data-dept={""} aria-label={"按部门筛选"}><Ui as="option" value={""}>{"全部部门（"}{pool.length}{" 人）"}</Ui>{joinNodes(depts.map(d => <Ui as="option">{esc(d)}</Ui>), '')}</Ui></Ui>{"\n        "}<Ui as="div" className={"pick-list"} data-list={""}>{listHtml('', '')}</Ui></>,
      footer: multiple ? <><Ui as="span" className={"muted"} data-count={""}>{"已选 "}{picked.size}{" 人"}</Ui><Ui as="button" type={"button"} className={"btn primary"} data-done={""}>{"确定"}</Ui></> : '',
      onMount: (dialog, close) => {
        const refresh = () => {
          renderInto($('[data-list]', dialog), listHtml($('[data-q]', dialog).value, $('[data-dept]', dialog).value));
        };
        $('[data-q]', dialog).addEventListener('input', refresh);
        $('[data-dept]', dialog).addEventListener('change', refresh);
        dialog.addEventListener('click', event => {
          const row = event.target.closest('[data-person]');
          if (row) {
            const id = Number(row.dataset.person);
            if (!multiple) {
              result = [id];
              close('ok');
              return;
            }
            picked.has(id) ? picked.delete(id) : picked.add(id);
            row.classList.toggle('on');
            row.setAttribute('aria-pressed', picked.has(id));
            $('[data-count]', dialog).textContent = `已选 ${picked.size} 人`;
          }
          if (event.target.closest('[data-done]')) {
            result = [...picked];
            close('ok');
          }
        });
        setTimeout(() => $('[data-q]', dialog).focus(), 50);
      },
      onClose: () => resolve(result)
    });
  });
}

// ---------- 选目标（放在哪个目标下面 / 挂靠到哪个组织目标） ----------
export function pickGoal({
  title = '放在哪个目标下面？',
  test = g => g.perms.child,
  hint = '只列出你可以继续往下拆的目标'
} = {}) {
  return new Promise(resolve => {
    let result = null;
    const roots = [...store.goals.values()].filter(g => !g.parentId).sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'company' ? -1 : 1) || a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
    const rows = [];
    const walk = (g, depth) => {
      rows.push({
        g,
        depth
      });
      for (const c of children(g.id)) walk(c, depth + 1);
    };
    roots.forEach(r => walk(r, 0));
    const render = q => {
      const list = rows.filter(({
        g
      }) => test(g) && (!q || g.title.includes(q) || person(g.ownerId).name.includes(q)));
      if (!list.length) return <Ui as="p" className={"muted center pad"}>{"没有可选的目标。"}</Ui>;
      return joinNodes(list.map(({
        g,
        depth
      }) => <Ui as="button" type={"button"} className={"pick-row goal"} data-goal={g.id} style={{
        "--d": q ? 0 : Math.min(depth, 4)
      }}>{"\n        "}{icon(g.kind === 'action' ? 'square-check-big' : 'target')}<Ui as="span" className={"grow"}><Ui as="b">{esc(g.title)}</Ui><Ui as="small">{esc(person(g.ownerId).name)}{" 负责"}{g.kind === 'measure' ? ' · ' + plainUnit(g.target, g.unit) : ''}</Ui></Ui>{statusChip(g.stat, {
          small: true
        })}</Ui>), '');
    };
    sheet({
      title,
      subtitle: hint,
      body: <><Ui as="label" className={"search"}>{icon('search')}<Ui as="input" type={"search"} placeholder={"搜目标名称或负责人"} data-q={""} aria-label={"搜索目标"} /></Ui><Ui as="div" className={"pick-list"} data-list={""}>{render('')}</Ui></>,
      onMount: (dialog, close) => {
        $('[data-q]', dialog).addEventListener('input', e => {
          renderInto($('[data-list]', dialog), render(e.target.value.trim()));
        });
        dialog.addEventListener('click', e => {
          const row = e.target.closest('[data-goal]');
          if (row) {
            result = row.dataset.goal;
            close('ok');
          }
        });
      },
      onClose: () => resolve(result)
    });
  });
}

// ---------- 新建目标 ----------
export function openNewGoal({
  parentId = null,
  scope = null,
  kind = null
} = {}) {
  const r = ranges();
  const parent = parentId ? getGoal(parentId) : null;
  const state = {
    where: parent ? 'child' : scope === 'company' && isAdmin() ? 'company' : scope === 'personal' ? 'personal' : store.goals.size && [...store.goals.values()].some(g => g.perms.child) ? 'child' : 'personal',
    parentId: parent?.id || null,
    kind: kind || (parent?.kind === 'action' ? 'action' : 'measure'),
    ownerId: store.me.id,
    memberIds: [],
    alignId: null,
    unit: parent?.unit || '万元',
    startDate: parent?.startDate || r.month[1],
    endDate: parent?.endDate || r.month[2]
  };
  const whereOptions = [['child', 'git-fork', '挂在一个目标下面', '成为它的一条拆解路径，进展自动往上汇总'], ['personal', 'sprout', '我的自主目标', '自己发起，可挂靠组织目标，不计入公司汇总'], ...(isAdmin() ? [['company', 'crown', '公司北极星目标', '最上层的公司目标，从这里往下拆']] : [])];
  const body = () => {
    const p = state.parentId ? getGoal(state.parentId) : null;
    const align = state.alignId ? getGoal(state.alignId) : null;
    const sameUnit = p && p.kind === 'measure' && state.kind === 'measure' && p.unit === state.unit;
    return <>{"\n    "}<Ui as="label" className={"field"}><Ui as="span">{"想达成什么？"}</Ui><Ui as="input" name={"title"} maxLength={"60"} required={true} placeholder={"例如：抖音商城成交额、上线选品助手、每周两场直播复盘"} value={esc($('[name=title]', current?.dialog)?.value || '')} autoFocus={true} /></Ui>{"\n    "}<Ui as="div" className={"field"}><Ui as="span">{"放在哪里"}</Ui><Ui as="div" className={"choice-row"}>{joinNodes(whereOptions.map(([key, ic, label, hint]) => <>{"\n      "}<Ui as="button" type={"button"} className={`choice${state.where === key ? ' on' : ''}`} data-where={key} aria-pressed={state.where === key}>{icon(ic)}<Ui as="b">{label}</Ui><Ui as="small">{hint}</Ui></Ui></>), '')}</Ui>{"\n      "}{state.where === 'child' ? <Ui as="div" className={"picked"}>{p ? <>{goalLine(p)}<Ui as="button" type={"button"} className={"link"} data-pick-parent={""}>{"换一个"}</Ui></> : <Ui as="button" type={"button"} className={"btn soft"} data-pick-parent={""}>{icon('git-fork')}{"选择上一级目标"}</Ui>}</Ui> : ''}{"\n      "}{state.where === 'personal' ? <Ui as="div" className={"picked"}>{align ? <><Ui as="span" className={"muted"}>{"挂靠到"}</Ui>{goalLine(align)}<Ui as="button" type={"button"} className={"link"} data-pick-align={""}>{"换一个"}</Ui><Ui as="button" type={"button"} className={"link"} data-clear-align={""}>{"不挂靠"}</Ui></> : <Ui as="button" type={"button"} className={"btn soft"} data-pick-align={""}>{icon('link-2')}{"挂靠到一个组织目标（可选）"}</Ui>}</Ui> : ''}{"\n    "}</Ui>{"\n    "}<Ui as="div" className={"field"}><Ui as="span">{"怎么算完成"}</Ui><Ui as="div" className={"choice-row two"}>{"\n      "}<Ui as="button" type={"button"} className={`choice${state.kind === 'measure' ? ' on' : ''}`} data-kind={"measure"} aria-pressed={state.kind === 'measure'}>{icon('target')}<Ui as="b">{"有一个数字"}</Ui><Ui as="small">{"例如 120 万元、20 个达人"}</Ui></Ui>{"\n      "}<Ui as="button" type={"button"} className={`choice${state.kind === 'action' ? ' on' : ''}`} data-kind={"action"} aria-pressed={state.kind === 'action'}>{icon('square-check-big')}<Ui as="b">{"做完就行"}</Ui><Ui as="small">{"例如 上线一个工具、完成改版"}</Ui></Ui></Ui>{"\n      "}{state.kind === 'measure' ? <><Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"目标值"}</Ui><Ui as="input" name={"target"} type={"number"} inputMode={"decimal"} min={"0"} step={"any"} placeholder={"120"} value={esc($('[name=target]', current?.dialog)?.value || '')} /></Ui>{"\n        "}<Ui as="label" className={"field slim"}><Ui as="span">{"单位"}</Ui><Ui as="input" name={"unit"} maxLength={"8"} value={esc(state.unit)} list={"unit-list"} /><Ui as="datalist" id={"unit-list"}><Ui as="option">{"万元"}</Ui><Ui as="option">{"个"}</Ui><Ui as="option">{"场"}</Ui><Ui as="option">{"人"}</Ui><Ui as="option">{"篇"}</Ui><Ui as="option">{"单"}</Ui></Ui></Ui></Ui>{"\n        "}{sameUnit ? <Ui as="p" className={"hint"}>{icon('arrow-up-right')}{"记在这里的数字会自动汇总到「"}{esc(p.title)}{"」"}</Ui> : p && p.kind === 'measure' ? <Ui as="p" className={"hint"}>{icon('info')}{"单位和上一级不同，它会作为辅助指标展示，不计入上一级的数字"}</Ui> : ''}</> : ''}{"\n    "}</Ui>{"\n    "}<Ui as="div" className={"field"}><Ui as="span">{"谁负责"}</Ui>{personPill(state.ownerId)}</Ui>{"\n    "}<Ui as="details" className={"more"} open={!!state.memberIds.length}><Ui as="summary">{icon('chevron-down')}{"更多设置：一起做的人、时间、说明"}</Ui>{"\n      "}<Ui as="div" className={"field"}><Ui as="span">{"一起做的人"}</Ui><Ui as="div" className={"pills"}>{peopleChips(state.memberIds)}<Ui as="button" type={"button"} className={"btn soft sm"} data-add-members={""}>{icon('user-plus')}{"邀请协作者"}</Ui></Ui></Ui>{"\n      "}<Ui as="div" className={"field"}><Ui as="span">{"时间"}</Ui><Ui as="div" className={"chips"}>{joinNodes(Object.entries(r).map(([key, [label, s, e]]) => <Ui as="button" type={"button"} className={`chip-btn${state.startDate === s && state.endDate === e ? ' on' : ''}`} data-range={key}>{label}</Ui>), '')}</Ui>{"\n        "}<Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"开始"}</Ui><Ui as="input" type={"date"} name={"startDate"} value={state.startDate} /></Ui><Ui as="label" className={"field slim"}><Ui as="span">{"结束"}</Ui><Ui as="input" type={"date"} name={"endDate"} value={state.endDate} /></Ui></Ui></Ui>{"\n      "}<Ui as="label" className={"field"}><Ui as="span">{"说明（可选）"}</Ui><Ui as="textarea" name={"note"} rows={"2"} maxLength={"500"} placeholder={"口径、关键路径或想法，一两句话就好"}>{esc($('[name=note]', current?.dialog)?.value || '')}</Ui></Ui>{"\n    "}</Ui></>;
  };
  let current = null;
  const rerender = () => {
    const open = $('details.more', current.dialog)?.open;
    renderInto($('.sheet-body', current.dialog), body());
    if (open) $('details.more', current.dialog).open = true;
  };
  current = sheet({
    title: parent ? `在「${esc(parent.title)}」下面加一项` : '新建一个目标',
    subtitle: '想到就建，大家会实时看到',
    body: body(),
    footer: <><Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"取消"}</Ui><Ui as="button" type={"submit"} className={"btn primary"} data-submit={""}>{icon('sparkles')}{"创建"}</Ui></>,
    onMount: (dialog, close) => {
      dialog.addEventListener('click', async event => {
        const t = event.target;
        const capture = () => {
          state.unit = $('[name=unit]', dialog)?.value || state.unit;
          state.startDate = $('[name=startDate]', dialog)?.value || state.startDate;
          state.endDate = $('[name=endDate]', dialog)?.value || state.endDate;
        };
        if (t.closest('[data-where]')) {
          capture();
          state.where = t.closest('[data-where]').dataset.where;
          if (state.where !== 'personal') state.alignId = null;
          rerender();
        } else if (t.closest('[data-kind]')) {
          capture();
          state.kind = t.closest('[data-kind]').dataset.kind;
          rerender();
        } else if (t.closest('[data-pick-parent]')) {
          capture();
          const id = await pickGoal({});
          if (id) {
            const p = getGoal(id);
            state.parentId = id;
            state.startDate = p.startDate;
            state.endDate = p.endDate;
            if (p.kind === 'measure') state.unit = p.unit;
          }
          rerender();
        } else if (t.closest('[data-pick-align]')) {
          capture();
          const id = await pickGoal({
            title: '挂靠到哪个组织目标？',
            test: x => x.scope === 'company',
            hint: '挂靠后，这个目标会出现在组织目标的“挂靠的自主目标”里'
          });
          if (id) state.alignId = id;
          rerender();
        } else if (t.closest('[data-clear-align]')) {
          capture();
          state.alignId = null;
          rerender();
        } else if (t.closest('[data-pick-owner]')) {
          capture();
          const only = state.where === 'personal' && !isAdmin() ? new Set([store.me.id, ...teamSet()]) : null;
          const ids = await pickPeople({
            title: '谁来负责？',
            only,
            hint: state.where === 'personal' ? '自主目标可以给自己，或给你团队里的同事' : '负责人会在“我的”页面看到它'
          });
          if (ids) state.ownerId = ids[0];
          rerender();
        } else if (t.closest('[data-add-members]')) {
          capture();
          const ids = await pickPeople({
            title: '邀请谁一起做？',
            multiple: true,
            selected: state.memberIds,
            exclude: [state.ownerId]
          });
          if (ids) state.memberIds = ids;
          rerender();
        } else if (t.closest('[data-remove-member]')) {
          capture();
          state.memberIds = state.memberIds.filter(id => id !== Number(t.closest('[data-remove-member]').dataset.removeMember));
          rerender();
        } else if (t.closest('[data-range]')) {
          const [, s, e] = r[t.closest('[data-range]').dataset.range];
          state.startDate = s;
          state.endDate = e;
          capture();
          state.startDate = s;
          state.endDate = e;
          rerender();
        }
      });
      dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget,
          button = $('[data-submit]', dialog);
        const title = $('[name=title]', dialog).value.trim();
        if (!title) return fieldError(form, '先给目标起个名字吧。');
        if (state.where === 'child' && !state.parentId) return fieldError(form, '请选择要挂在哪个目标下面。');
        const payload = {
          id: uid('g'),
          title,
          kind: state.kind,
          ownerId: state.ownerId,
          memberIds: state.memberIds,
          note: $('[name=note]', dialog)?.value || '',
          startDate: $('[name=startDate]', dialog)?.value || state.startDate,
          endDate: $('[name=endDate]', dialog)?.value || state.endDate
        };
        if (state.kind === 'measure') {
          const target = $('[name=target]', dialog).value;
          if (target === '') return fieldError(form, '有数字的目标需要填一个目标值。');
          payload.target = Number(target);
          payload.unit = $('[name=unit]', dialog).value.trim();
        }
        if (state.where === 'child') payload.parentId = state.parentId;else {
          payload.scope = state.where === 'company' ? 'company' : 'personal';
          if (state.alignId) payload.alignId = state.alignId;
        }
        busy(button);
        try {
          const result = await mutate('POST', '/api/goals', payload);
          close('ok');
          toast('建好了，相关同事会实时看到');
          navigate('#/g/' + (state.where === 'child' && parent ? parent.id : result.id));
        } catch (error) {
          showError(form, error);
          busy(button, false);
        }
      });
    }
  });
}

// ---------- 记一笔 ----------
const SIGNALS = [['ok', 'sun', '顺利'], ['watch', 'hourglass', '有点担心'], ['help', 'life-buoy', '需要支持']];
export function openCheckin(goalId, {
  comment = false
} = {}) {
  const g = getGoal(goalId);
  if (!g) return;
  const canValue = g.perms.checkin && !comment;
  const isLeafAction = g.kind === 'action' && !children(g.id).length;
  const hasMeasureKids = children(g.id).some(c => c.kind === 'measure' && c.unit === g.unit);
  let signal = null;
  const preview = value => {
    if (g.kind !== 'measure' || value === '' || Number.isNaN(Number(value))) return '';
    const total = (g.stat.value || 0) + Number(value);
    const done = g.target > 0 && total >= g.target && (g.stat.value || 0) < g.target;
    return <Ui as="div" className={`preview${done ? ' done' : ''}`}>{icon(done ? 'party-popper' : 'trending-up')}{"记完后："}{num(g.stat.value)}{" → "}<Ui as="b">{num(total)}</Ui>{" "}{esc(g.unit)}{g.target > 0 ? <>{" · 完成 "}<Ui as="b">{pct(total / g.target)}</Ui></> : ''}{done ? ' · 达成啦！' : ''}</Ui>;
  };
  const body = canValue ? <>{"\n    "}<Ui as="div" className={"goal-mini"}>{statusChip(g.stat)}<Ui as="span">{g.kind === 'measure' ? <>{"现在 "}<Ui as="b">{num(g.stat.value)}</Ui>{" / "}{num(g.target)}{" "}{esc(g.unit)}</> : g.doneAt ? '已经标记完成' : children(g.id).length ? `${g.stat.leaf.done} / ${g.stat.leaf.total} 项完成` : '做完就行'}</Ui></Ui>{"\n    "}{g.kind === 'measure' ? <><Ui as="label" className={"field big"}><Ui as="span">{"这次新增多少？"}</Ui><Ui as="div" className={"num-input"}><Ui as="input" name={"value"} type={"number"} inputMode={"decimal"} step={"any"} placeholder={"0"} autoFocus={true} /><Ui as="em">{esc(g.unit)}</Ui></Ui>{"\n      "}<Ui as="small" className={"muted"}>{"填这次新增的量，系统帮你累加"}{hasMeasureKids ? '；下面成员的进展会自动汇总，不用重复填' : ''}{"。冲减或退款可以填负数。"}</Ui></Ui><Ui as="div" data-preview={""} /></> : ''}{"\n    "}{isLeafAction && !g.doneAt ? <Ui as="label" className={"toggle-card"}><Ui as="input" type={"checkbox"} name={"done"} /><Ui as="span">{icon('circle-check')}<Ui as="b">{"已经做完了"}</Ui><Ui as="small">{"勾选后标记完成，会出现在动态里"}</Ui></Ui></Ui> : ''}{"\n    "}<Ui as="label" className={"field"}><Ui as="span">{"一句话说说（可选）"}</Ui><Ui as="textarea" name={"note"} rows={"2"} maxLength={"300"} placeholder={g.kind === 'measure' ? '例如：双 11 返场直播转化不错' : '例如：联调完成，下周灰度'} /></Ui>{"\n    "}<Ui as="div" className={"field"}><Ui as="span">{"感觉怎么样？（可不选）"}</Ui><Ui as="div" className={"chips signal"}>{joinNodes(SIGNALS.map(([key, ic, label]) => <Ui as="button" type={"button"} className={`chip-btn sig-${key}`} data-signal={key} aria-pressed={"false"}>{icon(ic)}{label}</Ui>), '')}</Ui>{"\n      "}<Ui as="small" className={"muted"}>{"选“需要支持”，你的上级和协作者会在动态里第一时间看到。"}</Ui></Ui>{"\n    "}<Ui as="details" className={"more"}><Ui as="summary">{icon('calendar')}{"日期：今天（补记以前的可以改）"}</Ui><Ui as="label" className={"field slim"}><Ui as="span">{"这笔进展发生在"}</Ui><Ui as="input" type={"date"} name={"date"} value={store.today} min={g.startDate} max={store.today < g.endDate ? store.today : g.endDate} /></Ui></Ui></> : <><Ui as="p" className={"muted"}>{g.perms.checkin ? '' : '进展数字由负责人和协作者更新。'}{"给大家留一句话吧——鼓励、建议或者能提供的支持。"}</Ui>{"\n    "}<Ui as="label" className={"field"}><Ui as="span">{"留言"}</Ui><Ui as="textarea" name={"note"} rows={"3"} maxLength={"300"} placeholder={"例如：需要我帮忙对接客户的话随时说"} autoFocus={true} /></Ui></>;
  sheet({
    title: canValue ? '记一笔' : '说一句',
    subtitle: esc(g.title),
    body,
    footer: <><Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"取消"}</Ui><Ui as="button" type={"submit"} className={"btn primary"} data-submit={""}>{icon('send')}{canValue ? '记下来' : '发送'}</Ui></>,
    onMount: (dialog, close) => {
      const value = $('[name=value]', dialog);
      value?.addEventListener('input', () => {
        renderInto($('[data-preview]', dialog), preview(value.value));
      });
      dialog.addEventListener('click', event => {
        const b = event.target.closest('[data-signal]');
        if (!b) return;
        signal = signal === b.dataset.signal ? null : b.dataset.signal;
        $$('[data-signal]', dialog).forEach(x => {
          x.classList.toggle('on', x.dataset.signal === signal);
          x.setAttribute('aria-pressed', x.dataset.signal === signal);
        });
      });
      dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget,
          button = $('[data-submit]', dialog);
        const note = $('[name=note]', dialog).value.trim();
        const done = $('[name=done]', dialog)?.checked;
        const raw = value?.value ?? '';
        if (!note && raw === '' && !signal && !done) return fieldError(form, canValue ? '填一个数字、写一句话，或者选一个感觉都可以。' : '写一句话再发送吧。');
        if (raw !== '' && Number(raw) < 0 && !note) return fieldError(form, '冲减或退款请写一句原因，方便以后核对。');
        busy(button);
        try {
          if (done) await mutate('POST', `/api/goals/${g.id}/done`, {
            done: true,
            note
          });
          if (raw !== '' || signal || note && !done) await mutate('POST', `/api/goals/${g.id}/checkins`, {
            id: uid('c'),
            value: raw === '' ? null : Number(raw),
            note,
            signal,
            date: $('[name=date]', dialog)?.value || store.today
          });
          close('ok');
          const fresh = getGoal(g.id);
          if (fresh?.stat?.status === 'done' && g.stat.status !== 'done') celebrate(`「${esc(g.title)}」达成啦！`);else toast(canValue ? '记好了，进度已经同步到上一级' : '留言已发送');
        } catch (error) {
          showError(form, error);
          busy(button, false);
        }
      });
    }
  });
}

// ---------- 拆给成员 ----------
export function openSplit(goalId) {
  const g = getGoal(goalId);
  if (!g) return;
  const measure = g.kind === 'measure';
  const existing = new Set(children(g.id).map(c => c.ownerId));
  let rows = [];
  const assigned = () => (g.stat.assigned || 0) + rows.reduce((s, r) => s + (Number(r.target) || 0), 0);
  const summary = () => {
    if (!measure) return <Ui as="p" className={"muted"}>{"每位成员会得到一项“做完就行”的子目标。"}</Ui>;
    const total = assigned(),
      gap = (g.target || 0) - total;
    if (!rows.length) return gap > 1e-9 ? <Ui as="div" className={"split-sum left"}>{icon('hourglass')}{"还有 "}<Ui as="b">{num(gap)}</Ui>{" "}{esc(g.unit)}{" 没分出去，选好成员后可以一键平均分。"}</Ui> : <Ui as="div" className={"split-sum even"}>{icon('circle-check')}{"目标已经全部拆出去了。再拆给成员也可以，合计会超过目标，相当于给团队留了冲刺空间。"}</Ui>;
    return <Ui as="div" className={`split-sum ${gap < -1e-9 ? 'over' : gap > 1e-9 ? 'left' : 'even'}`}>{icon(gap < -1e-9 ? 'info' : gap > 1e-9 ? 'hourglass' : 'circle-check')}{"\n      合计已分配 "}<Ui as="b">{num(total)}</Ui>{" / "}{num(g.target)}{" "}{esc(g.unit)}{"，"}{gap > 1e-9 ? <>{"还有 "}<Ui as="b">{num(gap)}</Ui>{" "}{esc(g.unit)}{" 没分出去"}</> : gap < -1e-9 ? <>{"多分了 "}<Ui as="b">{num(-gap)}</Ui>{" "}{esc(g.unit)}{"（可以，相当于给团队留了冲刺空间）"}</> : '刚好分完'}</Ui>;
  };
  const rowHtml = () => rows.length ? joinNodes(rows.map((r, i) => <Ui as="div" className={"split-row"} data-row={i}>{avatar(r.ownerId, 'sm')}<Ui as="b" className={"grow"}>{esc(person(r.ownerId).name)}{existing.has(r.ownerId) ? <Ui as="small" className={"muted"}>{"（已负责一项，会再加一项）"}</Ui> : ''}</Ui>{"\n      "}{measure ? <Ui as="label" className={"num-input sm"}><Ui as="input" type={"number"} inputMode={"decimal"} step={"any"} min={"0"} data-target={i} value={r.target} aria-label={`${esc(person(r.ownerId).name)} 的份额`} /><Ui as="em">{esc(g.unit)}</Ui></Ui> : ''}{"\n      "}<Ui as="input" className={"title-input"} data-title={i} maxLength={"60"} placeholder={`名称（默认：${esc(person(r.ownerId).name)} · ${esc(g.title)}）`} value={esc(r.title)} aria-label={"子目标名称"} />{"\n      "}<Ui as="button" type={"button"} className={"icon-btn"} data-drop={i} aria-label={"移除"}>{icon('x')}</Ui></Ui>), '') : <Ui as="p" className={"muted center pad"}>{icon('users')}<Ui as="br" />{"先选择要拆给哪些成员"}</Ui>;
  const body = () => <><Ui as="div" className={"goal-mini"}>{icon('git-fork')}<Ui as="span">{"从「"}{esc(g.title)}{"」拆出"}{measure ? `，目标 ${num(g.target)} ${esc(g.unit)}${g.stat.childCount ? `，已有 ${g.stat.childCount} 条路径分走 ${num(g.stat.assigned || 0)}` : ''}` : ''}</Ui></Ui>{"\n    "}<Ui as="div" data-rows={""}>{rowHtml()}</Ui>{"\n    "}<Ui as="div" className={"split-tools"}><Ui as="button" type={"button"} className={"btn soft"} data-add={""}>{icon('user-plus')}{"选择成员"}</Ui>{measure && rows.length ? <Ui as="button" type={"button"} className={"btn ghost"} data-even={""}>{icon('split')}{"把剩余平均分"}</Ui> : ''}</Ui>{"\n    "}<Ui as="div" data-sum={""}>{summary()}</Ui></>;
  sheet({
    title: '拆给成员',
    subtitle: '每人一项，进展会自动汇总回来',
    wide: true,
    body: body(),
    footer: <><Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"取消"}</Ui><Ui as="button" type={"submit"} className={"btn primary"} data-submit={""}>{icon('git-fork')}{"确认拆解"}</Ui></>,
    onMount: (dialog, close) => {
      const redraw = () => {
        renderInto($('.sheet-body', dialog), body());
      };
      dialog.addEventListener('input', e => {
        if (e.target.dataset.target !== undefined) {
          rows[Number(e.target.dataset.target)].target = e.target.value;
          renderInto($('[data-sum]', dialog), summary());
        }
        if (e.target.dataset.title !== undefined) rows[Number(e.target.dataset.title)].title = e.target.value;
      });
      dialog.addEventListener('click', async e => {
        if (e.target.closest('[data-add]')) {
          const ids = await pickPeople({
            title: '拆给哪些成员？',
            multiple: true,
            selected: rows.map(r => r.ownerId)
          });
          if (ids) {
            const keep = rows.filter(r => ids.includes(r.ownerId));
            rows = [...keep, ...ids.filter(id => !keep.some(r => r.ownerId === id)).map(id => ({
              ownerId: id,
              target: '',
              title: ''
            }))];
            redraw();
          }
        }
        const drop = e.target.closest('[data-drop]');
        if (drop) {
          rows.splice(Number(drop.dataset.drop), 1);
          redraw();
        }
        if (e.target.closest('[data-even]')) {
          const blank = rows.filter(r => r.target === '' || Number(r.target) === 0);
          const left = (g.target || 0) - (g.stat.assigned || 0) - rows.filter(r => !blank.includes(r)).reduce((s, r) => s + Number(r.target || 0), 0);
          const each = Math.max(0, Math.floor(left / Math.max(1, blank.length) * 100) / 100);
          blank.forEach(r => {
            r.target = String(each);
          });
          redraw();
        }
      });
      dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget,
          button = $('[data-submit]', dialog);
        if (!rows.length) return fieldError(form, '先选择要拆给哪些成员。');
        if (measure && rows.some(r => r.target === '')) return fieldError(form, '给每位成员填一个份额（可以是 0）。');
        busy(button);
        try {
          await mutate('POST', `/api/goals/${g.id}/split`, {
            items: rows.map(r => ({
              ownerId: r.ownerId,
              target: measure ? Number(r.target) : undefined,
              title: r.title,
              allowSecond: existing.has(r.ownerId)
            }))
          });
          close('ok');
          toast(`已拆给 ${rows.length} 位成员，他们会马上在“我的”里看到`);
        } catch (error) {
          showError(form, error);
          busy(button, false);
        }
      });
    }
  });
}

// ---------- 编辑 ----------
export function openEdit(goalId) {
  const g = getGoal(goalId);
  if (!g) return;
  const state = {
    ownerId: g.ownerId,
    memberIds: [...g.memberIds],
    alignId: g.alignId
  };
  const isPersonalRoot = g.scope === 'personal' && !g.parentId;
  const body = () => {
    const align = state.alignId ? getGoal(state.alignId) : null;
    return <>{"\n    "}<Ui as="label" className={"field"}><Ui as="span">{"名称"}</Ui><Ui as="input" name={"title"} maxLength={"60"} value={esc($('[name=title]', cur?.dialog)?.value ?? g.title)} /></Ui>{"\n    "}{g.kind === 'measure' ? <><Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"目标值"}</Ui><Ui as="input" name={"target"} type={"number"} step={"any"} min={"0"} value={g.target} disabled={!g.perms.core} /></Ui>{"\n      "}<Ui as="label" className={"field slim"}><Ui as="span">{"单位"}</Ui><Ui as="input" name={"unit"} maxLength={"8"} value={esc(g.unit)} disabled={!g.perms.core} /></Ui></Ui>{"\n      "}{g.perms.core ? '' : <Ui as="p" className={"hint"}>{icon('lock')}{"目标值和单位由分配这个目标的人调整；有想法可以在进展里说明。"}</Ui>}</> : ''}{"\n    "}<Ui as="div" className={"field"}><Ui as="span">{"负责人"}</Ui>{g.perms.core ? personPill(state.ownerId) : <Ui as="span" className={"pill"}>{avatar(state.ownerId, 'xs')}{esc(person(state.ownerId).name)}</Ui>}</Ui>{"\n    "}<Ui as="div" className={"field"}><Ui as="span">{"一起做的人"}</Ui><Ui as="div" className={"pills"}>{peopleChips(state.memberIds)}<Ui as="button" type={"button"} className={"btn soft sm"} data-add-members={""}>{icon('user-plus')}{"邀请协作者"}</Ui></Ui></Ui>{"\n    "}<Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"开始"}</Ui><Ui as="input" type={"date"} name={"startDate"} value={g.startDate} /></Ui><Ui as="label" className={"field slim"}><Ui as="span">{"结束"}</Ui><Ui as="input" type={"date"} name={"endDate"} value={g.endDate} /></Ui></Ui>{"\n    "}{isPersonalRoot ? <Ui as="div" className={"field"}><Ui as="span">{"挂靠的组织目标"}</Ui><Ui as="div" className={"picked"}>{align ? <>{goalLine(align)}<Ui as="button" type={"button"} className={"link"} data-pick-align={""}>{"换一个"}</Ui><Ui as="button" type={"button"} className={"link"} data-clear-align={""}>{"不挂靠"}</Ui></> : <Ui as="button" type={"button"} className={"btn soft"} data-pick-align={""}>{icon('link-2')}{"挂靠到一个组织目标"}</Ui>}</Ui></Ui> : ''}{"\n    "}<Ui as="label" className={"field"}><Ui as="span">{"说明"}</Ui><Ui as="textarea" name={"note"} rows={"3"} maxLength={"500"}>{esc($('[name=note]', cur?.dialog)?.value ?? g.note)}</Ui></Ui>{"\n    "}{g.perms.archive ? <Ui as="div" className={"danger-zone"}><Ui as="button" type={"button"} className={"btn ghost danger"} data-archive={""}>{icon('archive')}{"归档这个目标"}{children(g.id).length ? '（连同下面的拆解）' : ''}</Ui><Ui as="small" className={"muted"}>{"归档后不再出现在地图里，进展记录会保留，管理员可以恢复。"}</Ui></Ui> : ''}</>;
  };
  let cur = null;
  cur = sheet({
    title: '编辑目标',
    subtitle: esc(g.title),
    body: body(),
    footer: <><Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"取消"}</Ui><Ui as="button" type={"submit"} className={"btn primary"} data-submit={""}>{icon('check')}{"保存"}</Ui></>,
    onMount: (dialog, close) => {
      const redraw = () => {
        renderInto($('.sheet-body', dialog), body());
      };
      dialog.addEventListener('click', async e => {
        if (e.target.closest('[data-pick-owner]')) {
          const ids = await pickPeople({
            title: '换一位负责人'
          });
          if (ids) {
            state.ownerId = ids[0];
            state.memberIds = state.memberIds.filter(id => id !== ids[0]);
          }
          redraw();
        }
        if (e.target.closest('[data-add-members]')) {
          const ids = await pickPeople({
            title: '邀请谁一起做？',
            multiple: true,
            selected: state.memberIds,
            exclude: [state.ownerId]
          });
          if (ids) state.memberIds = ids;
          redraw();
        }
        const rm = e.target.closest('[data-remove-member]');
        if (rm) {
          state.memberIds = state.memberIds.filter(id => id !== Number(rm.dataset.removeMember));
          redraw();
        }
        if (e.target.closest('[data-pick-align]')) {
          const id = await pickGoal({
            title: '挂靠到哪个组织目标？',
            test: x => x.id !== g.id && x.scope === 'company',
            hint: '挂靠只是表明方向，不计入组织目标的数字'
          });
          if (id) state.alignId = id;
          redraw();
        }
        if (e.target.closest('[data-clear-align]')) {
          state.alignId = null;
          redraw();
        }
        if (e.target.closest('[data-archive]')) {
          const n = children(g.id).length;
          const ok = await confirmSheet({
            title: '归档这个目标？',
            text: `「${esc(g.title)}」${n ? `和下面的拆解` : ''}会从地图中移走，进展记录全部保留，可以由管理员恢复。`,
            ok: '归档',
            tone: 'danger'
          });
          if (!ok) return;
          try {
            await mutate('POST', `/api/goals/${g.id}/archive`, {
              version: getGoal(g.id).version
            });
            close('ok');
            toast('已归档');
            navigate(g.parentId ? '#/g/' + g.parentId : '#/map');
          } catch (error) {
            toast(esc(error.message), 'error');
          }
        }
      });
      dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget,
          button = $('[data-submit]', dialog);
        const payload = {
          version: g.version,
          title: $('[name=title]', dialog).value,
          note: $('[name=note]', dialog).value,
          startDate: $('[name=startDate]', dialog).value,
          endDate: $('[name=endDate]', dialog).value,
          memberIds: state.memberIds
        };
        if (g.perms.core) {
          payload.ownerId = state.ownerId;
          if (g.kind === 'measure') {
            payload.target = Number($('[name=target]', dialog).value);
            payload.unit = $('[name=unit]', dialog).value;
          }
        }
        if (isPersonalRoot) payload.alignId = state.alignId;
        busy(button);
        try {
          await mutate('PATCH', `/api/goals/${g.id}`, payload);
          close('ok');
          toast('已保存，大家看到的是最新版本');
        } catch (error) {
          showError(form, error);
          busy(button, false);
        }
      });
    }
  });
}
export async function toggleJoin(goalId) {
  const g = getGoal(goalId);
  const leave = g.memberIds.includes(store.me.id);
  if (leave && !(await confirmSheet({
    title: '退出协作？',
    text: `退出后「${esc(g.title)}」不再出现在你的“我参与的”里。`,
    ok: '退出'
  }))) return;
  try {
    await mutate('POST', `/api/goals/${g.id}/join`, {
      leave
    });
    toast(leave ? '已退出协作' : '已加入，一起把它做成');
  } catch (error) {
    toast(esc(error.message), 'error');
  }
}
export async function reopen(goalId) {
  try {
    await mutate('POST', `/api/goals/${goalId}/done`, {
      done: false
    });
    toast('已重新打开');
  } catch (error) {
    toast(esc(error.message), 'error');
  }
}
export async function cheer(seq, button) {
  try {
    button?.classList.add('pop');
    setTimeout(() => button?.classList.remove('pop'), 450);
    const {
      result
    } = await post(`/api/events/${seq}/cheer`, {});
    setCheer(seq, {
      count: result.count,
      cheered: result.cheered
    });
  } catch (error) {
    toast(esc(error.message), 'error');
  }
}
export async function voidCheckin(id, restore = false) {
  if (!restore && !(await confirmSheet({
    title: '撤回这条记录？',
    text: '撤回后它不再计入进度，但会保留痕迹，随时可以恢复。',
    ok: '撤回'
  }))) return false;
  try {
    await mutate('POST', `/api/checkins/${id}/void`, {
      restore
    });
    toast(restore ? '已恢复' : '已撤回');
    return true;
  } catch (error) {
    toast(esc(error.message), 'error');
    return false;
  }
}
export { departmentName, ancestors };

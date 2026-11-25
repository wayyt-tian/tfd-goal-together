import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 设置（仅公司负责人）：成员与汇报关系、组织、规则、已归档、数据。
import { activationDialog, RolesHelp, DirectoryTools, DepartmentRecovery, DataTools } from "./admin-tools.jsx";
import { get, request } from "../api.js";
import { store, person, mutate, reload, hasCapability } from "../store.js";
import { esc, icon, avatar, sheet, toast, busy, fieldError, confirmSheet, shortDate, relTime, $ } from "../ui.jsx";
import { pickPeople } from "../forms.jsx";
const TABS = [['members', 'users', '成员'], ['org', 'building-2', '组织'], ['rules', 'list-checks', '规则'], ['archived', 'archive', '已归档'], ['data', 'layers', '数据']];
const visibleTabs = () => TABS.filter(([key]) => !['rules','archived'].includes(key) || hasCapability(key==='rules'?'rules.manage':'goals.handover'));
const memberRole = u => u.role==='owner'?'公司负责人':u.role==='system_admin'?'系统管理员':store.departments.some(d=>d.managerId===u.id)||[...store.people.values()].some(p=>p.managerId===u.id&&p.active)?'业务负责人':'成员';
const s = {
  users: null,
  archived: null,
  q: '',
  dept: '',
  limit: 40,
  loading: false
};
async function loadUsers(ctx) {
  try {
    s.users = (await get('/api/admin/users')).users;
  } catch (e) {
    toast(esc(e.message), 'error');
  }
  ctx.refresh();
}
async function loadArchived(ctx) {
  try {
    s.archived = (await get('/api/archived')).items;
  } catch (e) {
    toast(esc(e.message), 'error');
  }
  ctx.refresh();
}

// 交接：把一位成员名下的全部目标交给一位在职同事（只换负责人，拆解与历史进展不变）
async function handover(user, ctx, close) {
  const ids = await pickPeople({
    title: `谁来接手 ${esc(user.name)} 的目标？`,
    exclude: [user.id],
    hint: '接手的人会成为这些目标的负责人，继续记进展、往下拆解'
  });
  if (!ids || !ids.length) return false;
  const to = person(ids[0]);
  const ok = await confirmSheet({
    title: `把 ${user.openGoals} 个目标交给 ${esc(to.name)}？`,
    text: `${esc(user.name)} 名下的目标（含已归档的）都会改由 ${esc(to.name)} 负责。拆解路径、协作者和历史进展保持原样，历史进展的记录人仍显示原来的人。`,
    ok: '确认交接'
  });
  if (!ok) return false;
  try {
    const r = await mutate('POST', `/api/admin/users/${user.id}/handover`, {
      toId: to.id
    });
    toast(`已把 ${r.count} 个目标交给 ${esc(to.name)}`);
    if (close) close('ok');
    loadUsers(ctx);
    return true;
  } catch (error) {
    toast(esc(error.message), 'error');
    return false;
  }
}
function deptOptions(selected, {
  allowNone = true,
  topOnly = false,
  exclude = null
} = {}) {
  const tops = store.departments.filter(d => !d.parentId && d.id !== exclude);
  const opts = allowNone ? [<Ui as="option" value={""} selected={!!(selected === null || selected === undefined)}>{topOnly ? '无（作为一级部门）' : '公司直属'}</Ui>] : [];
  for (const t of tops) {
    opts.push(<Ui as="option" value={t.id} selected={!!(selected === t.id)}>{esc(t.name)}</Ui>);
    if (!topOnly) for (const sub of store.departments.filter(d => d.parentId === t.id)) opts.push(<Ui as="option" value={sub.id} selected={!!(selected === sub.id)}>{"\u3000"}{esc(sub.name)}</Ui>);
  }
  return joinNodes(opts, '');
}

// ---------- 成员 ----------
function openUser(user, ctx) {
  const state = {
    managerId: user?.managerId ?? null
  };
  const managerHtml = () => state.managerId ? <Ui as="span" className={"pill"}>{avatar(state.managerId, 'xs')}{esc(person(state.managerId).name)}<Ui as="button" type={"button"} className={"link"} data-pick-manager={""}>{"换人"}</Ui><Ui as="button" type={"button"} className={"link"} data-clear-manager={""}>{"清除"}</Ui></Ui> : <Ui as="button" type={"button"} className={"btn soft sm"} data-pick-manager={""}>{icon('user-plus')}{"选择直属上级"}</Ui>;
  const editable = !user || hasCapability('roles.assign') || user.role==='member';
  sheet({
    title: user ? `编辑 ${esc(user.name)}` : '添加成员',
    subtitle: !editable?'此账号由公司负责人维护':user?'只改需要改的项，其余保持不变':'手机号作为账号，保存后生成一次性设置密码链接',
    body: <>{user && hasCapability('goals.handover') && user.openGoals ? <Ui as="div" className={"gap-hint handover-hint"}>{icon('move-right')}<Ui as="span">{user.active ? <>{"TA 正在负责 "}<Ui as="b">{user.openGoals}</Ui>{" 个目标。"}</> : <>{"TA 名下还有 "}<Ui as="b">{user.openGoals}</Ui>{" 个目标没人接手。"}</>}{"交接后由新负责人继续推进，拆解与历史进展保持原样。"}</Ui><Ui as="button" type={"button"} className={`btn ${user.active ? 'soft' : 'primary'} sm`} data-handover={""}>{icon('move-right')}{"交接给…"}</Ui></Ui> : ''}{"\n      "}<Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"姓名"}</Ui><Ui as="input" name={"name"} maxLength={"30"} value={esc(user?.name || '')} /></Ui><Ui as="label" className={"field slim"}><Ui as="span">{"职位"}</Ui><Ui as="input" name={"title"} maxLength={"20"} value={esc(user?.title || '')} placeholder={"例如 直播运营"} /></Ui></Ui>{"\n      "}<Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"手机号"}</Ui><Ui as="input" name={"phone"} inputMode={"tel"} maxLength={"20"} value={esc(user?.phone || '')} /></Ui></Ui>{"\n      "}<Ui as="label" className={"field"}><Ui as="span">{"所属部门"}</Ui><Ui as="select" name={"departmentId"}>{deptOptions(user?.departmentId ?? null)}</Ui></Ui>{"\n      "}<Ui as="div" className={"field"}><Ui as="span">{"直属上级"}</Ui><Ui as="div" data-manager={""}>{managerHtml()}</Ui><Ui as="small" className={"muted"}>{"上级可以看到下属的目标与进展；团队页也按这条汇报线生成。"}</Ui></Ui>{"\n      "}<Ui as="label" className="field"><Ui as="span">管理角色</Ui><Ui as="select" name="role" defaultValue={user?.role||'member'} disabled={!hasCapability('roles.assign')}><Ui as="option" value="member">普通成员</Ui><Ui as="option" value="system_admin">系统管理员</Ui><Ui as="option" value="owner">公司负责人</Ui></Ui><Ui as="small" className="muted">业务负责人由部门任命及汇报关系自动产生。管理角色由公司负责人任命。</Ui></Ui>{user&&editable&&user.active?<Ui as="button" type="button" className="btn soft" onClick={async()=>{if(await confirmSheet({title:'生成新的设置密码链接？',text:'旧链接将失效，此账号已登录的设备会退出。',ok:'生成链接'}))await activationDialog(user.id,()=>loadUsers(ctx));}}>生成设置密码链接</Ui>:null}{user&&editable&&!user.active?<Ui as="button" type="button" className="btn soft" data-reactivate="">恢复账号</Ui>:null}{"\n      "}{user && editable && user.id !== store.me.id && user.active ? <Ui as="div" className={"danger-zone"}><Ui as="button" type={"button"} className={"btn ghost danger"} data-deactivate={""}>{icon('log-out')}{"办理离职（停用账号）"}</Ui><Ui as="small" className={"muted"}>{"TA 的目标和记录都会保留，可以随后一键交接给别人；直属下属会自动改为汇报给 TA 的上级。"}</Ui></Ui> : ''}</>,
    footer: <>{user?<Ui as="button" type="button" className="btn ghost" data-reload-user="">载入最新资料</Ui>:null}<Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"取消"}</Ui>{editable?<Ui as="button" type={"submit"} className={"btn primary"} data-submit={""}>{icon('check')}{"保存"}</Ui>:null}</>,
    onMount: (dialog, close) => {
      dialog.addEventListener('click', async e => {
        if (e.target.closest('[data-reactivate]')) {try{await mutate('PUT','/api/users/'+user.id,{version:user.version,active:true});close('ok');toast('账号已恢复');await loadUsers(ctx);}catch(error){toast(error.message,'error');}return;}
        if (e.target.closest('[data-reload-user]')) {await loadUsers(ctx);close('ok');openUser(s.users.find(u=>u.id===user.id),ctx);return;}
        if (e.target.closest('[data-handover]')) {
          await handover(user, ctx, close);
          return;
        }
        if (e.target.closest('[data-pick-manager]')) {
          const ids = await pickPeople({
            title: '选择直属上级',
            exclude: user ? [user.id] : []
          });
          if (ids) state.managerId = ids[0];
          renderInto($('[data-manager]', dialog), managerHtml());
        }
        if (e.target.closest('[data-clear-manager]')) {
          state.managerId = null;
          renderInto($('[data-manager]', dialog), managerHtml());
        }
        if (e.target.closest('[data-deactivate]')) {
          if (!(await confirmSheet({
            title: `为 ${esc(user.name)} 办理离职？`,
            text: `账号会停用并立即退出登录；目标和进展记录保留。${user.openGoals ? `TA 名下的 ${user.openGoals} 个目标，下一步可以直接交接给别人。` : ''}`,
            ok: '确认离职',
            tone: 'danger'
          }))) return;
          try {
            await mutate('DELETE', `/api/users/${user.id}`, {version:user.version});
            close('ok');
            toast('已办理离职');
            loadUsers(ctx);
          } catch (error) {
            toast(esc(error.message), 'error');
            return;
          }
          if (hasCapability('goals.handover') && user.openGoals && (await confirmSheet({
            title: `现在交接 ${esc(user.name)} 的 ${user.openGoals} 个目标吗？`,
            text: '选一位在职同事接手，TA 会成为这些目标的新负责人。也可以稍后在「成员 › 已离职」里处理。',
            ok: '选择接手的人'
          }))) await handover({
            ...user,
            active: false
          }, ctx);
        }
      });
      dialog.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget,
          button = $('[data-submit]', dialog);
        const value = name => $(`[name=${name}]`, dialog).value.trim();
        const body = {
          name: value('name'),
          title: value('title'),
          phone: value('phone'),
          departmentId: value('departmentId') ? Number(value('departmentId')) : null,
          managerId: state.managerId,
          role: value('role'), ...(user?{version:user.version}:{})
        };
        if (!body.name) return fieldError(form, '请填写姓名。');
        busy(button);
        try {
          const saved=await mutate(user ? 'PUT' : 'POST', user ? `/api/users/${user.id}` : '/api/users', body);
          close('ok');
          toast('已保存');
          loadUsers(ctx);
          if(!user)await activationDialog(saved.id,()=>loadUsers(ctx));
        } catch (error) {
          fieldError(form, error.message);
          busy(button, false);
        }
      });
    }
  });
}
function membersTab() {
  if (!s.users) return <Ui as="div" className={"loading"}>{icon('orbit')}{"正在加载成员…"}</Ui>;
  const active = s.users.filter(u => u.active);
  const noManager = active.filter(u => !u.managerId && u.role !== 'owner').length;
  const noLogin = active.filter(u => !u.loginConfigured).length;
  const pending = s.users.filter(u => !u.active && u.openGoals);
  const pendingGoals = pending.reduce((n, u) => n + u.openGoals, 0);
  const q = s.q.trim();
  const list = s.users.filter(u => (s.dept === '' ? u.active : s.dept === 'inactive' ? !u.active : u.active && String(u.departmentId ?? 'none') === s.dept) && (!q || u.name.includes(q) || u.title.includes(q) || u.dept.includes(q) || u.phone.includes(q))).sort((a, b) => s.dept === 'inactive' ? (b.openGoals > 0) - (a.openGoals > 0) : 0);
  const withDirectory = s.users.some(u => u.directory?.directManagerId);
  return <><RolesHelp/><DirectoryTools/><Ui as="div" className={"admin-stats"}><Ui as="span"><Ui as="b">{active.length}</Ui>{"位在职"}</Ui><Ui as="span" className={noManager ? 't-watch' : ''}><Ui as="b">{noManager}</Ui>{"位未设置直属上级"}</Ui><Ui as="span" className={noLogin ? 't-watch' : ''}><Ui as="b">{noLogin}</Ui>{"位未配置登录"}</Ui>{pendingGoals ? <Ui as="span" className={"t-watch"}><Ui as="b">{pendingGoals}</Ui>{"个目标待交接"}</Ui> : ''}</Ui>{"\n    "}{pendingGoals ? <Ui as="div" className={"gap-hint"}>{icon('move-right')}<Ui as="span">{"有 "}{pendingGoals}{" 个目标挂在 "}{pending.length}{" 个已停用的账号上（多为旧版的演示角色），"}{s.dept === 'inactive' ? '点开下面标着“待交接”的账号' : '点开对应账号'}{"就能一键交给在职同事。"}</Ui>{s.dept !== 'inactive' ? <Ui as="button" type={"button"} className={"btn soft sm"} data-act={"show-inactive"}>{"去交接"}</Ui> : ''}</Ui> : ''}{"\n    "}{withDirectory && noManager ? <Ui as="div" className={"gap-hint"}>{icon('network')}<Ui as="span">{"通讯录里记录了直属上级，可以一键补到汇报线上（只补空着的，不覆盖已设置的）。"}</Ui><Ui as="button" type={"button"} className={"btn soft sm"} data-act={"apply-directory"}>{"按通讯录补全"}</Ui></Ui> : ''}{"\n    "}<Ui as="div" className={"toolbar"}>{"\n      "}<Ui as="label" className={"search wide"}>{icon('search')}<Ui as="input" type={"search"} data-keep={"admin-q"} data-input={"admin-search"} placeholder={"搜姓名、职位、部门或手机号"} value={esc(s.q)} aria-label={"搜索成员"} /></Ui>{"\n      "}<Ui as="select" data-change={"admin-dept"} aria-label={"按部门筛选"}><Ui as="option" value={""} selected={!!(s.dept === '')}>{"全部在职"}</Ui>{joinNodes(store.departments.map(d => <Ui as="option" value={d.id} selected={!!(s.dept === String(d.id))}>{d.parentId ? '　' : ''}{esc(d.name)}</Ui>), '')}<Ui as="option" value={"none"} selected={!!(s.dept === 'none')}>{"公司直属"}</Ui><Ui as="option" value={"inactive"} selected={!!(s.dept === 'inactive')}>{"已离职"}</Ui></Ui>{"\n      "}<Ui as="span" className={"grow"} /><Ui as="button" type={"button"} className={"btn primary sm"} data-act={"add-user"}>{icon('user-round-plus')}{"添加成员"}</Ui>{"\n    "}</Ui>{"\n    "}<Ui as="div" className={"admin-list"}>{joinNodes(list.slice(0, s.limit).map(u => <Ui as="button" type={"button"} className={`admin-row${u.active ? '' : ' gone'}`} data-act={"edit-user"} data-id={u.id} data-key={`au-${u.id}`} key={`au-${u.id}`}>{"\n      "}{avatar(u.id, 'md')}<Ui as="span" className={"ar-name"}><Ui as="b">{esc(u.name)}<Ui as="em" className="tag">{memberRole(u)}</Ui>{u.active ? '' : <Ui as="em" className={"tag muted"}>{"已离职"}</Ui>}{!u.active && u.openGoals ? <Ui as="em" className={"tag warn"}>{u.openGoals}{" 个目标待交接"}</Ui> : ''}</Ui><Ui as="small">{esc(u.dept)}{u.title ? ' · ' + esc(u.title) : ''}</Ui></Ui>{"\n      "}<Ui as="span" className={"ar-col"}><Ui as="small" className={"muted"}>{"直属上级"}</Ui>{u.managerId ? `${esc(u.managerName)}` : u.role === 'owner' ? <Ui as="span" className={"muted"}>{"—"}</Ui> : <Ui as="span" className={"t-watch"}>{"未设置"}</Ui>}</Ui>{"\n      "}<Ui as="span" className={"ar-col"}><Ui as="small" className={"muted"}>{"登录"}</Ui>{u.loginConfigured ? <Ui as="span">{esc(u.phoneMasked)}</Ui> : <Ui as="span" className={"muted"}>{"未配置"}</Ui>}</Ui>{"\n      "}{icon('chevron-right', 'chev')}</Ui>), '') || <Ui as="div" className={"soft-empty"}>{icon('search')}<Ui as="span">{"没有符合条件的成员。"}</Ui></Ui>}</Ui>{"\n    "}{list.length > s.limit ? <Ui as="button" type={"button"} className={"btn ghost more-btn"} data-act={"admin-more"}>{icon('chevron-down')}{"再显示 "}{Math.min(40, list.length - s.limit)}{" 位（共 "}{list.length}{" 位）"}</Ui> : ''}</>;
}

// ---------- 组织 ----------
function openDept(dept, ctx, parentId = null) {
  let managerId = dept?.managerId ?? null;
  const mHtml = () => managerId ? <Ui as="span" className={"pill"}>{avatar(managerId, 'xs')}{esc(person(managerId).name)}<Ui as="button" type={"button"} className={"link"} data-pick={""}>{"换人"}</Ui><Ui as="button" type={"button"} className={"link"} data-clear={""}>{"清除"}</Ui></Ui> : <Ui as="button" type={"button"} className={"btn soft sm"} data-pick={""}>{icon('user-plus')}{"选择负责人"}</Ui>;
  sheet({
    title: dept ? `编辑「${esc(dept.name)}」` : '添加部门',
    subtitle: '部门负责人自动能看到本部门（含下级部门）所有成员的目标',
    body: <><Ui as="label" className={"field"}><Ui as="span">{"部门名称"}</Ui><Ui as="input" name={"name"} maxLength={"40"} value={esc(dept?.name || '')} /></Ui>{"\n      "}<Ui as="label" className={"field"}><Ui as="span">{"上级部门"}</Ui><Ui as="select" name={"parentId"}>{deptOptions(dept ? dept.parentId : parentId, {
            topOnly: true,
            exclude: dept?.id
          })}</Ui></Ui>{"\n      "}<Ui as="div" className={"field"}><Ui as="span">{"负责人"}</Ui><Ui as="div" data-m={""}>{mHtml()}</Ui></Ui>{"\n      "}{dept ? <Ui as="div" className={"danger-zone"}><Ui as="button" type={"button"} className={"btn ghost danger"} data-delete={""}>{icon('x')}{"删除这个部门"}</Ui><Ui as="small" className={"muted"}>{"需要先移走部门里的成员和下级部门。"}</Ui></Ui> : ''}</>,
    footer: <><Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"取消"}</Ui><Ui as="button" type={"submit"} className={"btn primary"} data-submit={""}>{icon('check')}{"保存"}</Ui></>,
    onMount: (dialog, close) => {
      dialog.addEventListener('click', async e => {
        if (e.target.closest('[data-pick]')) {
          const ids = await pickPeople({
            title: '选择部门负责人'
          });
          if (ids) managerId = ids[0];
          renderInto($('[data-m]', dialog), mHtml());
        }
        if (e.target.closest('[data-clear]')) {
          managerId = null;
          renderInto($('[data-m]', dialog), mHtml());
        }
        if (e.target.closest('[data-delete]')) {
          if (!(await confirmSheet({
            title: `删除「${esc(dept.name)}」？`,
            text: '停用后可在已停用部门中恢复。',
            ok: '删除',
            tone: 'danger'
          }))) return;
          try {
            await mutate('DELETE', `/api/departments/${dept.id}`, {version:dept.version});
            close('ok');
            toast('已删除');
          } catch (error) {
            toast(esc(error.message), 'error');
          }
        }
      });
      dialog.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget,
          button = $('[data-submit]', dialog);
        const name = $('[name=name]', dialog).value.trim(),
          parent = $('[name=parentId]', dialog).value;
        if (!name) return fieldError(form, '请填写部门名称。');
        busy(button);
        try {
          await mutate(dept ? 'PUT' : 'POST', dept ? `/api/departments/${dept.id}` : '/api/departments', {
            name,
            parentId: parent ? Number(parent) : null,
            managerId, ...(dept?{version:dept.version}:{})
          });
          close('ok');
          toast('已保存');
        } catch (error) {
          fieldError(form, error.message);
          busy(button, false);
        }
      });
    }
  });
}
function orgTab() {
  const people = [...store.people.values()].filter(p => p.active);
  const count = id => people.filter(p => p.departmentId === id).length;
  const tops = store.departments.filter(d => !d.parentId);
  const row = (d, sub) => <Ui as="div" className={`org-row${sub ? ' sub' : ''}`} data-key={`org-${d.id}`} key={`org-${d.id}`}>{"\n      "}<Ui as="span" className={"org-name"}>{sub ? icon('corner-down-right') : icon('building-2')}<Ui as="b">{esc(d.name)}</Ui><Ui as="small">{count(d.id)}{" 人"}</Ui></Ui>{"\n      "}<Ui as="span" className={"org-mgr"}>{d.managerId ? <>{avatar(d.managerId, 'xs')}{esc(person(d.managerId).name)}</> : <Ui as="span" className={"muted"}>{"未设置负责人"}</Ui>}</Ui>{"\n      "}<Ui as="span" className={"org-act"}>{!sub ? <Ui as="button" type={"button"} className={"btn ghost sm"} data-act={"add-dept"} data-parent={d.id}>{icon('plus')}{"下级部门"}</Ui> : ''}<Ui as="button" type={"button"} className={"btn ghost sm"} data-act={"edit-dept"} data-id={d.id}>{icon('pencil')}{"编辑"}</Ui></Ui></Ui>;
  return <><Ui as="p" className={"muted"}>{"组织最多两级。部门负责人和“直属上级”两条线都会让上级看到下属的目标。"}</Ui>{"\n    "}<Ui as="div" className={"toolbar"}><Ui as="span" className={"grow"} /><Ui as="button" type={"button"} className={"btn primary sm"} data-act={"add-dept"}>{icon('plus')}{"添加一级部门"}</Ui></Ui>{"\n    "}<Ui as="div" className={"org-list"}>{joinNodes(tops.map(t => [row(t, false), joinNodes(store.departments.filter(d => d.parentId === t.id).map(d => row(d, true)), '')]), '')}{"\n    "}{people.some(p => p.departmentId === null) ? <Ui as="div" className={"org-row"}><Ui as="span" className={"org-name"}>{icon('crown')}<Ui as="b">{"公司直属"}</Ui><Ui as="small">{count(null)}{" 人"}</Ui></Ui></Ui> : ''}</Ui></>;
}

// ---------- 规则 ----------
function rulesTab() {
  const st = store.settings;
  const opt = (name, value, label, hint) => <Ui as="label" className={`choice radio${st[name] === value ? ' on' : ''}`}><Ui as="input" type={"radio"} data-keep={""} name={name} value={value} checked={!!(st[name] === value)} /><Ui as="b">{label}</Ui><Ui as="small">{hint}</Ui></Ui>;
  return <Ui as="form" className={"rules"} data-rules={""}>{"\n    "}<Ui as="fieldset"><Ui as="legend">{icon('eye')}{"谁能看到什么"}</Ui><Ui as="div" className={"choice-row two"}>{"\n      "}{opt('openness', 'path', '按路径可见（推荐）', '每个人看到和自己、自己团队相关的目标路径，以及这些路径的上层方向。')}{"\n      "}{opt('openness', 'open', '公司目标全员公开', '所有人都能看到全部公司目标的拆解；自主目标仍只对相关的人可见。')}</Ui></Ui>{"\n    "}<Ui as="fieldset"><Ui as="legend">{icon('clock')}{"多久没更新算“很久”"}</Ui><Ui as="div" className={"chips"}>{joinNodes([3, 5, 7, 10, 14].map(n => <Ui as="label" className={`chip-btn${st.staleDays === n ? ' on' : ''}`}><Ui as="input" type={"radio"} data-keep={""} name={"staleDays"} value={n} checked={!!(st.staleDays === n)} />{n}{" 天"}</Ui>), '')}</Ui>{"\n      "}<Ui as="small" className={"muted"}>{"超过这个天数没有记进展，卡片上会出现“N 天没更新”的提示（不扣分，只提醒）。"}</Ui></Ui>{"\n    "}<Ui as="fieldset"><Ui as="legend">{icon('gauge')}{"节奏判断"}</Ui>{"\n      "}<Ui as="div" className={"inline-fields"}><Ui as="label" className={"field slim"}><Ui as="span">{"比时间慢超过几个点算“稍慢”"}</Ui><Ui as="select" data-keep={""} name={"healthLine"}>{joinNodes([0, 3, 5, 8, 10].map(n => <Ui as="option" value={n} selected={!!(Math.round(st.healthLine * 100) === n)}>{n}{" 个点"}</Ui>), '')}</Ui></Ui>{"\n        "}<Ui as="label" className={"field slim"}><Ui as="span">{"比时间慢超过几个点算“落后”"}</Ui><Ui as="select" data-keep={""} name={"watchLine"}>{joinNodes([10, 15, 20, 25, 30].map(n => <Ui as="option" value={n} selected={!!(Math.round(st.watchLine * 100) === n)}>{n}{" 个点"}</Ui>), '')}</Ui></Ui></Ui>{"\n      "}<Ui as="small" className={"muted"}>{"例如本月时间过去 50%，完成 42% 就是慢了 8 个点。新目标开始后的前 3 天不会显示落后。"}</Ui></Ui>{"\n    "}<Ui as="div" className={"row-btns"}><Ui as="button" type={"button"} className={"btn primary"} data-act={"save-rules"}>{icon('check')}{"保存规则"}</Ui></Ui>{"\n  "}</Ui>;
}

// ---------- 已归档 / 数据 ----------
function archivedTab() {
  if (!s.archived) return <Ui as="div" className={"loading"}>{icon('orbit')}{"正在加载…"}</Ui>;
  if (!s.archived.length) return <Ui as="div" className={"soft-empty"}>{icon('archive')}<Ui as="span">{"还没有归档的目标。"}</Ui></Ui>;
  return <Ui as="div" className={"admin-list"}>{joinNodes(s.archived.map(a => <Ui as="div" className={"admin-row static"} data-key={`ar-${esc(a.id)}`} key={`ar-${esc(a.id)}`}>{icon(a.scope === 'personal' ? 'sprout' : 'target')}{"\n    "}<Ui as="span" className={"ar-name"}><Ui as="b">{esc(a.title)}</Ui><Ui as="small">{a.parentTitle ? `原属「${esc(a.parentTitle)}」 · ` : ''}{a.count > 1 ? `含 ${a.count - 1} 项拆解 · ` : ''}{esc(person(a.archivedBy).name)}{" "}{relTime(a.archivedAt)}{"归档"}</Ui></Ui>{"\n    "}<Ui as="button" type={"button"} className={"btn soft sm"} data-act={"restore-goal"} data-id={esc(a.id)}>{icon('undo-2')}{"恢复"}</Ui></Ui>), '')}</Ui>;
}
const pad2 = n => String(n).padStart(2, '0');
const localTime = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
function dataTab() { return <DataTools/>; }
export default {
  title: () => '设置',
  enter(params, ctx) {
    if (params.query?.show === 'inactive') {
      s.dept = 'inactive';
      s.q = '';
    }
    if (params.tab === 'members' || params.tab === 'org') loadUsers(ctx);
    if (params.tab === 'archived') loadArchived(ctx);
  },
  onStore(kind, params, ctx) {
    if (kind === 'load' && params.tab === 'members') loadUsers(ctx);
  },
  render(params) {
    const tab = visibleTabs().some(([k]) => k === params.tab) ? params.tab : 'members';
    return <Ui as="div" className={"page admin"}>{"\n      "}<Ui as="header" className={"page-head"}><Ui as="div"><Ui as="h1">{"设置"}</Ui><Ui as="p" className={"lead"}>{"成员、组织和规则。改动会实时同步给所有人。"}</Ui></Ui></Ui>{"\n      "}<Ui as="nav" className={"tabs"} aria-label={"设置分类"}>{joinNodes(visibleTabs().map(([k, ic, l]) => <Ui as="a" href={`#/admin/${k}`} className={tab === k ? 'on' : ''}>{icon(ic)}{l}</Ui>), '')}</Ui>{"\n      "}<Ui as="div" className={"tab-body"} data-key={`admin-${tab}`} key={`admin-${tab}`}>{tab === 'members' ? membersTab() : tab === 'org' ? <>{orgTab()}<DepartmentRecovery/></> : tab === 'rules' ? rulesTab() : tab === 'archived' ? archivedTab() : dataTab()}</Ui>{"\n    "}</Ui>;
  },
  actions: {
    'admin-search': (el, e, ctx) => {
      s.q = el.value;
      s.limit = 40;
      ctx.refresh();
    },
    'admin-dept': (el, e, ctx) => {
      s.dept = el.value;
      s.limit = 40;
      ctx.refresh();
    },
    'admin-more': (el, e, ctx) => {
      s.limit += 40;
      ctx.refresh();
    },
    'add-user': (el, e, ctx) => openUser(null, ctx),
    'show-inactive': (el, e, ctx) => {
      s.dept = 'inactive';
      s.q = '';
      s.limit = 40;
      ctx.refresh();
    },
    'edit-user': (el, e, ctx) => openUser(s.users.find(u => u.id === Number(el.dataset.id)), ctx),
    'add-dept': (el, e, ctx) => openDept(null, ctx, el.dataset.parent ? Number(el.dataset.parent) : null),
    'edit-dept': (el, e, ctx) => openDept(store.departments.find(d => d.id === Number(el.dataset.id)), ctx),
    'apply-directory': async (el, e, ctx) => {
      busy(el);
      try {
        const r = await mutate('POST', '/api/admin/directory-managers', {});
        toast(`已补全 ${r.changed} 条汇报关系`);
        loadUsers(ctx);
      } catch (error) {
        toast(esc(error.message), 'error');
        busy(el, false);
      }
    },
    'save-rules': async (el, e, ctx) => {
      const form = el.closest('form');
      const val = name => form.querySelector(`[name=${name}]:checked, select[name=${name}]`)?.value;
      busy(el);
      try {
        await request('PUT', '/api/settings', {
          openness: val('openness'),
          staleDays: Number(val('staleDays')),
          healthLine: Number(val('healthLine')) / 100,
          watchLine: Number(val('watchLine')) / 100
        });
        await reload();
        toast('规则已保存，所有人的状态会按新规则重新计算');
      } catch (error) {
        toast(esc(error.message), 'error');
      } finally {
        busy(el, false);
      }
    },
    'restore-goal': async (el, e, ctx) => {
      busy(el);
      try {
        await mutate('POST', `/api/goals/${encodeURIComponent(el.dataset.id)}/restore`, {});
        toast('已恢复，目标回到了地图上');
        loadArchived(ctx);
      } catch (error) {
        toast(esc(error.message), 'error');
        busy(el, false);
      }
    }
  }
};
export { shortDate };

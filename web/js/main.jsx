import { Ui, joinNodes, renderInto } from "./react-runtime.jsx";
import { setActionDispatcher } from "./react-runtime.jsx";
// 入口：启动 → 判断登录 → 外壳 + 路由 → 实时连接。页面渲染为字符串，再用轻量对比只改变化的部分，
// 这样实时数据进来时，进度条会平滑地“长”过去，输入框和展开状态也不会被打断。
import { get, post, setCsrf, connectLive } from "./api.js";
import { store, subscribe, load, sync, setLive, setOnline, setCheer, person, goal as getGoal, isAdmin, isLead, isMine, isMember, teamSet, canManageSettings } from "./store.js";
import { esc, icon, avatar, toast, celebrate, $, sheet } from "./ui.jsx";
import { openNewGoal, openCheckin, openSplit, openEdit, toggleJoin, reopen, cheer, voidCheckin } from "./forms.jsx";
import { leaveMode } from "./modes.jsx";
import { renderAuth } from "./views/auth.jsx";
import home from "./views/home.jsx";
import map from "./views/map.jsx";






import { feedSeed } from "./views/feed.jsx";
const app = document.getElementById('app');
const VIEWS = { home, map };
const lazyViews = {
  goal: () => import('./views/goal.jsx'), team: () => import('./views/team.jsx'),
  person: () => import('./views/person.jsx'), pulse: () => import('./views/pulse.jsx'),
  account: () => import('./views/account.jsx'), records: () => import('./views/records.jsx'), admin: () => import('./views/admin.jsx')
};
let routeTicket = 0;
let current = {
  name: null,
  params: {}
};
let shellReady = false;
let paintQueued = false;
let pulseBadge = 0;
let disconnect = null;
export const morph = renderInto;

// ---------- 路由 ----------
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return {
    name: 'home',
    params: {
      query
    }
  };
  if (parts[0] === 'map') return {
    name: 'map',
    params: {
      query
    }
  };
  if (parts[0] === 'g' && parts[1]) return {
    name: 'goal',
    params: {
      id: decodeURIComponent(parts[1]),
      tab: parts[2] || null,
      query
    }
  };
  if (parts[0] === 'team' && isLead()) return {
    name: 'team',
    params: {
      query
    }
  };
  if (parts[0] === 'p' && parts[1]) return {
    name: 'person',
    params: {
      id: Number(parts[1]),
      query
    }
  };
  if (parts[0] === 'pulse') return {
    name: 'pulse',
    params: {
      query
    }
  };
  if (parts[0] === 'me' && parts[1] === 'records') return {
    name: 'records',
    params: {
      query
    }
  };
  if (parts[0] === 'account') return {name:'account',params:{query}};
  if (parts[0] === 'admin' && canManageSettings()) return {
    name: 'admin',
    params: {
      tab: parts[1] || 'members',
      query
    }
  };
  return {
    name: 'home',
    params: {
      query
    }
  };
}
export const navigate = hash => {
  if (location.hash !== hash) location.hash = hash;else route();
};
const ctx = {
  refresh: () => schedulePaint(),
  navigate,
  morph
};
async function route() {
  const ticket = ++routeTicket;
  const next = parseRoute();
  if (!VIEWS[next.name]) {
    try { VIEWS[next.name] = (await lazyViews[next.name]()).default; }
    catch { toast('页面加载失败，请刷新后重试。', 'error'); return; }
    if (ticket !== routeTicket) return;
  }
  const sameView = next.name === current.name && JSON.stringify(next.params) === JSON.stringify(current.params);
  if (sameView) return schedulePaint();
  const sameScreen = next.name === current.name && next.params.id === current.params.id;
  if (current.name && VIEWS[current.name].leave) VIEWS[current.name].leave();
  current = next;
  if (next.name === 'pulse') {
    pulseBadge = 0;
  }
  VIEWS[next.name].enter?.(next.params, ctx);
  paint(!sameScreen);
  if (!sameScreen) window.scrollTo({
    top: 0
  });
}

// ---------- 外壳 ----------
const NAV = () => [['home', '#/', 'house', '我的'], ['map', '#/map', 'map', '目标地图'], ...(isLead() ? [['team', '#/team', 'users', '团队']] : []), ['pulse', '#/pulse', 'activity', '动态']];
function liveText() {
  if (store.live === 'live') return `实时同步中${store.online > 1 ? ` · ${store.online} 人在线` : ''}`;
  if (store.live === 'reconnecting') return '正在重新连接…';
  return '连接中…';
}
function roleLabel() {
  return isAdmin() ? '公司负责人' : store.access?.managementRole==='system_admin' ? '系统管理员' : isLead() ? '业务负责人' : '成员';
}
function shellHtml() {
  const me = person(store.me.id);
  return <>{"\n  "}<Ui as="header" className={"topbar"}><Ui as="div" className={"topbar-inner"}>{"\n    "}<Ui as="a" className={"brand"} href={"#/"} aria-label={"锅气家族 · 回到我的"}><Ui as="img" src={"/assets/brand/guoqi-logo-sm.webp"} alt={"锅气家族"} width={"126"} height={"32"} /><Ui as="span" className={"brand-sub"}>{"目标共创台"}</Ui></Ui>{"\n    "}<Ui as="nav" className={"nav"} aria-label={"主导航"} data-nav={""} />{"\n    "}<Ui as="div" className={"top-tools"}>{"\n      "}<Ui as="a" className={"live"} href={"#/pulse"} data-live={""} title={"新进展会自动出现，不用刷新"} />{"\n      "}<Ui as="button" type={"button"} className={"btn primary sm new-btn"} data-act={"new-goal"}>{icon('plus')}<Ui as="span">{"新建"}</Ui></Ui>{"\n      "}<Ui as="details" className={"menu me-menu"} data-keep={""}>{"\n        "}<Ui as="summary" aria-label={"我的账号"}>{avatar(store.me.id, 'md')}</Ui>{"\n        "}<Ui as="div" className={"menu-pop"}>{"\n          "}<Ui as="div" className={"menu-head"}>{avatar(store.me.id, 'lg')}<Ui as="div"><Ui as="b">{esc(me.name)}</Ui><Ui as="small">{esc(me.title || me.dept)}{" · "}{roleLabel()}</Ui></Ui></Ui>{"\n          "}<Ui as="a" href={`#/p/${store.me.id}`}>{icon('user-round')}{"我的主页"}</Ui>{"\n          "}<Ui as="a" href={"#/account"}>{icon('lock')}{"账户设置"}</Ui><Ui as="a" href={"#/me/records"}>{icon('history')}{"我记过的进展"}</Ui>{"\n          "}{canManageSettings() ? <Ui as="a" href={"#/admin"}>{icon('settings')}{"设置与成员"}</Ui> : ''}{"\n          "}<Ui as="button" type={"button"} data-act={"help"}>{icon('lightbulb')}{"怎么用"}</Ui>{"\n          "}{store.availableModes?.length>1 ? <Ui as="button" type={"button"} data-act={"switch-mode"}>{icon('refresh-cw')}{store.demo?'切换到正式使用':'体验演示'}</Ui>:null}{store.demo ? <Ui as="button" type={"button"} data-act={"switch-persona"}>{icon('refresh-cw')}{"换一个演示身份"}</Ui> : ''}{"\n          "}<Ui as="button" type={"button"} data-act={"logout"}>{icon('log-out')}{"退出登录"}</Ui>{"\n        "}</Ui>{"\n      "}</Ui>{"\n    "}</Ui>{"\n  "}</Ui></Ui>{"\n  "}{store.demo ? <Ui as="div" className={"demo-ribbon"}>{icon('sparkles')}{"演示模式：人物和数字都是虚构的"}{store.demoLive ? '，系统会模拟同事实时更新' : ''}{" "}<Ui as="button" type={"button"} className={"link"} data-act={"switch-persona"}>{"换个身份看看"}</Ui></Ui> : ''}{"\n  "}<Ui as="main" id={"main"} tabIndex={"-1"} />{"\n  "}<Ui as="nav" className={"tabbar"} aria-label={"底部导航"} data-tabbar={""} />{"\n  "}<Ui as="button" type={"button"} className={"fab"} data-act={"new-goal"} aria-label={"新建目标"}>{icon('plus')}</Ui></>;
}
function navHtml(mobile) {
  return [joinNodes(NAV().map(([name, href, ic, label]) => {
    const on = current.name === name || name === 'map' && current.name === 'goal' || name === 'team' && current.name === 'person' && current.params.id !== store.me.id;
    const badge = name === 'pulse' && pulseBadge && current.name !== 'pulse' ? <Ui as="em" className={"badge"}>{pulseBadge > 99 ? '99+' : pulseBadge}</Ui> : '';
    return <Ui as="a" href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{icon(ic)}<Ui as="span">{label}</Ui>{badge}</Ui>;
  }), ''), mobile ? '' : ''];
}
function paintChrome() {
  const nav = $('[data-nav]'),
    tab = $('[data-tabbar]'),
    live = $('[data-live]');
  if (nav) morph(nav, navHtml(false));
  if (tab) morph(tab, navHtml(true));
  if (live) morph(live, <><Ui as="i" className={`live-dot ${store.live}`} /><Ui as="span">{liveText()}</Ui></>);
}
function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    paint(false);
  });
}
function paint(fresh) {
  if (!shellReady) return;
  paintChrome();
  const view = VIEWS[current.name];
  const main = $('#main');
  const html = view.render(current.params, ctx);
  if (fresh) {
    renderInto(main, html);
    main.classList.remove('enter');
    void main.offsetWidth;
    main.classList.add('enter');
  } else morph(main, html);
  flashChanged(main);
  view.after?.(main, current.params, ctx);
  document.title = `${view.title?.(current.params) || '锅气家族'} · 目标共创台`;
}
const calm = matchMedia('(prefers-reduced-motion: reduce)');
function flashChanged(root) {
  for (const el of root.querySelectorAll('[data-flash]')) {
    const at = el.dataset.flash;
    if (el._flash === at || Date.now() - Number(at) > 4000) continue;
    el._flash = at;
    if (calm.matches || !el.animate) continue;
    el.animate([{
      boxShadow: '0 0 0 0 rgba(255,106,46,.0)',
      backgroundColor: 'rgba(255,195,77,.28)'
    }, {
      boxShadow: '0 0 0 6px rgba(255,106,46,.10)',
      offset: 0.3
    }, {
      boxShadow: '0 0 0 0 rgba(255,106,46,0)',
      backgroundColor: ''
    }], {
      duration: 1800,
      easing: 'ease-out'
    });
  }
}

// ---------- 实时提醒：只提醒和你有关的事，其余安静地出现在动态里 ----------
function related(g) {
  return g && (isMine(g) || isMember(g) || teamSet().has(g.ownerId));
}
function notify(events) {
  for (const e of events) {
    if (e.actorId === store.me.id || e.data?.simulatedQuiet) continue;
    const actor = esc(person(e.actorId).name);
    const g = getGoal(e.goalId);
    const title = esc(e.data?.title || g?.title || '');
    if (e.type === 'goal.achieved' && g && (related(g) || !g.parentId)) celebrate(`「${title}」达成啦！`);else if (e.type === 'checkin.created' && e.data?.signal === 'help' && g && (isMine(g) || teamSet().has(g.ownerId) || teamSet().has(e.actorId))) toast(`${actor} 在「${title}」上需要支持`, 'help', {
      ms: 5200
    });else if (['goal.created', 'goal.split'].includes(e.type) && (e.data?.ownerIds || []).includes(store.me.id)) toast(`${actor} 邀请你负责「${title}」`, 'ok', {
      ms: 5200
    });else if (e.type === 'member.joined' && g && isMine(g)) toast(`${actor} 加入了你的「${title}」`, 'ok');
  }
}
let shellSignature = '';
const signature = () => joinNodes([store.me.id, person(store.me.id).name, person(store.me.id).title, store.access.role, store.demo, store.demoLive], '|');
subscribe(kind => {
  if (kind === 'live') { if (shellReady) paintChrome(); return; }
  if (kind === 'load' && shellReady && signature() !== shellSignature) {
    shellSignature = signature();
    renderInto(app, shellHtml());
    if (current.name) {
      VIEWS[current.name].onStore?.(kind, current.params, ctx);
      paint(true);
    }
    return;
  }
  if (kind === 'delta' && store.lastEvents?.length) {
    const others = store.lastEvents.filter(e => e.actorId !== store.me.id);
    if (current.name !== 'pulse') pulseBadge += others.length;
    notify(store.lastEvents);
  }
  if (current.name) VIEWS[current.name].onStore?.(kind, current.params, ctx);
  schedulePaint();
});

// ---------- 全局操作（data-act） ----------
const ACTIONS = {
  'new-goal': el => {
    const parentId = el.dataset.parent || (current.name === 'goal' && getGoal(current.params.id)?.perms.child && el.classList.contains('fab') ? current.params.id : null);
    openNewGoal({
      parentId,
      scope: el.dataset.scope || null,
      kind: el.dataset.kind || null
    });
  },
  checkin: el => openCheckin(el.dataset.id),
  comment: el => openCheckin(el.dataset.id, {
    comment: true
  }),
  split: el => openSplit(el.dataset.id),
  edit: el => openEdit(el.dataset.id),
  join: el => toggleJoin(el.dataset.id),
  reopen: el => reopen(el.dataset.id),
  cheer: el => cheer(Number(el.dataset.seq), el),
  'void-checkin': async el => {
    if (await voidCheckin(el.dataset.id, el.dataset.restore === '1')) VIEWS[current.name].onStore?.('records', current.params, ctx);
  },
  go: el => navigate(el.dataset.href),
  reload: () => location.reload(),
  logout: async () => {
    try {
      await post('/api/logout', {});
    } catch {/* 已退出 */}
    location.hash = '';
    location.reload();
  },
  'switch-mode': () => leaveMode(store.demo?'formal':'demo'),
  'switch-persona': async () => {
    try {
      await post('/api/logout', {});
    } catch {/* 忽略 */}
    location.hash = '';
    location.reload();
  },
  help: () => openHelp(),
  'onboard-done': async () => {
    store.onboarded = true;
    schedulePaint();
    try {
      await post('/api/me/seen', {
        onboarded: true
      });
    } catch {/* 下次再记 */}
  }
};
setActionDispatcher((name, el, event) => {
  const handler = ACTIONS[name] || VIEWS[current.name]?.actions?.[name];
  return handler?.(el, event, ctx);
});
// 点菜单外面时收起菜单
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('details.menu[open]')) if (!menu.contains(event.target)) menu.removeAttribute('open');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const menu of document.querySelectorAll('details.menu[open]')) menu.removeAttribute('open');
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  if (!typing && shellReady && event.key === 'n' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    openNewGoal({});
  }
});
function openHelp() {
  sheet({
    title: '三句话学会用',
    subtitle: '不需要培训，按下面的节奏来就好',
    body: <><Ui as="ol" className={"help-steps"}>{"\n      "}<Ui as="li">{icon('house')}<Ui as="div"><Ui as="b">{"“我的”是你的起点"}</Ui><Ui as="p">{"你负责的、你参与的、你自己发起的目标都在这里，每张卡片上方写着它属于哪个公司目标。"}</Ui></Ui></Ui>{"\n      "}<Ui as="li">{icon('pencil')}<Ui as="div"><Ui as="b">{"有进展就“记一笔”"}</Ui><Ui as="p">{"只填这次新增的数字，一句话说明可写可不写；系统自动累加，并实时汇总到上一级。遇到卡点选“需要支持”。"}</Ui></Ui></Ui>{"\n      "}<Ui as="li">{icon('git-fork')}<Ui as="div"><Ui as="b">{"想到好点子就“新建”"}</Ui><Ui as="p">{"可以挂在任何你参与的目标下面作为新的关键路径，也可以作为自主目标。上级和同事会实时看到。"}</Ui></Ui></Ui>{"\n    "}</Ui>{"\n    "}<Ui as="div" className={"legend"}><Ui as="b">{"颜色怎么读"}</Ui><Ui as="p"><Ui as="span" className={"chip tone-ok sm"}>{icon('sun')}{"顺利"}</Ui>{" 进度跟上了时间\u3000"}<Ui as="span" className={"chip tone-watch sm"}>{icon('hourglass')}{"稍慢"}</Ui>{" 比时间慢一点\u3000"}<Ui as="span" className={"chip tone-risk sm"}>{icon('triangle-alert')}{"落后"}</Ui>{" 需要一起想办法"}</Ui>{"\n    "}<Ui as="p">{"进度条上的小竖线是“时间已经过去多少”，填充超过竖线就是跑在前面。开始后的前 3 天不会显示落后。"}</Ui></Ui></>,
    footer: <Ui as="button" type={"button"} className={"btn primary"} data-close={""}>{"知道了"}</Ui>
  });
}

// ---------- 启动 ----------
function startApp(data, csrf) {
  setCsrf(csrf);
  load(data);
  shellReady = true;
  shellSignature = signature();
  renderInto(app, shellHtml());
  current = {
    name: null,
    params: {}
  };
  route();
  feedSeed().then(() => schedulePaint());
  disconnect?.();
  disconnect = connectLive({
    onSeq: seq => {
      if (seq === null || seq > store.seq) sync();
    },
    onCheer: data => {
      setCheer(data.seq, data.by === store.me.id ? {
        count: data.count,
        cheered: data.on
      } : {
        count: data.count
      });
      if (data.on && data.actorId === store.me.id && data.by !== store.me.id) toast(`${esc(person(data.by).name)} 给你的进展点了个赞`, 'cheer', {
        image: '/assets/brand/ip-thumbs.webp'
      });
    },
    onPresence: setOnline,
    onState: setLive
  });
  if (!store.demo) {
    post('/api/me/seen', {
      seq: store.seq
    }).catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') post('/api/me/seen', {
        seq: store.seq
      }).catch(() => {});
    });
  }
}
addEventListener('hashchange', () => {
  if (shellReady) route();
});
setInterval(() => {
  if (shellReady && document.visibilityState === 'visible') schedulePaint();
}, 30000); // 让“几分钟前”保持新鲜

async function boot() {
  try {
    const session = await get('/api/session');
    if (session.authenticated && !location.hash.startsWith('#/activate')) return startApp(session.data, session.csrf);
    renderAuth(app, session, ({
      data,
      csrf
    }) => startApp(data, csrf));
  } catch (error) {
    renderInto(app, <Ui as="div" className={"boot error"}><Ui as="img" src={"/assets/brand/ip-think.webp"} alt={""} width={"140"} /><Ui as="p">{esc(error.message || '暂时打不开，请稍后刷新。')}</Ui><Ui as="button" className={"btn primary"} type={"button"} data-act={"reload"}>{"刷新"}</Ui></Ui>);
  }
}
boot();

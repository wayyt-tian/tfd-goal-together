import { mountPortal, Ui, joinNodes, renderInto } from "./react-runtime.jsx";
// 界面小工具：所有页面共用的展示规则都在这里，保证同一个状态在任何地方看起来都一样。
import { ICONS } from "./icons.jsx";
import { store, person } from "./store.js";
export const esc = value => String(value ?? '');
export const icon = (name, cls = '') => <Ui as="svg" className={`i ${cls}`} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"} aria-hidden={"true"}>{ICONS[name] || ICONS.circle}</Ui>;
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---------- 数字 ----------
export function num(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const d = digits ?? (abs >= 100 ? 1 : abs >= 10 ? 1 : 2);
  return Number(value.toFixed(d)).toLocaleString('zh-CN', {
    maximumFractionDigits: d
  });
}
export const withUnit = (value, unit) => <>{num(value)}{unit ? <Ui as="small">{esc(unit)}</Ui> : ''}</>;
export const plainUnit = (value, unit) => `${num(value)}${unit ? ' ' + unit : ''}`;
export function pct(value, digits = 0) {
  if (value === null || value === undefined) return '—';
  const v = value * 100;
  return `${Number(v.toFixed(Math.abs(v) < 10 && digits === 0 ? 1 : digits))}%`;
}
export function points(deviation) {
  const v = Math.round(Math.abs(deviation) * 100);
  return v === 0 ? '和时间同步' : deviation > 0 ? `领先 ${v} 个点` : `慢了 ${v} 个点`;
}

// ---------- 状态 ----------
export const STATUS = {
  ok: {
    label: '顺利',
    icon: 'sun',
    tone: 'ok'
  },
  watch: {
    label: '稍慢',
    icon: 'hourglass',
    tone: 'watch'
  },
  risk: {
    label: '落后',
    icon: 'triangle-alert',
    tone: 'risk'
  },
  done: {
    label: '已达成',
    icon: 'party-popper',
    tone: 'done'
  },
  upcoming: {
    label: '未开始',
    icon: 'sunrise',
    tone: 'muted'
  },
  neutral: {
    label: '未定数字',
    icon: 'circle-dot',
    tone: 'muted'
  }
};
export function statusChip(stat, {
  small = false
} = {}) {
  if (!stat) return '';
  const s = STATUS[stat.status] || STATUS.neutral;
  return <Ui as="span" className={`chip tone-${s.tone}${small ? ' sm' : ''}`}>{icon(s.icon)}{s.label}</Ui>;
}
export function flags(stat, {
  compact = false
} = {}) {
  if (!stat) return '';
  const out = [];
  if (stat.signal === 'help' && stat.status !== 'done') out.push(<Ui as="span" className={`chip tone-help${compact ? ' sm' : ''}`}>{icon('life-buoy')}{"需要支持"}</Ui>);
  if (stat.stale) out.push(<Ui as="span" className={`chip tone-quiet${compact ? ' sm' : ''}`}>{icon('clock')}{stat.ownLast ? daysSince(stat.ownLast) + ' 天没更新' : '还没记过进展'}</Ui>);
  return joinNodes(out, '');
}
export function daysSince(date) {
  const a = Date.UTC(...store.today.split('-').map((v, i) => i === 1 ? v - 1 : +v));
  const b = Date.UTC(...date.split('-').map((v, i) => i === 1 ? v - 1 : +v));
  return Math.round((a - b) / 86400000);
}
export function leafSummary(stat) {
  if (!stat || !stat.childCount) return '';
  const l = stat.leaf;
  const parts = [`${l.total} 项`];
  if (l.done) parts.push(`${l.done} 已达成`);
  if (l.risk) parts.push(<Ui as="b" className={"t-risk"}>{l.risk}{" 落后"}</Ui>);
  if (l.watch) parts.push(<Ui as="b" className={"t-watch"}>{l.watch}{" 稍慢"}</Ui>);
  if (l.help) parts.push(<Ui as="b" className={"t-help"}>{l.help}{" 需要支持"}</Ui>);
  return joinNodes(parts, ' · ');
}
export function kindLabel(goal) {
  return goal.kind === 'action' ? '做完就行' : '有数字';
}

// ---------- 进度 ----------
export function bar(stat, {
  size = 'md'
} = {}) {
  if (!stat || stat.completion === null) return <Ui as="div" className={`bar ${size} empty`}><Ui as="i" style={{
      "width": "0"
    }} /></Ui>;
  const s = STATUS[stat.status] || STATUS.neutral;
  const fill = Math.max(0, Math.min(1, stat.completion));
  const time = Math.max(0, Math.min(1, stat.timeProgress));
  return <Ui as="div" className={`bar ${size} tone-${s.tone}`} role={"img"} aria-label={`完成 ${pct(stat.completion)}，时间过去 ${pct(stat.timeProgress)}`}><Ui as="i" style={{
      "width": `${(fill * 100).toFixed(1)}%`
    }} />{stat.status !== 'done' && stat.status !== 'upcoming' ? <Ui as="b" className={"time"} style={{
      "left": `${(time * 100).toFixed(1)}%`
    }} title={`时间已过 ${pct(stat.timeProgress)}`} /> : ''}</Ui>;
}
export function ring(stat, size = 64) {
  const completion = stat?.completion ?? 0;
  const s = STATUS[stat?.status] || STATUS.neutral;
  const r = 26,
    c = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(1, completion));
  const time = Math.max(0, Math.min(1, stat?.timeProgress ?? 0));
  const angle = time * 2 * Math.PI - Math.PI / 2;
  return <Ui as="svg" className={`ring tone-${s.tone}`} width={size} height={size} viewBox={"0 0 64 64"} aria-hidden={"true"}>{"\n    "}<Ui as="circle" cx={"32"} cy={"32"} r={r} className={"track"} />{"\n    "}<Ui as="circle" cx={"32"} cy={"32"} r={r} className={"fill"} strokeDasharray={`${(fill * c).toFixed(1)} ${c.toFixed(1)}`} transform={"rotate(-90 32 32)"} />{"\n    "}{stat && !['done', 'upcoming'].includes(stat.status) ? <Ui as="circle" className={"tick"} cx={(32 + r * Math.cos(angle)).toFixed(1)} cy={(32 + r * Math.sin(angle)).toFixed(1)} r={"3.2"} /> : ''}{"\n    "}<Ui as="text" x={"32"} y={"36"} textAnchor={"middle"}>{stat?.completion === null || stat?.completion === undefined ? '—' : Math.round(completion * 100) + '%'}</Ui></Ui>;
}

// ---------- 人 ----------
const HUES = [18, 32, 8, 200, 160, 265, 340, 45, 120, 220];
export function avatar(id, size = 'md', short = false) {
  const p = person(id);
  const name = p.name || '?';
  const cjk = /^[\u4e00-\u9fa5]+$/.test(name);
  // 叠放时只显示一个字，避免被后一个头像挡住
  if (size === 'xs') short = true; // 最小号头像旁边都跟着名字，显示一个字就够
  const label = short ? cjk ? name.slice(-1) : name.slice(0, 1).toUpperCase() : cjk ? name.slice(-2) : name.slice(0, 2).toUpperCase();
  const hue = HUES[Math.abs([...name].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % HUES.length];
  return <Ui as="span" className={`avatar ${size}${p.active === false ? ' gone' : ''}`} style={{
    "--h": hue
  }} title={`${esc(name)}${p.active === false ? '（已离职）' : ''}`} aria-hidden={"true"}>{esc(label)}</Ui>;
}
export function avatarStack(ids, max = 4) {
  const list = [...new Set(ids)];
  return <Ui as="span" className={"stack"}>{joinNodes(list.slice(0, max).map(id => avatar(id, 'sm', list.length > 1)), '')}{list.length > max ? <Ui as="span" className={"avatar sm more"}>{"+"}{list.length - max}</Ui> : ''}</Ui>;
}
export const personName = id => [esc(person(id).name), person(id).active === false ? <Ui as="small" className={"muted"}>{"（已离职）"}</Ui> : ''];

// ---------- 时间 ----------
export function relTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff < 6 * 3600000) return `${Math.floor(diff / 3600000)} 小时前`;
  const label = dayLabel(iso);
  return label === '今天' ? hm : `${label} ${hm}`;
}
export function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dayLabel(iso) {
  const date = localDate(iso);
  const gap = daysSince(date);
  if (gap === 0) return '今天';
  if (gap === 1) return '昨天';
  if (gap === 2) return '前天';
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
export function shortDate(date) {
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
export function period(goal) {
  return `${shortDate(goal.startDate)} – ${shortDate(goal.endDate)}`;
}
export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
}

// ---------- 提示与弹层 ----------
export function toast(message, tone = 'ok', {
  image = null,
  ms = 3200
} = {}) {
  const box = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast tone-${tone}`;
  const dispose = mountPortal(node, <>{image ? <Ui as="img" src={image} alt={""} width={"44"} height={"44"} /> : icon(tone === 'error' ? 'info' : tone === 'cheer' ? 'heart' : 'check')}<Ui as="span">{message}</Ui></>);
  box.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => {
      dispose();
      node.remove();
    }, 300);
  }, ms);
}
const stack = [];
// 底部弹出的“操作单”：手机上从底部滑出，电脑上居中显示。
export function sheet({
  title,
  subtitle = '',
  body,
  wide = false,
  onMount,
  onClose,
  footer = ''
}) {
  const dialog = document.createElement('dialog');
  dialog.className = `sheet${wide ? ' wide' : ''}`;
  const dispose = mountPortal(dialog, <Ui as="form" method={"dialog"} className={"sheet-inner"} tabIndex={"-1"} noValidate={true}>{"\n      "}<Ui as="header" className={"sheet-head"}><Ui as="div"><Ui as="h2">{title}</Ui>{subtitle ? <Ui as="p">{subtitle}</Ui> : ''}</Ui>{"\n      "}<Ui as="button" type={"button"} className={"icon-btn"} data-close={""} aria-label={"关闭"}>{icon('x')}</Ui></Ui>{"\n      "}<Ui as="div" className={"sheet-body"}>{body}</Ui>{footer ? <Ui as="footer" className={"sheet-foot"}>{footer}</Ui> : ''}</Ui>);
  document.getElementById('sheets').appendChild(dialog);
  const close = value => {
    if (!dialog.open) return;
    dialog.classList.add('closing');
    setTimeout(() => {
      dialog.close(value);
    }, 160);
  };
  dialog.addEventListener('close', () => {
    dispose();
    dialog.remove();
    stack.splice(stack.indexOf(dialog), 1);
    onClose?.(dialog.returnValue);
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close('');
    if (event.target.closest('[data-close]')) {
      event.preventDefault();
      close('');
    }
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close('');
  });
  stack.push(dialog);
  dialog.showModal();
  onMount?.(dialog, close);
  const first = dialog.querySelector('[autofocus], input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select');
  // 电脑上直接聚焦第一个输入框；手机上不主动弹键盘，焦点放在弹层本身
  if (first && matchMedia('(hover: hover)').matches) first.focus();else dialog.querySelector('.sheet-inner').focus({
    preventScroll: true
  });
  return {
    dialog,
    close
  };
}
export function confirmSheet({
  title,
  text,
  ok = '确定',
  tone = 'primary'
}) {
  return new Promise(resolve => {
    let result = false;
    sheet({
      title,
      body: <Ui as="p" className={"confirm-text"}>{text}</Ui>,
      footer: <><Ui as="button" type={"button"} className={"btn ghost"} data-close={""}>{"再想想"}</Ui><Ui as="button" type={"button"} className={`btn ${tone}`} data-ok={""}>{ok}</Ui></>,
      onMount: (dialog, close) => dialog.querySelector('[data-ok]').addEventListener('click', () => {
        result = true;
        close('ok');
      }),
      onClose: () => resolve(result)
    });
  });
}
export function busy(button, on = true) {
  if (!button) return;
  button.disabled = on;
  button.classList.toggle('is-busy', on);
}
export function fieldError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.querySelector('.sheet-body, .auth-body')?.appendChild(box);
  }
  renderInto(box, message ? [icon('info'), esc(message)] : '');
  box.hidden = !message;
}

// 喜报：自己或团队的目标刚刚达成时，锅气家族的小伙伴出来庆祝一下
export function celebrate(text) {
  const node = document.createElement('div');
  node.className = 'celebrate';
  const dispose = mountPortal(node, <><Ui as="div" className={"confetti"} aria-hidden={"true"}>{joinNodes(Array.from({
        length: 18
      }, (_, i) => <Ui as="i" style={{
        "--i": i
      }} />), '')}</Ui><Ui as="img" src={"/assets/brand/ip-cheer.webp"} alt={""} width={"120"} height={"120"} /><Ui as="p">{text}</Ui></>);
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => {
      dispose();
      node.remove();
    }, 500);
  }, 3600);
}
export function emptyState({
  image = 'ip-think',
  title,
  text = '',
  action = ''
}) {
  return <Ui as="div" className={"empty"}><Ui as="img" src={`/assets/brand/${image}.webp`} alt={""} width={"132"} height={"132"} loading={"lazy"} /><Ui as="h3">{title}</Ui>{text ? <Ui as="p">{text}</Ui> : ''}{action}</Ui>;
}

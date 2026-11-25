import { Ui } from './react-runtime.jsx';
export function leaveMode(mode) {
  const dirty = document.querySelector('dialog[open]') || [...document.querySelectorAll('input:not([type=search]),textarea')].some(el=>el.value!==el.defaultValue);
  if (dirty && !confirm('还有尚未保存的内容，切换后不会保留。确定切换吗？')) return;
  location.assign('/'+mode+'/');
}
export function ModeLinks({session}) {
  if(session.availableModes?.length<2)return null;
  return <Ui as="nav" className="mode-links" aria-label="使用模式"><Ui as="a" href="/formal/" aria-current={!session.demo?'page':undefined} onClick={e=>{e.preventDefault();leaveMode('formal');}}>正式使用</Ui><Ui as="a" href="/demo/" aria-current={session.demo?'page':undefined} onClick={e=>{e.preventDefault();leaveMode('demo');}}>体验演示</Ui></Ui>;
}

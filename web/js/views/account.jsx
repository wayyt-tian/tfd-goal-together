import {Ui} from '../react-runtime.jsx';
import {store,person} from '../store.js';
import {post,get} from '../api.js';
import {icon,toast,confirmSheet,fieldError,busy} from '../ui.jsx';
let account=null;
export default {
 title:()=> '账户设置',
 async enter(params,ctx){account=null;try{account=(await get('/api/account')).account;}catch(e){toast(e.message,'error');}ctx.refresh();},
 render(){
  if(!account)return <Ui as="div" className="page"><Ui as="p">正在加载账户…</Ui></Ui>;
  const role=account.role==='owner'?'公司负责人':account.role==='system_admin'?'系统管理员':account.businessRole==='lead'?'业务负责人':'成员';
  return <Ui as="div" className="page account-page"><Ui as="header" className="page-head"><Ui as="div"><Ui as="h1">账户设置</Ui><Ui as="p" className="lead">管理登录密码和设备。</Ui></Ui></Ui>
   <Ui as="section" className="section"><Ui as="h2">我的资料</Ui><Ui as="dl" className="account-facts">{[['姓名',account.name],['手机号',account.phone],['角色',role],['所属部门',account.dept],['直属上级',account.managerName||'未设置']].map(([label,value])=><Ui as="div" key={label}><Ui as="dt">{label}</Ui><Ui as="dd">{value}</Ui></Ui>)}</Ui><Ui as="p" className="muted">资料或组织关系需要调整时，请联系管理员。</Ui></Ui>
   <Ui as="form" className="account-password" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type=submit]');if(form.password.value!==form.confirmPassword.value)return fieldError(form,'两次输入的密码不一致。');busy(button);try{await post('/api/account/password',{currentPassword:form.currentPassword.value,password:form.password.value});location.assign(location.pathname);}catch(error){fieldError(form,error.message);busy(button,false);}}}>
    <Ui as="h2">修改密码</Ui>{[['currentPassword','原密码','current-password'],['password','新密码','new-password'],['confirmPassword','再次输入新密码','new-password']].map(([name,label,complete])=><Ui as="label" className="field" key={name}><Ui as="span">{label}</Ui><Ui as="input" name={name} type="password" maxLength={128} autoComplete={complete}/></Ui>)}<Ui as="p" className="muted small">新密码为 10 至 128 个字符，修改后所有设备需要重新登录。</Ui><Ui as="p" className="form-error" role="alert" hidden /><Ui as="button" type="submit" className="btn primary">保存新密码</Ui>
   </Ui><Ui as="section" className="section"><Ui as="h2">登录设备</Ui><Ui as="p" className="muted">在其他设备登录过？可以一次退出全部设备，包括当前设备。</Ui><Ui as="button" type="button" className="btn soft" onClick={async()=>{if(!await confirmSheet({title:'退出全部设备？',text:'需要重新输入手机号和密码登录。',ok:'退出全部设备'}))return;try{await post('/api/account/sessions/revoke',{});location.assign(location.pathname);}catch(e){toast(e.message,'error');}}}>{icon('log-out')}退出全部设备</Ui></Ui>
  </Ui>;
 }
};

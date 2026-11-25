import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 进入前的三种页面：演示身份选择 / 首次初始化公司负责人 / 日常登录。
import { ModeLinks } from "../modes.jsx";
import { get, post } from "../api.js";
import { esc, icon } from "../ui.jsx";
let currentSession = {};
function frame(inner, {
  image = 'ip-full',
  title = '一起把目标做成',
  text = '目标从公司一路拆到每个人，进展实时汇总。不比谁压力大，比谁跑得巧。'
} = {}) {
  return <Ui as="div" className={"auth"}>{"\n    "}<Ui as="aside" className={"auth-brand"}>{"\n      "}<Ui as="span" className={"auth-logo"}><Ui as="img" src={"/assets/brand/guoqi-logo.webp"} alt={"锅气家族"} width={"170"} height={"43"} /></Ui>{"\n      "}<Ui as="div" className={"auth-ip"}><Ui as="img" src={`/assets/brand/${image}.webp`} alt={""} width={"260"} height={"264"} /></Ui>{"\n      "}<Ui as="h2">{title}</Ui><Ui as="p">{text}</Ui>{"\n      "}<Ui as="ul" className={"auth-points"}><Ui as="li">{icon('goal')}{"看得见：我和哪些公司目标有关"}</Ui><Ui as="li">{icon('zap')}{"记得快：30 秒记一笔，自动汇总"}</Ui><Ui as="li">{icon('sparkles')}{"长得出：好点子随手建成新路径"}</Ui></Ui>{"\n    "}</Ui>{"\n    "}<Ui as="main" className={"auth-main"} id={"main"}><ModeLinks session={currentSession} />{inner}</Ui>{"\n  "}</Ui>;
}
function bindForm(root, url, onAuthed, collect) {
  const form = root.querySelector('form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    const box = form.querySelector('.form-error');
    box.hidden = true;
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      onAuthed(await post(url, collect(form)));
    } catch (error) {
      renderInto(box, [icon('info'), esc(error.message)]);
      box.hidden = false;
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  });
}
const field = (name, label, attrs = {}) => <Ui as="label" className={"field"}><Ui as="span">{label}</Ui><Ui as="input" name={name} {...attrs} /></Ui>;
export async function renderAuth(app, session, onAuthed) {
  currentSession=session;
  if (session.demo && !location.hash.startsWith('#/activate')) {
    let personas = [],
      live = false;
    try {
      ({
        personas,
        live
      } = await get('/api/demo/personas'));
    } catch {/* 演示身份不可用时回到登录 */}
    if (personas.length) {
      renderInto(app, frame(<Ui as="div" className={"auth-card wide"}>{"\n        "}<Ui as="p" className={"eyebrow"}>{icon('sparkles')}{"演示模式 · 所有人物和数字都是虚构的"}</Ui>{"\n        "}<Ui as="h1">{"选一个身份，看看不同的人看到什么"}</Ui>{"\n        "}<Ui as="p" className={"muted"}>{"这家虚构公司有 63 位同事、5 个公司目标"}{live ? '；系统会每隔半分钟模拟一位同事更新进展，你可以观察页面实时“呼吸”' : ''}{"。"}</Ui>{"\n        "}<Ui as="div" className={"personas"}>{joinNodes(personas.map(p => <Ui as="button" type={"button"} className={"persona"} data-user={p.userId}>{"\n          "}<Ui as="span" className={"persona-tag"}>{esc(p.label)}</Ui><Ui as="b">{esc(p.name)}</Ui><Ui as="small">{esc(p.title || '')}{p.title && p.dept ? ' · ' : ''}{esc(p.dept || '')}</Ui><Ui as="span" className={"persona-sum"}>{esc(p.summary)}</Ui>{icon('arrow-right', 'go')}</Ui>), '')}</Ui>{"\n        "}<Ui as="p" className={"form-error"} role={"alert"} hidden={true} />{"\n      "}</Ui>, {
        image: 'ip-happy',
        title: '欢迎体验锅气家族目标共创台'
      }));
      app.querySelector('.personas').addEventListener('click', async event => {
        const button = event.target.closest('[data-user]');
        if (!button) return;
        button.classList.add('is-busy');
        try {
          onAuthed(await post('/api/demo/login', {
            userId: Number(button.dataset.user)
          }));
        } catch (error) {
          const box = app.querySelector('.form-error');
          renderInto(box, [icon('info'), esc(error.message)]);
          box.hidden = false;
          button.classList.remove('is-busy');
        }
      });
      return;
    }
  }
  if (location.hash.startsWith('#/activate')) {
    const token=new URLSearchParams(location.hash.split('?')[1]||'').get('token');
    renderInto(app, frame(<Ui as="form" className="auth-card" noValidate>
      <Ui as="h1">设置你的密码</Ui><Ui as="p" className="muted">链接仅能使用一次，生成后 30 分钟内有效。</Ui>
      <Ui as="div" className="auth-body">{field('password','新密码',{type:'password',autoComplete:'new-password',minLength:10,maxLength:128})}{field('confirmPassword','再次输入密码',{type:'password',autoComplete:'new-password',maxLength:128})}<Ui as="p" className="muted small">密码长度为 10 至 128 个字符。</Ui><Ui as="p" className="form-error" role="alert" hidden /></Ui>
      <Ui as="button" type="submit" className="btn primary block">设置密码</Ui><Ui as="a" className="btn ghost block" href={location.pathname}>返回登录</Ui>
    </Ui>));
    bindForm(app,'/api/account/activate',()=>{location.assign(location.pathname);},f=>{
      if(f.password.value!==f.confirmPassword.value)throw new Error('两次输入的密码不一致。');
      return {token,password:f.password.value};
    });return;
  }
  if (!session.configured) {
    renderInto(app, frame(<Ui as="form" className="auth-card" noValidate>
      <Ui as="h1">设置公司负责人账号</Ui><Ui as="p" className="muted">首次配置后，在设置里建立组织、开通成员账号并创建公司目标。正式数据从空白开始。</Ui>
      <Ui as="div" className="auth-body">{field('name','你的姓名',{maxLength:30,autoComplete:'name'})}{field('phone','手机号（登录账号）',{inputMode:'tel',maxLength:20,autoComplete:'tel'})}{field('password','登录密码',{type:'password',minLength:10,maxLength:128,autoComplete:'new-password'})}{field('confirmPassword','再次输入密码',{type:'password',maxLength:128,autoComplete:'new-password'})}{field('setupToken','初始化凭证',{autoComplete:'off',maxLength:64})}<Ui as="p" className="muted small">请向服务器管理员获取本机初始化凭证。密码为 10 至 128 个字符。</Ui><Ui as="p" className="form-error" role="alert" hidden /></Ui>
      <Ui as="button" type="submit" className="btn primary block">开始使用</Ui>
    </Ui>));
    bindForm(app,'/api/setup',onAuthed,f=>{
      if(f.password.value!==f.confirmPassword.value)throw new Error('两次输入的密码不一致。');
      return {name:f.name.value.trim(),phone:f.phone.value.trim(),password:f.password.value,setupToken:f.setupToken.value.trim()};
    });return;
  }
  renderInto(app, frame(<Ui as="form" className="auth-card" noValidate>
    <Ui as="h1">登录目标共创台</Ui><Ui as="p" className="muted">使用管理员为你开通的手机号和密码。</Ui>
    <Ui as="div" className="auth-body">{field('phone','手机号',{inputMode:'tel',autoComplete:'username',maxLength:20,autoFocus:true})}{field('password','密码',{type:'password',autoComplete:'current-password',maxLength:128})}<Ui as="p" className="form-error" role="alert" hidden /></Ui>
    <Ui as="button" type="submit" className="btn primary block">登录</Ui><Ui as="p" className="muted small center">首次使用或忘记密码？请联系管理员获取一次性设置密码链接。</Ui>
  </Ui>));
  bindForm(app,'/api/login',onAuthed,f=>({phone:f.phone.value.trim(),password:f.password.value}));
}

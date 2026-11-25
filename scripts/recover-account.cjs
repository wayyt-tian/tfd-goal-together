'use strict';
const {createDatabase}=require('../src/db/index.cjs');
const {issueToken}=require('../src/lib/accounts.cjs');
(async()=>{
 const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
 const phone=option('phone');if(!/^1[3-9]\d{9}$/.test(phone||''))throw new Error('请指定 --phone=公司负责人手机号。默认只检查，追加 --apply 才生成恢复链接。');
 const db=createDatabase();
 try {
  const apply=process.argv.includes('--apply');
  await db.scope(async()=>{
   const user=await db.one("SELECT id FROM users WHERE phone=? AND role='owner' AND active=1",phone);
   if(!user)throw new Error('没有匹配的在职公司负责人。');
   if(!apply){console.log('账号存在，可追加 --apply 生成一次性恢复链接。');return;}
   const token=await issueToken(db,user.id,user.id);
   await db.run('DELETE FROM sessions WHERE user_id=?',user.id);
   await db.run("INSERT INTO audit(actor,action,subject,created_at) VALUES (?,'account.recovery',?,now())",user.id,String(user.id));
   await db.run("INSERT INTO events(actor_id,type,payload,created_at) VALUES (?,'org.changed',?,now())",user.id,JSON.stringify({action:'account.recovery'}));
   db.context().seq=(await db.one('SELECT value FROM event_clock')).value;db.context().eventTypes.add('org.changed');await db.notify();
   db.context().afterCommit=[()=>{
    const origin=option('origin')||process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${process.env.PORT||4173}`;
    console.log('恢复链接（30 分钟有效，仅一次，请交给负责人本人）：\n'+origin.replace(/\/$/,'')+'/formal/#/activate?token='+token);
   }];
  },{write:apply,lock:apply?'organization':null});
 }finally {await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

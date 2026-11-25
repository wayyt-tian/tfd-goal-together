'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {startServer,ok,run}=require('./test-helpers.cjs');
const {hashPassword}=require('../src/lib/accounts.cjs');
(async()=>{
 const s=await startServer({legacyFixtures:false,env:{GUOQI_DUAL:'1',GUOQI_TODAY:'2026-11-25'}});
 const call=(who,method,url,body,headers)=>s.rawCall(who,method,'/formal'+url,body,headers);
 const boot=async who=>ok(await call(who,'GET','/api/bootstrap')).data;
 const users=async()=>ok(await call('owner','GET','/api/admin/users')).users;
 const tokenOf=result=>new URLSearchParams(result.result.path.split('?')[1]).get('token');
 const password='虚构正式账号密码1234';let ids={},dept,root,child;
 const issue=async id=>tokenOf(ok(await call('owner','POST','/api/admin/users/'+id+'/activation',{})));
 async function add(key,body){ids[key]=ok(await call('owner','POST','/api/users',body)).result.id;return ids[key];}
 async function activate(key){const token=await issue(ids[key]);ok(await call('anonymous','POST','/api/account/activate',{token,password}));}
 const login=(key,phone,pass=password)=>call(key,'POST','/api/login',{phone,password:pass});
 try {await run('正式模式与隔离',[
  ['双模式入口可访问，初始化凭证必要且只能初始化一次',async()=>{
   const page=await fetch(s.origin,{redirect:'manual'});assert.equal(page.headers.get('location'),'/formal/');
   assert.equal((await fetch(s.origin+'/formal/')).status,200);assert.equal((await fetch(s.origin+'/demo/')).status,200);
   assert.equal((await fetch(s.origin+'/api/session')).status,404);
   const session=ok(await call('anon','GET','/api/session'));assert.equal(session.mode,'formal');assert.deepEqual(session.availableModes,['formal','demo']);
   const body={name:'虚构正式负责人',phone:'13900009101',password};
   assert.equal((await call('bad','POST','/api/setup',{...body,setupToken:'错误'})).status,403);
   const setupToken=JSON.parse(fs.readFileSync(path.join(s.dir,'formal/setup-token.json'))).token;
   const results=await Promise.all(['first','second'].map(w=>call(w,'POST','/api/setup',{...body,setupToken})));
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);s.jar.owner=s.jar[results[0].status===200?'first':'second'];
   const data=await boot('owner');assert.equal(data.departments.length,0);assert.equal(data.goals.length,0);assert.equal(data.people.length,1);
   assert.equal(fs.existsSync(path.join(s.dir,'formal/setup-token.json')),false);
  }],
  ['演示身份与会话不能访问正式实例，正式接口不提供免密演示',async()=>{
   const login=ok(await s.rawCall('demo','POST','/demo/api/demo/login',{userId:1}));assert.equal(login.data.demo,true);
   const cookie=s.jar.demo.cookie;assert.match(cookie,/guoqi_demo=/);
   assert.equal((await call('cross','GET','/api/bootstrap',undefined,{Cookie:cookie})).status,401);
   assert.equal((await call('cross','GET','/api/bootstrap',undefined,{Cookie:cookie.replace('guoqi_demo=','guoqi_formal=')})).status,401);
   assert.equal((await call('owner','POST','/api/demo/login',{userId:1})).status,404);
   assert.equal((await call('owner','GET','/api/demo/personas')).status,404);
   assert.equal((await boot('owner')).goals.length,0);
   assert.match(s.jar.owner.cookie,/guoqi_formal=/);
  }],
  ['账号开通、链接更替与并发兑换，旧验证字段不能登录',async()=>{
   dept=ok(await call('owner','POST','/api/departments',{name:'虚构业务部'})).result.id;
   await add('admin',{name:'虚构系统管理员',phone:'13900009102',role:'system_admin'});
   await add('lead',{name:'虚构业务负责人',phone:'13900009103',departmentId:dept});
   await add('member',{name:'虚构成员',phone:'13900009104',departmentId:dept,managerId:ids.lead});
   await add('other',{name:'虚构无关成员',phone:'13900009105'});
   const old=await issue(ids.member),fresh=await issue(ids.member);
   assert.equal((await call('anon','POST','/api/account/activate',{token:old,password})).status,400);
   const redeemed=await Promise.all([1,2].map(()=>call('anon','POST','/api/account/activate',{token:fresh,password})));
   assert.deepEqual(redeemed.map(r=>r.status).sort(),[200,400]);
   assert.equal((await call('anon','GET','/api/session')).json.authenticated,false);
   const expired=await issue(ids.other);await s.database.run('UPDATE account_tokens SET expires_at=now()-interval \'1 second\' WHERE user_id=?',ids.other);
   assert.equal((await call('anon','POST','/api/account/activate',{token:expired,password})).status,400);
   for(const key of ['admin','lead','other'])await activate(key);
   for(const [key,phone] of [['admin','13900009102'],['lead','13900009103'],['member','13900009104'],['other','13900009105']])ok(await login(key,phone));
   assert.equal((await call('bad','POST','/api/login',{phone:'13900009104',name:'虚构成员',lastFour:'1234'})).status,401);
   const stored=await s.database.one('SELECT password_hash FROM users WHERE id=?',ids.member);assert.notEqual(stored.password_hash,password);assert.match(stored.password_hash,/^[a-f0-9]+:[a-f0-9]+$/);
   assert.ok((await users()).every(u=>!('password_hash' in u)&&!('credential' in u)));
  }],
  ['管理能力和业务数据范围独立，角色不能自行提升',async()=>{
   root=ok(await call('owner','POST','/api/goals',{scope:'company',kind:'measure',title:'虚构正式公司目标',unit:'件',target:100,startDate:'2026-11-01',endDate:'2026-11-30'})).result.id;
   child=ok(await call('owner','POST','/api/goals/'+root+'/split',{items:[{ownerId:ids.member,title:'虚构成员目标',target:60}]})).result.ids[0];
   assert.equal((await boot('admin')).goals.length,0);assert.equal((await boot('lead')).access.role,'lead');
   assert.equal((await call('admin','GET','/api/goals/'+root)).status,404);
   assert.equal((await call('member','GET','/api/admin/users')).status,403);
   assert.equal((await call('admin','PUT','/api/users/1',{version:(await users()).find(u=>u.id===1).version,title:'越权'})).status,403);
   assert.equal((await call('admin','POST','/api/admin/users/1/activation',{})).status,403);
   assert.equal((await call('admin','POST','/api/users',{name:'越权负责人',phone:'13900009109',role:'owner'})).status,403);
   assert.equal((await call('admin','PUT','/api/settings',{openness:'open'})).status,403);
   assert.equal((await call('admin','POST','/api/admin/backups',{})).status,403);
   assert.equal((await call('admin','GET','/api/admin/backups')).status,403);
   assert.equal((await call('admin','POST','/api/goals',{scope:'company',kind:'action',title:'越权目标',startDate:'2026-11-01',endDate:'2026-11-30'})).status,403);
   assert.equal((await call('admin','POST','/api/users',{name:'虚构自行扩权成员',phone:'13900009107',managerId:ids.admin})).status,403);
   const department=(await boot('owner')).departments.find(d=>d.id===dept);assert.equal((await call('admin','PUT','/api/departments/'+dept,{version:department.version,name:department.name,managerId:ids.admin})).status,403);
   assert.equal((await boot('admin')).access.teamIds.length,0);
   ok(await call('admin','POST','/api/users',{name:'虚构管理员开通成员',phone:'13900009106'}));
  }],
  ['成员与部门版本冲突、最后负责人保护及部门恢复',async()=>{
   const member=(await users()).find(u=>u.id===ids.member);
   ok(await call('admin','PUT','/api/users/'+ids.member,{version:member.version,title:'虚构职位'}));
   assert.equal((await call('admin','PUT','/api/users/'+ids.member,{version:member.version,title:'旧版本覆盖'})).status,409);
   assert.equal((await call('admin','PUT','/api/users/'+ids.member,{title:'缺少版本'})).status,409);
   assert.equal((await call('owner','PUT','/api/users/1',{version:(await users()).find(u=>u.id===1).version,role:'member'})).status,400);
   const spare=ok(await call('owner','POST','/api/departments',{name:'虚构可恢复部门'})).result.id;
   let row=(await boot('owner')).departments.find(d=>d.id===spare);
   ok(await call('owner','PUT','/api/departments/'+spare,{version:row.version,name:'虚构已改名部门'}));
   assert.equal((await call('owner','DELETE','/api/departments/'+spare,{version:row.version})).status,409);
   row=(await boot('owner')).departments.find(d=>d.id===spare);
   ok(await call('admin','DELETE','/api/departments/'+spare,{version:row.version}));
   const inactive=ok(await call('admin','GET','/api/admin/departments/inactive')).items.find(d=>d.id===spare);
   ok(await call('admin','POST','/api/departments/'+spare+'/restore',{version:inactive.version}));
   assert.ok((await boot('owner')).departments.some(d=>d.id===spare));
  }],
  ['真实账号的进展、汇总、撤回恢复及权限边界',async()=>{
   ok(await call('member','POST','/api/goals/'+child+'/checkins',{id:'formal-checkin',value:12,note:'虚构正式测试进展'}));
   assert.equal(ok(await call('owner','GET','/api/goals/'+root)).goal.stat.value,12);
   assert.equal(ok(await call('lead','GET','/api/goals/'+child)).goal.stat.value,12);
   assert.equal((await call('other','GET','/api/goals/'+child)).status,404);
   ok(await call('member','POST','/api/checkins/formal-checkin/void',{}));assert.equal(ok(await call('owner','GET','/api/goals/'+root)).goal.stat.value,0);
   ok(await call('member','POST','/api/checkins/formal-checkin/void',{restore:true}));
   assert.equal((await s.database.one("SELECT COUNT(*) AS n FROM checkins WHERE id='formal-checkin'")).n,1);
  }],
  ['重置密码使登录及实时连接立即失效，原密码不能再用',async()=>{
   const abort=new AbortController();const response=await fetch(s.origin+'/formal/api/stream',{headers:{Cookie:s.jar.member.cookie},signal:abort.signal});
   const reader=response.body.getReader();await reader.read();
   const token=await issue(ids.member);
   const ended=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('实时连接未断开')),2000))]);assert.equal(ended.done,true);abort.abort();
   assert.equal((await call('member','GET','/api/bootstrap')).status,401);
   ok(await call('anon','POST','/api/account/activate',{token,password:password+'新'}));
   assert.equal((await login('bad','13900009104')).status,401);ok(await login('member','13900009104',password+'新'));
   assert.equal((await call('member','POST','/api/account/password',{currentPassword:'错误密码',password:password+'改'})).status,403);
   ok(await call('member','POST','/api/account/password',{currentPassword:password+'新',password:password+'改'}));
   assert.equal((await call('member','GET','/api/bootstrap')).status,401);ok(await login('member','13900009104',password+'改'));
  }],
  ['停用保留历史、交接、恢复，权限变更撤销登录',async()=>{
   const member=(await users()).find(u=>u.id===ids.member);
   ok(await call('admin','DELETE','/api/users/'+ids.member,{version:member.version}));
   assert.equal((await call('member','GET','/api/bootstrap')).status,401);
   assert.equal((await s.database.one("SELECT COUNT(*) AS n FROM checkins WHERE id='formal-checkin'")).n,1);
   ok(await call('owner','POST','/api/admin/users/'+ids.member+'/handover',{toId:ids.lead}));
   assert.equal(ok(await call('owner','GET','/api/goals/'+child)).goal.ownerId,ids.lead);
   const inactive=(await users()).find(u=>u.id===ids.member);ok(await call('admin','PUT','/api/users/'+ids.member,{version:inactive.version,active:true}));
   ok(await login('member','13900009104',password+'改'));
   const admin=(await users()).find(u=>u.id===ids.admin);ok(await call('owner','PUT','/api/users/'+ids.admin,{version:admin.version,role:'member'}));
   assert.equal((await call('admin','GET','/api/admin/users')).status,401);
   ok(await login('admin','13900009102'));assert.equal((await call('admin','GET','/api/admin/users')).status,403);
  }],
  ['通讯录预览不改业务、绑定操作者和组织版本',async()=>{
   const admin=(await users()).find(u=>u.id===ids.admin);ok(await call('owner','PUT','/api/users/'+ids.admin,{version:admin.version,role:'system_admin'}));ok(await login('admin','13900009102'));
   const {workbook}=require('./fixtures/directory.cjs');
   const data=workbook(path.join(s.dir,'contacts.xlsx'),[
    ['FORMAL1','虚构导入上级','13900009110','虚构正式测试公司/新业务部','','正常','组长'],
    ['FORMAL2','虚构导入成员','13900009111','虚构正式测试公司/新业务部/协作组','13900009110','正常','成员']
   ]);ids.importData=data;
   const before=(await users()).length;
   let preview=ok(await call('admin','POST','/api/admin/directory/preview',data)).result;
   assert.equal(preview.summary.newUsers,2);assert.equal((await users()).length,before);
   assert.equal((await call('owner','POST','/api/admin/directory/'+preview.id+'/apply',{})).status,409);
   ok(await call('owner','POST','/api/departments',{name:'虚构预览后变更'}));
   assert.equal((await call('admin','POST','/api/admin/directory/'+preview.id+'/apply',{})).status,409);
   preview=ok(await call('admin','POST','/api/admin/directory/preview',data)).result;ids.importJob=preview.id;
   await s.database.run("UPDATE directory_imports SET expires_at=now()-interval '1 second' WHERE id=?",preview.id);
   assert.equal((await call('admin','POST','/api/admin/directory/'+preview.id+'/apply',{})).status,409);
   ids.importJob=ok(await call('admin','POST','/api/admin/directory/preview',data)).result.id;
  }],
  ['导入失败整体回滚，确认重试后不改变目标流水',async()=>{
   const beforeUsers=(await users()).length;
   const fingerprint=async()=>JSON.stringify({goals:await s.database.many('SELECT * FROM goals ORDER BY id'),checkins:await s.database.many('SELECT * FROM checkins ORDER BY id')});
   const before=await fingerprint();
   await s.database.query("CREATE FUNCTION reject_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phone='13900009111' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$");
   await s.database.query('CREATE TRIGGER reject_import BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION reject_import()');
   assert.equal((await call('admin','POST','/api/admin/directory/'+ids.importJob+'/apply',{})).status,500);
   await s.database.query('DROP TRIGGER reject_import ON users');await s.database.query('DROP FUNCTION reject_import()');
   assert.equal((await users()).length,beforeUsers);assert.equal(await fingerprint(),before);
   ok(await call('admin','POST','/api/admin/directory/'+ids.importJob+'/apply',{}));
   assert.equal((await users()).length,beforeUsers+2);assert.equal(await fingerprint(),before);
   const imported=(await users()).find(u=>u.phone==='13900009111');assert.equal(imported.loginConfigured,false);
   const parent=(await users()).find(u=>u.phone==='13900009110');assert.equal(imported.managerId,parent.id);
   const preview=ok(await call('admin','POST','/api/admin/directory/preview',ids.importData)).result;
   assert.equal(preview.summary.newUsers,0);ok(await call('admin','POST','/api/admin/directory/'+preview.id+'/apply',{}));assert.equal((await users()).length,beforeUsers+2);
   const token=await issue(imported.id);ok(await call('anon','POST','/api/account/activate',{token,password}));ok(await login('imported','13900009111'));
  }],
  ['备份工具失败会记录状态，业务数据不受影响',async()=>{
   const dir=path.join(s.dir,'formal/backups'),saved=dir+'-saved';fs.renameSync(dir,saved);fs.writeFileSync(dir,'模拟不可用备份目录');
   try {const result=ok(await call('owner','POST','/api/admin/backups',{})).result;assert.equal(result.status,'failed');assert.match(result.error,/备份失败/);assert.equal(ok(await call('owner','GET','/api/admin/backups')).items[0].status,'failed');}
   finally {fs.rmSync(dir);fs.renameSync(saved,dir);}
   assert.equal(ok(await call('owner','GET','/api/goals/'+root)).goal.stat.value,12);
  }],
  ['完整备份可下载、日志按权限过滤且不包含秘密',async()=>{
   const result=ok(await call('owner','POST','/api/admin/backups',{})).result;assert.equal(result.status,'ready');
   const backup=await call('owner','GET','/api/admin/backups/'+result.id+'/download');assert.equal(backup.status,200);assert.equal(backup.text.slice(0,5),'PGDMP');
   assert.equal((await call('member','GET','/api/admin/backups/'+result.id+'/download')).status,403);
   const admin=(await users()).find(u=>u.id===ids.admin);ok(await call('owner','PUT','/api/users/'+ids.admin,{version:admin.version,role:'system_admin'}));ok(await login('admin','13900009102'));
   const logs=ok(await call('admin','GET','/api/admin/audit')).items;assert.ok(logs.length);assert.ok(logs.every(e=>/^(account|user|department|directory)\./.test(e.action)));
   assert.doesNotMatch(JSON.stringify(logs),/password_hash|setupToken|token=|虚构正式账号密码/);
   assert.equal(ok(await call('admin','GET','/api/admin/status')).database,'正常');
  }]
 ]);
 const errors=s.serverErrors().split('\n').filter(line=>!line.includes('P0001'));if(errors.join('').trim())throw Error(errors.join('\n'));
 }finally{await s.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});

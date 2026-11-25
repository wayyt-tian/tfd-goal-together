'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('@playwright/test');
const {startServer,ok,run}=require('../test-helpers.cjs');
const {workbook}=require('../fixtures/directory.cjs');
(async()=>{
 const s=await startServer({legacyFixtures:false,env:{GUOQI_DUAL:'1',GUOQI_TODAY:'2026-11-25'}});
 const browser=await chromium.launch();const contexts=[];const errors=[];
 const evidence=path.resolve(__dirname,'../../docs/validation/formal-20261125');fs.mkdirSync(evidence,{recursive:true});
 async function pageFor(){const context=await browser.newContext({viewport:{width:1366,height:900},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});contexts.push(context);const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));return p;}
 const page=await pageFor();let member,admin,root,child,memberId;
 const dialog=()=>page.locator('dialog[open]').last();
 async function api(p,method,url,body){const session=await (await p.request.get(s.origin+'/formal/api/session')).json();const response=await p.request.fetch(s.origin+'/formal'+url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},data:body});const data=await response.json();assert.equal(response.status(),200,data.error);return data;}
 async function createUser(name,phone,role='member'){
  await page.goto(s.origin+'/formal/#/admin/members');await page.locator('[data-act=add-user]').click();await dialog().locator('[name=name]').fill(name);await dialog().locator('[name=phone]').fill(phone);await dialog().locator('[name=role]').selectOption(role);await dialog().locator('[data-submit]').click();
  const link=await page.locator('.activation-link').inputValue();await dialog().locator('[data-close]').last().click();
  const p=await pageFor();await p.goto(link);await p.locator('[name=password]').fill('虚构浏览器正式密码1234');await p.locator('[name=confirmPassword]').fill('虚构浏览器正式密码1234');await p.locator('[type=submit]').click();await p.waitForURL(/\/formal\/$/);await p.locator('[name=phone]').fill(phone);await p.locator('[name=password]').fill('虚构浏览器正式密码1234');await p.locator('[type=submit]').click();await p.waitForSelector('.page');return p;
 }
 try {await run('正式模式浏览器完整流程',[
  ['首次配置及正式/演示入口',async()=>{
   await page.goto(s.origin);await page.waitForURL('**/formal/');await page.waitForSelector('.mode-links');assert.equal(await page.locator('.mode-links a').count(),2);
   await page.screenshot({path:path.join(evidence,'formal-setup.png'),fullPage:true});
   await page.locator('[name=name]').fill('虚构浏览器正式负责人');await page.locator('[name=phone]').fill('13900009301');await page.locator('[name=password]').fill('虚构浏览器正式密码1234');await page.locator('[name=confirmPassword]').fill('虚构浏览器正式密码1234');await page.locator('[name=setupToken]').fill(JSON.parse(fs.readFileSync(path.join(s.dir,'formal/setup-token.json'))).token);
   await page.locator('[type=submit]').click();await page.waitForSelector('.page');assert.equal(await page.locator('.demo-ribbon').count(),0);assert.equal(await page.locator('.nav a').count(),4);
  }],
  ['组织和普通账号从页面创建，成员通过链接设置密码',async()=>{
   await page.goto(s.origin+'/formal/#/admin/org');await page.locator('[data-act=add-dept]').click();await dialog().locator('[name=name]').fill('虚构页面业务部');await dialog().locator('[data-submit]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));await page.getByText('虚构页面业务部',{exact:true}).waitFor();
   member=await createUser('虚构页面成员','13900009302');
   memberId=(await api(page,'GET','/api/admin/users')).users.find(u=>u.phone==='13900009302').id;
   await member.locator('.me-menu summary').click();assert.equal(await member.locator('a[href="#/admin"]').count(),0);await member.locator('a[href="#/account"]').click();await member.waitForSelector('.account-password');assert.match(await member.locator('.account-page').innerText(),/虚构页面成员/);
  }],
  ['系统管理员有管理入口，不能查看全公司业务及备份',async()=>{
   admin=await createUser('虚构页面系统管理员','13900009303','system_admin');await admin.locator('.me-menu summary').click();await admin.locator('a[href="#/admin"]').click();await admin.waitForSelector('.admin-list');
   assert.equal(await admin.locator('a[href="#/admin/rules"]').count(),0);
   await admin.goto(s.origin+'/formal/#/admin/data');await admin.getByRole('heading',{name:'运行状态'}).waitFor();assert.equal(await admin.getByRole('button',{name:'创建备份',exact:true}).count(),0);
   await admin.screenshot({path:path.join(evidence,'system-admin-data.png'),fullPage:true});
  }],
  ['正式账号目标创建、成员进展和负责人实时汇总',async()=>{
   await page.goto(s.origin+'/formal/#/map');await page.locator('.new-btn').click();await dialog().locator('[name=title]').fill('虚构正式页面公司目标');await dialog().locator('[data-where=company]').click();await dialog().locator('[name=target]').fill('100');await dialog().locator('[name=unit]').fill('件');await dialog().locator('[data-submit]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
   root=(await api(page,'GET','/api/bootstrap')).data.goals.find(g=>g.title==='虚构正式页面公司目标').id;
   child=(await api(page,'POST','/api/goals/'+root+'/split',{items:[{ownerId:memberId,target:50,title:'虚构正式页面成员目标'}]})).result.ids[0];
   await page.goto(s.origin+'/formal/#/g/'+root);await page.waitForSelector('.goal-head');
   await member.goto(s.origin+'/formal/#/g/'+child);await member.waitForSelector('.goal-head');await member.locator('[data-act=checkin]').first().click();const md=member.locator('dialog[open]').last();await md.locator('[name=value]').fill('8');await md.locator('[name=note]').fill('虚构正式页面进展');await md.locator('[data-submit]').click();await member.waitForFunction(()=>!document.querySelector('dialog[open]'));
   await page.waitForFunction(()=>document.querySelector('.big-num b')?.textContent.includes('8'));
   assert.equal((await api(admin,'GET','/api/bootstrap')).data.goals.length,0);
  }],
  ['通讯录页面预览、确认导入和开通提示',async()=>{
   const file=path.join(s.dir,'browser-contacts.xlsx');workbook(file,[['BROWSER1','虚构页面导入成员','13900009304','虚构页面公司/导入业务部','','正常','协作者']]);
   await page.goto(s.origin+'/formal/#/admin/members');await page.locator('summary').filter({hasText:'导入成员通讯录'}).click();await page.locator('input[type=file]').setInputFiles(file);await page.getByRole('heading',{name:'导入预览',exact:true}).waitFor();
   await page.getByRole('button',{name:'确认导入',exact:true}).click();await dialog().locator('[data-ok]').click();await page.getByRole('heading',{name:'导入完成',exact:true}).waitFor();
   assert.ok((await api(page,'GET','/api/admin/users')).users.some(u=>u.name==='虚构页面导入成员'&&!u.loginConfigured));
  }],
  ['备份和操作日志可见，账户修改密码后需重新登录',async()=>{
   await page.goto(s.origin+'/formal/#/admin/data');await page.getByRole('button',{name:'创建备份',exact:true}).click();await page.getByRole('link',{name:'下载备份',exact:true}).first().waitFor();assert.ok(await page.locator('.admin-table tbody tr').count());
   await page.screenshot({path:path.join(evidence,'owner-data.png'),fullPage:true});
   await member.goto(s.origin+'/formal/#/account');await member.waitForSelector('.account-password');await member.locator('[name=currentPassword]').fill('虚构浏览器正式密码1234');await member.locator('[name=password]').fill('虚构浏览器修改密码1234');await member.locator('[name=confirmPassword]').fill('虚构浏览器修改密码1234');await member.locator('button[type=submit]').click();await member.waitForSelector('.auth-card');await member.locator('[name=phone]').fill('13900009302');await member.locator('[name=password]').fill('虚构浏览器修改密码1234');await member.locator('[type=submit]').click();await member.waitForSelector('.page');
  }],
  ['模式切换保留各自登录态，演示数据不会带入正式',async()=>{
   await page.locator('.me-menu summary').click();await page.locator('[data-act=switch-mode]').click();await page.waitForURL('**/demo/');await page.locator('[data-user]').first().click();await page.waitForSelector('.demo-ribbon');
   await page.locator('.me-menu summary').click();await page.locator('[data-act=switch-mode]').click();await page.waitForURL('**/formal/');await page.waitForSelector('.page');assert.equal(await page.locator('.demo-ribbon').count(),0);const goals=(await api(page,'GET','/api/bootstrap')).data.goals;assert.equal(goals.filter(g=>!g.parentId).length,1);
  }],
  ['新增管理内容在手机宽度可操作，无脚本错误或横向溢出',async()=>{
   await page.setViewportSize({width:390,height:844});await page.goto(s.origin+'/formal/#/admin/data');await page.getByRole('heading',{name:'运行状态'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(evidence,'owner-data-mobile.png'),fullPage:true});
   await page.goto(s.origin+'/formal/#/account');await page.waitForSelector('.account-password');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(evidence,'account-mobile.png'),fullPage:true});
   assert.deepEqual(errors,[]);
  }]
 ]);}finally{for(const c of contexts)await c.close();await browser.close();await s.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});

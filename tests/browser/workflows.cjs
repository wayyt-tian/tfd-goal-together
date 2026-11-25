'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const {startServer,ok,run}=require('../test-helpers.cjs');
(async()=>{
 const server=await startServer({env:{GUOQI_DEMO:'1',GUOQI_TODAY:'2026-11-25'}});
 const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1366,height:900},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const dialog=()=>page.locator('dialog[open]').last();
 const close=async()=>{await page.keyboard.press('Escape');await page.waitForTimeout(220);};
 let id;
 try{await run('React 浏览器交互',[
  ['演示登录、四项导航和设置页面',async()=>{
   await page.goto(server.origin);await page.locator('[data-user]').first().click();await page.waitForSelector('.page');
   assert.equal(await page.locator('.nav a').count(),4);
   await page.goto(server.origin+'/#/admin/rules');await page.waitForSelector('[data-rules]');
   assert.equal(await page.locator('[name=healthLine]').inputValue(),'5');
  }],
  ['新建目标：切换类型、时间和嵌套选人时保留输入',async()=>{
   await page.locator('.new-btn').click();await dialog().locator('[name=title]').fill('虚构 React 目标 <&>');
   await dialog().locator('[data-where=personal]').click();
   await dialog().locator('[name=target]').fill('100');await dialog().locator('[name=unit]').fill('个');
   await dialog().locator('[data-kind=action]').click();await dialog().locator('[data-kind=measure]').click();
   assert.equal(await dialog().locator('[name=title]').inputValue(),'虚构 React 目标 <&>');
   await dialog().locator('[name=target]').fill('100');
   await dialog().locator('[data-pick-owner]').click();assert.equal(await page.locator('dialog[open]').count(),2);
   await dialog().locator('[data-q]').fill('林远舟');await dialog().locator('[data-person]').first().click();await page.waitForTimeout(220);
   assert.equal(await dialog().locator('[name=title]').inputValue(),'虚构 React 目标 <&>');
   await dialog().locator('details.more summary').click();await dialog().locator('[data-range=week]').click();
   assert.equal(await dialog().locator('[name=startDate]').inputValue(),'2026-11-23');
   await dialog().locator('[name=note]').fill('虚构说明，保留 & 符号');
   await dialog().locator('[data-submit]').click();await page.waitForURL(/#\/g\//);await page.waitForSelector('.goal-head');await page.waitForTimeout(220);
   id=decodeURIComponent(new URL(page.url()).hash.split('/')[2]);
   assert.match(await page.locator('h1').innerText(),/虚构 React 目标 <&>/);
  }],
  ['记进展、留言、撤回和恢复',async()=>{
   await page.locator('.action-bar [data-act=checkin], .goal-head [data-act=checkin]').first().click();
   await dialog().locator('[name=value]').fill('5.25');await dialog().locator('[name=note]').fill('虚构浏览器进展');await dialog().locator('[data-submit]').click();
   await page.waitForFunction(()=>!document.querySelector('dialog[open]'));await page.waitForTimeout(250);
   assert.match(await page.locator('.goal-head').innerText(),/5.25/);
   await page.goto(server.origin+'/#/g/'+id+'/feed');await page.waitForSelector('.comment-box');
   await page.locator('[name=comment]').fill('虚构留言 <&>');await page.locator('[data-act=send-comment]').click();
   await page.waitForFunction(()=>document.querySelector('.timeline')?.textContent.includes('虚构留言 <&>'));
   await page.goto(server.origin+'/#/me/records');await page.waitForSelector('.record');
   const record=page.locator('.record').filter({hasText:'虚构浏览器进展'});
   await record.locator('[data-act=void-checkin]').click();await dialog().locator('[data-ok]').click();await page.waitForTimeout(500);
   assert.match(await record.innerText(),/已撤回/);
   await record.locator('[data-restore="1"]').click();await page.waitForTimeout(500);
   assert.doesNotMatch(await record.innerText(),/已撤回/);
  }],
  ['编辑、邀请协作者、归档与恢复',async()=>{
   await page.goto(server.origin+'/#/g/'+id+'/path');await page.waitForSelector('.goal-head');
   await page.locator('details.menu').filter({has:page.locator('[data-act=edit]')}).locator('summary').click();
   await page.locator('[data-act=edit]:visible').click();
   await dialog().locator('[name=title]').fill('虚构修改后的目标');await dialog().locator('[name=target]').fill('120');
   await dialog().locator('[data-add-members]').click();await dialog().locator('[data-q]').fill('周以宁');
   await dialog().locator('[data-person]').first().click();await dialog().locator('[data-done]').click();await page.waitForTimeout(220);
   assert.equal(await dialog().locator('[name=target]').inputValue(),'120');
   await dialog().locator('[data-submit]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
   assert.match(await page.locator('h1').innerText(),/虚构修改后的目标/);
   await page.locator('details.menu').filter({has:page.locator('[data-act=edit]')}).locator('summary').click();await page.locator('[data-act=edit]:visible').click();
   await dialog().locator('[data-archive]').click();await dialog().locator('[data-ok]').click();await page.waitForTimeout(600);
   await page.goto(server.origin+'/#/admin/archived');await page.waitForSelector('[data-act=restore-goal]');
   await page.locator('[data-act=restore-goal]').filter({hasText:'恢复'}).first().click();await page.waitForTimeout(400);
   assert.equal(await page.locator('[data-act=restore-goal]').count(),0);
  }],
  ['实时更新不会覆盖正在输入的留言或打断焦点',async()=>{
   await page.goto(server.origin+'/#/g/'+id+'/feed');await page.waitForSelector('.comment-box');
   const draft=page.locator('[name=comment]');await draft.fill('尚未发送的中文草稿');await draft.focus();
   ok(await server.call('owner','POST','/api/demo/login',{userId:1}));
   ok(await server.call('owner','POST','/api/goals/'+id+'/checkins',{value:1,note:'虚构另一页面更新'}));
   await page.waitForFunction(()=>document.querySelector('.timeline')?.textContent.includes('虚构另一页面更新'));
   assert.equal(await draft.inputValue(),'尚未发送的中文草稿');assert.equal(await draft.evaluate(el=>document.activeElement===el),true);
  }],
  ['搜索、筛选、详情展开和手机导航',async()=>{
   await page.goto(server.origin+'/#/team');await page.waitForSelector('.team-page, .page');
   const search=page.locator('input[type=search]').first();await search.fill('虚构不存在的人');await page.waitForTimeout(250);assert.equal(await search.inputValue(),'虚构不存在的人');
   await page.setViewportSize({width:390,height:844});await page.goto(server.origin+'/#/map');await page.waitForSelector('.map-page, .page');
   assert.equal(await page.locator('.tabbar a').count(),4);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.locator('.fab').click();await close();
   assert.deepEqual(errors,[]);
  }]
 ]);}finally{await browser.close();await server.stop();}
 const loginServer=await startServer();
 const loginBrowser=await chromium.launch();const loginPage=await loginBrowser.newPage();
 try { await run('首次设置与日常登录', [
  ['首次设置公司负责人后可以退出并重新登录',async()=>{
   await loginPage.goto(loginServer.origin);await loginPage.locator('[name=name]').fill('虚构浏览器负责人');
   await loginPage.locator('[name=phone]').fill('13900009999');await loginPage.locator('[name=password]').fill('虚构浏览器密码123X');await loginPage.locator('[name=confirmPassword]').fill('虚构浏览器密码123X');await loginPage.locator('[name=setupToken]').fill(JSON.parse(require('node:fs').readFileSync(require('node:path').join(loginServer.dir,'setup-token.json'))).token);
   await loginPage.locator('[type=submit]').click();await loginPage.waitForSelector('.page');
   await loginPage.locator('.me-menu summary').click();await loginPage.locator('[data-act=logout]').click();await loginPage.waitForSelector('.auth-card');
   await loginPage.locator('[name=phone]').fill('13900009999');await loginPage.locator('[name=password]').fill('错误的虚构密码0000');
   await loginPage.locator('[type=submit]').click();await loginPage.waitForSelector('.form-error:visible');
   assert.doesNotMatch(await loginPage.locator('.form-error').innerText(),/object Object/);
   await loginPage.locator('[name=password]').fill('虚构浏览器密码123X');await loginPage.locator('[type=submit]').click();await loginPage.waitForSelector('.page');
  }]
 ]); } finally {await loginBrowser.close();await loginServer.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});

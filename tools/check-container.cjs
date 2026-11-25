'use strict';
// 验证已构建镜像；只使用独立测试库和临时容器，连接密码不进入参数或日志。
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const assert=require('node:assert/strict');
const {temporarySchema}=require('../src/db/index.cjs');
const exec=promisify(execFile);
(async()=>{
 const isolation=await temporarySchema('test');let container;
 const name='goal-together-check-'+Date.now();
 try{
  const env={...process.env,DATABASE_URL:isolation.url,DATABASE_SCHEMA:isolation.schema};
  container=(await exec('docker',['run','-d','--rm','--network','host','--name',name,'-e','DATABASE_URL','-e','DATABASE_SCHEMA','-e','DEMO_DATABASE_URL','-e','GUOQI_DUAL=1','-e','HOST=127.0.0.1','-e','PORT=0','-e','GUOQI_DEMO=1','goal-together-app:local'],{env})).stdout.trim();
  let origin;
  for(let attempt=0;attempt<100;attempt++){
   const {stdout}=await exec('docker',['logs',container]);
   const match=stdout.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){origin=match[0];break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(origin,'容器未启动');
  const page=await fetch(origin);assert.equal(page.status,200);const html=await page.text();
  const asset=html.match(/src="(\/static\/[^\"]+\.js)"/)[1];
  const js=await fetch(origin+asset,{headers:{'Accept-Encoding':'br'}});assert.equal(js.headers.get('content-encoding'),'br');assert.match(js.headers.get('cache-control'),/immutable/);
  assert.equal((await fetch(origin+asset,{headers:{'If-None-Match':js.headers.get('etag')}})).status,304);
  assert.equal((await fetch(origin+'/js/main.jsx')).status,404);
  assert.equal((await fetch(origin+'/assets/brand/guoqi-logo.webp')).status,200);
  const login=await fetch(origin+'/demo/api/demo/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:1})});assert.equal(login.status,200);
  const session=await login.json();const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json','X-CSRF-Token':session.csrf};
  const created=await (await fetch(origin+'/demo/api/admin/backups',{method:'POST',headers,body:'{}'})).json();assert.equal(created.result.status,'ready');
  const backup=await fetch(origin+'/demo/api/admin/backups/'+created.result.id+'/download',{headers});assert.equal(backup.status,200);assert.equal(Buffer.from(await backup.arrayBuffer()).subarray(0,5).toString(),'PGDMP');
  const formal=await (await fetch(origin+'/formal/api/session')).json();assert.equal(formal.mode,'formal');assert.equal(formal.configured,false);
  assert.equal((await fetch(origin+'/formal/api/bootstrap',{headers})).status,401);
  const version=await exec('docker',['exec',container,'pg_dump','--version']);assert.match(version.stdout,/16\./);
  console.log('PASS 双模式容器启动、会话隔离、品牌图、源码边界、压缩缓存与 PostgreSQL 16 备份检查；仅使用专用测试/演示空间。');
 }finally{if(container)await exec('docker',['stop','-t','5',container]).catch(()=>{});await isolation.cleanup();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});

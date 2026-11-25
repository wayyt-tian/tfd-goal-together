'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const exec=require('node:util').promisify(require('node:child_process').execFile);
const {Pool}=require('pg');
const {temporarySchema,createDatabase,identifier}=require('../src/db/index.cjs');
const {startServer,ok,run,APP}=require('./test-helpers.cjs');
(async()=>{
 const isolated=await temporarySchema('test'),db=createDatabase(isolated);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'goal-operations-'));
 const targetName='goal_restore_'+crypto.randomBytes(6).toString('hex')+'_test';
 const targetURL=new URL(isolated.url);targetURL.pathname='/'+targetName;
 const env={...process.env,DATABASE_URL:isolated.url,DATABASE_SCHEMA:isolated.schema,GUOQI_DATA_DIR:directory};
 let server,targetCreated=false,backup;
 try {await run('升级、恢复与重启',[
  ['旧 PostgreSQL 升级先备份，原始凭据和业务数据保留',async()=>{
   await db.query(fs.readFileSync(path.join(APP,'src/db/migrations/001-initial.sql'),'utf8'));
   await db.query('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
   await db.run("INSERT INTO schema_migrations(version) VALUES ('001-initial.sql')");
   await db.run("INSERT INTO users(name,phone,credential,role) VALUES ('虚构升级负责人','13900009201','原始旧验证哈希','owner')");
   for(const [key,value] of [['revision','1'],['configured','1']])await db.run('INSERT INTO metadata(key,value) VALUES (?,?)',key,value);
   await db.run("INSERT INTO goals(id,scope,kind,title,start_date,end_date,owner_id,created_by,created_at,updated_at) VALUES ('legacy-goal','company','action','虚构旧目标','2026-11-01','2026-11-30',1,1,now(),now())");
   await db.run("INSERT INTO sessions VALUES ('旧会话',1,'旧校验',9999999999999)");
   server=await startServer({legacyFixtures:false,dataDir:directory,env:{DATABASE_URL:isolated.url,DATABASE_SCHEMA:isolated.schema}});
   const report=JSON.parse(fs.readFileSync(path.join(directory,'migration-report.json')));backup=path.join(directory,'backups',report.backup);
   assert.equal(fs.readFileSync(backup).subarray(0,5).toString(),'PGDMP');
   assert.equal((await db.one('SELECT credential FROM users')).credential,'原始旧验证哈希');assert.equal((await db.one('SELECT COUNT(*) AS n FROM goals')).n,1);
   assert.equal((await db.one('SELECT COUNT(*) AS n FROM sessions')).n,0);
   assert.equal((await server.rawCall('old','POST','/api/login',{phone:'13900009201',name:'虚构升级负责人',lastFour:'1234'})).status,401);
  }],
  ['本机负责人恢复命令默认只检查，执行后链接可设置密码',async()=>{
   const script=path.join(APP,'scripts/recover-account.cjs');
   const preview=await exec(process.execPath,[script,'--phone=13900009201'],{env});assert.match(preview.stdout,/追加 --apply/);assert.equal((await db.one('SELECT COUNT(*) AS n FROM account_tokens')).n,0);
   const applied=await exec(process.execPath,[script,'--phone=13900009201','--apply','--origin='+server.origin],{env});const token=applied.stdout.match(/token=([a-f0-9]{64})/)[1];
   ok(await server.rawCall('anon','POST','/api/account/activate',{token,password:'虚构升级新密码1234'}));
   ok(await server.rawCall('owner','POST','/api/login',{phone:'13900009201',password:'虚构升级新密码1234'}));
  }],
  ['恢复工具拒绝源库及非空库，独立空库恢复成功',async()=>{
   const script=path.join(APP,'scripts/restore-backup.cjs');
   await assert.rejects(exec(process.execPath,[script,'--file='+backup,'--apply'],{env:{...env,RESTORE_DATABASE_URL:isolated.url}}),e=>/不能是正式/.test(e.stderr));
   await db.query('CREATE DATABASE '+identifier(targetName));targetCreated=true;
   const target=new Pool({connectionString:targetURL.href});
   try{await target.query('CREATE TABLE public.guard(id int)');
    await assert.rejects(exec(process.execPath,[script,'--file='+backup,'--apply'],{env:{...env,RESTORE_DATABASE_URL:targetURL.href}}),e=>/并非空库/.test(e.stderr));
    await target.query('DROP TABLE public.guard');
    const restored=await exec(process.execPath,[script,'--file='+backup,'--apply'],{env:{...env,RESTORE_DATABASE_URL:targetURL.href}});const result=JSON.parse(restored.stdout);
    assert.equal(result.schema,isolated.schema);assert.equal(result.counts.goals,1);assert.equal(result.counts.users,1);
    assert.equal((await target.query('SELECT credential FROM '+identifier(isolated.schema)+'.users')).rows[0].credential,'原始旧验证哈希');
   }finally{await target.end();}
  }],
  ['默认 public 空间备份也能恢复到全新空库',async()=>{
   const sourceName='goal_source_'+crypto.randomBytes(6).toString('hex')+'_test';
   const sourceURL=new URL(isolated.url);sourceURL.pathname='/'+sourceName;
   let publicDB;
   await db.query('CREATE DATABASE '+identifier(sourceName));
   try {
    publicDB=createDatabase({url:sourceURL.href,schema:'public'});await publicDB.migrate();
    await publicDB.run("INSERT INTO users(name,phone,role) VALUES ('虚构 public 负责人','13900009202','owner')");
    const file=await require('../src/db/backup.cjs').backupDatabase(publicDB,'public-test',directory);
    await db.query('DROP DATABASE '+identifier(targetName)+' WITH (FORCE)');targetCreated=false;await db.query('CREATE DATABASE '+identifier(targetName));targetCreated=true;
    const restored=await exec(process.execPath,[path.join(APP,'scripts/restore-backup.cjs'),'--file='+file,'--apply'],{env:{...env,DATABASE_URL:sourceURL.href,RESTORE_DATABASE_URL:targetURL.href}});
    assert.equal(JSON.parse(restored.stdout).schema,'public');assert.equal(JSON.parse(restored.stdout).counts.users,1);
   }finally {if(publicDB)await publicDB.close();await db.query('DROP DATABASE '+identifier(sourceName)+' WITH (FORCE)');}
  }],
  ['正式服务重启后账号、目标和游标持久保留',async()=>{
   const before=ok(await server.rawCall('owner','GET','/api/bootstrap')).data;
   await server.stop();server=await startServer({legacyFixtures:false,dataDir:directory,env:{DATABASE_URL:isolated.url,DATABASE_SCHEMA:isolated.schema}});
   const after=ok(await server.rawCall('owner','POST','/api/login',{phone:'13900009201',password:'虚构升级新密码1234'})).data;
   assert.deepEqual(after.goals,before.goals);assert.equal(after.people.length,before.people.length);
   assert.equal(after.seq,before.seq);assert.equal(fs.existsSync(path.join(directory,'setup-token.json')),false);
  }]
 ]);}finally{if(server)await server.stop();if(targetCreated)await db.query('DROP DATABASE '+identifier(targetName)+' WITH (FORCE)');await db.close();await isolated.cleanup();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

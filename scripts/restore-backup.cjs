'use strict';
const fs=require('node:fs');
const {pipeline}=require('node:stream/promises');
const {createDatabase}=require('../src/db/index.cjs');
const {postgresTool}=require('../src/db/backup.cjs');
(async()=>{
 const file=process.argv.find(a=>a.startsWith('--file='))?.slice(7);
 if(!file || fs.readFileSync(file).subarray(0,5).toString()!=='PGDMP')throw new Error('请通过 --file=路径 指定 PostgreSQL 备份。');
 if(!process.argv.includes('--apply')){console.log('备份格式正确。恢复需指定 RESTORE_DATABASE_URL 为新建的空库，并追加 --apply；不会覆盖源库。');return;}
 const url=process.env.RESTORE_DATABASE_URL;if(!url)throw new Error('请设置独立的 RESTORE_DATABASE_URL。');
 const target=new URL(url);
 for(const value of [process.env.DATABASE_URL,process.env.DEMO_DATABASE_URL,process.env.TEST_DATABASE_URL].filter(Boolean)) {
  const source=new URL(value);
  if(source.hostname===target.hostname&&(source.port||'5432')===(target.port||'5432')&&source.pathname===target.pathname)throw new Error('恢复目标不能是正式、演示或当前测试源库。');
 }
 const db=createDatabase({url,schema:'public'});
 try {
  const count=await db.one("SELECT (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') + (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') + (SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND t.typtype IN ('e','d')) AS n");
  if(count.n)throw new Error('目标库并非空库，已拒绝覆盖。');
  const child=postgresTool(db,'pg_restore',['--dbname='+decodeURIComponent(target.pathname.slice(1)),'--clean','--if-exists','--no-owner','--no-acl','--exit-on-error','--single-transaction']);
  child.stderr.resume(); child.stdout.resume();
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('恢复失败，事务已撤回，请检查备份和目标库。')));});
  await Promise.all([pipeline(fs.createReadStream(file),child.stdin),done]);
  const spaces=await db.many("SELECT table_schema FROM information_schema.tables WHERE table_name='event_clock' AND table_schema NOT IN ('pg_catalog','information_schema')");
  if(spaces.length!==1)throw new Error('恢复完成，但应用空间数量不符合预期，请保留目标库排查。');
  const schema=spaces[0].table_schema;
  const {identifier}=require('../src/db/index.cjs');const prefix=identifier(schema)+'.';
  const counts={};for(const table of ['users','goals','checkins','events'])counts[table]=(await db.one('SELECT COUNT(*) AS n FROM '+prefix+table)).n;
  const clock=(await db.one('SELECT value FROM '+prefix+'event_clock')).value;
  const max=(await db.one('SELECT COALESCE(MAX(seq),0) AS n FROM '+prefix+'events')).n;
  const missing=(await db.one('SELECT COUNT(*) AS n FROM '+prefix+'goals g LEFT JOIN '+prefix+'users u ON u.id=g.owner_id WHERE u.id IS NULL')).n;
  if(clock<max||missing)throw new Error('恢复校验不通过，请保留目标库排查。');
  console.log(JSON.stringify({result:'恢复及检查通过，未切换线上连接',schema,counts,seq:clock},null,2));
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

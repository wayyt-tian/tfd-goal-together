'use strict';
// PostgreSQL 专属回归，只操作随机的测试隔离空间；不迁移 SQLite 数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createDatabase, temporarySchema, identifier } = require('../src/db/index.cjs');
const { backupDatabase, postgresTool } = require('../src/db/backup.cjs');
const { startServer, ok, run } = require('./test-helpers.cjs');
(async () => {
  const isolation = await temporarySchema('test');
  const db = createDatabase(isolation);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-database-'));
  let backup;
  const previous = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
  try {
    await run('PostgreSQL 初始化、事务与恢复', [
      ['重复初始化幂等，索引与数值类型正确', async () => {
        await db.migrate(); await db.migrate();
        assert.equal((await db.one('SELECT COUNT(*) AS n FROM schema_migrations')).n, 2);
        const column = await db.one("SELECT data_type FROM information_schema.columns WHERE table_schema=? AND table_name='goals' AND column_name='target'", db.schema);
        assert.equal(column.data_type, 'numeric');
        assert.ok((await db.many('SELECT indexname FROM pg_indexes WHERE schemaname=?', db.schema)).length > 15);
      }],
      ['失败事务连同事件和游标一起撤回', async () => {
        const before = (await db.one('SELECT value FROM event_clock')).value;
        await assert.rejects(db.scope(async () => {
          await db.writeMeta('rollback_probe', '不可见');
          await db.run("INSERT INTO events(created_at,type,payload) VALUES (now(),'org.changed','{}')");
          throw new Error('主动撤回');
        }, { write: true }), /主动撤回/);
        assert.equal(await db.one("SELECT value FROM metadata WHERE key='rollback_probe'"), undefined);
        assert.equal((await db.one('SELECT value FROM event_clock')).value, before);
        assert.equal((await db.one('SELECT COUNT(*) AS n FROM events')).n, 0);
      }],
      ['提交游标按事务次序推进，不越过尚未提交的事件', async () => {
        let release, inserted;
        const gate = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { inserted = resolve; });
        const first = db.scope(async () => {
          await db.run("INSERT INTO events(created_at,type,payload) VALUES (now(),'org.changed','{}')");
          inserted(); await gate;
        }, { write: true, lock: 'tree:first' });
        await ready;
        const second = db.scope(async () => { await db.run("INSERT INTO events(created_at,type,payload) VALUES (now(),'org.changed','{}')"); }, { write: true, lock: 'tree:second' });
        assert.equal((await db.one('SELECT value FROM event_clock')).value, 0);
        release(); await Promise.all([first, second]);
        assert.deepEqual((await db.many('SELECT seq FROM events ORDER BY seq')).map(r => r.seq), [1,2]);
      }],
      ['备份是 PostgreSQL 格式，可实际恢复数据和游标', async () => {
        await db.scope(async () => { await db.writeMeta('restore_probe', '虚构恢复数据'); }, { write:true });
        backup = await backupDatabase(db, 'test-restore');
        assert.equal(fs.readFileSync(backup).subarray(0,5).toString(), 'PGDMP');
        await db.query('DROP SCHEMA ' + identifier(db.schema) + ' CASCADE');
        const child = postgresTool(db, 'pg_restore', ['--dbname=' + decodeURIComponent(new URL(db.url).pathname.slice(1)), '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction']);
        let stderr=''; child.stderr.on('data', chunk => { stderr += chunk; });
        const done = new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('测试恢复失败：'+stderr)));});
        child.stdout.resume();
        await Promise.all([pipeline(fs.createReadStream(backup), child.stdin), done]);
        assert.equal((await db.one("SELECT value FROM metadata WHERE key='restore_probe'")).value, '虚构恢复数据');
        assert.equal((await db.one('SELECT value FROM event_clock')).value, 2);
      }],
      ['不同测试隔离空间互不可见', async () => {
        const other = await temporarySchema('test'); const second=createDatabase(other);
        try { await second.migrate(); assert.equal((await second.one('SELECT COUNT(*) AS n FROM events')).n,0); }
        finally { await second.close(); await other.cleanup(); }
      }]
    ]);
  } finally { await db.close(); await isolation.cleanup(); fs.rmSync(dir,{recursive:true,force:true}); if(previous===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=previous; }
  const durable = await temporarySchema('test');
  const serverEnv = {GUOQI_DEMO:'1',GUOQI_TODAY:'2026-11-25',DATABASE_URL:durable.url,DATABASE_SCHEMA:durable.schema};
  let s = await startServer({env:serverEnv});
  try {
    let goal;
    await run('PostgreSQL 并发正确性', [
      ['相同版本同时编辑，只有一次成功', async () => {
        const {data}=ok(await s.call('owner','POST','/api/demo/login',{userId:1}));
        goal=data.goals.find(g=>g.ownerId===1&&g.kind==='measure'&&!g.parentId);
        const responses=await Promise.all(['甲','乙'].map(label=>s.call('owner','PATCH','/api/goals/'+goal.id,{version:goal.version,title:'虚构并发目标'+label})));
        assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
      }],
      ['重复流水编号只记一次，同时新增的流水都保留', async () => {
        const before=ok(await s.call('owner','GET','/api/goals/'+goal.id)).goal.stat.value;
        const url='/api/goals/'+goal.id+'/checkins';
        const duplicate={id:'test-idempotent',value:0.25};
        for(const response of await Promise.all([s.call('owner','POST',url,duplicate),s.call('owner','POST',url,duplicate)]))ok(response);
        for(const response of await Promise.all([s.call('owner','POST',url,{value:0.5}),s.call('owner','POST',url,{value:0.75})]))ok(response);
        assert.equal(ok(await s.call('owner','GET','/api/goals/'+goal.id)).goal.stat.value,before+1.5);
        assert.equal((await s.database.one('SELECT COUNT(*) AS n FROM checkins WHERE id=?','test-idempotent')).n,1);
      }],
      ['重启服务不重复初始化，目标、进展和游标保持', async () => {
        const before=ok(await s.call('owner','GET','/api/bootstrap')).data;
        await s.stop(); s=await startServer({env:serverEnv});
        const after=ok(await s.call('owner','POST','/api/demo/login',{userId:1})).data;
        assert.equal(after.seq,before.seq);
        assert.deepEqual(after.goals,before.goals);
      }]
    ]);
  } finally { await s.stop(); await durable.cleanup(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

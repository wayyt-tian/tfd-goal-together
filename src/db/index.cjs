'use strict';
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// 对外保持原有数字、日期及 ISO 时间格式。JSON 在领域边界统一解码。
for (const oid of [20, 1700]) types.setTypeParser(oid, value => Number(value));
for (const oid of [1082, 114, 3802]) types.setTypeParser(oid, value => value);
types.setTypeParser(1184, value => new Date(value).toISOString());
const identifier = value => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('数据库隔离空间名称无效。');
  return '"' + value + '"';
};
function loadEnv() {
  const file = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
loadEnv();
function bind(sql) {
  let n=0, quoted=false, result='';
  for(let i=0;i<sql.length;i++) {
    const c=sql[i];
    if(c === "'") { if(quoted && sql[i+1] === "'"){result += "''";i++;continue;} quoted=!quoted; }
    result += c==='?' && !quoted ? '$'+(++n) : c;
  }
  return result;
}
function createDatabase({ url=process.env.DATABASE_URL, schema=process.env.DATABASE_SCHEMA || 'public' }={}) {
  if (!url) throw new Error('请配置 DATABASE_URL，或先运行 npm run db:setup。');
  identifier(schema);
  const pool = new Pool({connectionString:url,max:Number(process.env.PG_POOL_MAX)||10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,options:`-c search_path=${schema} -c timezone=UTC`});
  const storage = new AsyncLocalStorage();
  let onCommit = async()=>{};
  const db = {
    pool, schema, url, context:()=>storage.getStore(),
    setOnCommit: callback=>{onCommit=callback;},
    async query(sql, values=[]) {
      const context=storage.getStore();
      if(context) context.queryCount=(context.queryCount||0)+1;
      return (context?.client || pool).query(bind(sql),values);
    },
    async one(sql,...values) {return (await db.query(sql,values)).rows[0];},
    async many(sql,...values) {return (await db.query(sql,values)).rows;},
    async run(sql,...values) {
      if(/^\s*INSERT\s+INTO\s+(users|departments|audit|events)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) sql+=' RETURNING '+(/INSERT\s+INTO\s+events\b/i.test(sql)?'seq':'id');
      const result=await db.query(sql,values);
      return {rowCount:result.rowCount,id:result.rows[0]?.id ?? result.rows[0]?.seq};
    },
    // 批量加载组织信息，领域中的权限和树遍历保持纯内存计算。
    async loadCommon() {
      const c=storage.getStore();
      const metadata=await db.many('SELECT * FROM metadata');
      const users=await db.many('SELECT * FROM users ORDER BY id');
      const departments=await db.many('SELECT * FROM departments WHERE deleted=0 ORDER BY id');
      const profiles=await db.many('SELECT * FROM directory_profiles');
      const clock=await db.one('SELECT value FROM event_clock WHERE id=1');
      c.previousModel=c.model||c.previousModel;
      Object.assign(c,{metadata:new Map(metadata.map(r=>[r.key,r.value])),users,departments,profiles,seq:clock.value,model:null});
    },
    async scope(callback,{write=false,lock=null,prepare=null}={}) {
      const client=await pool.connect();
      const context={client,write,dirty:new Set(),eventTypes:new Set(),queryCount:0,seq:0};
      let committed=false,result;
      try {
        await client.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        if(write) {
          // 组织变化独占；目标写入共享组织锁，再按树加锁。锁顺序固定。
          await client.query(lock==='organization'?'SELECT pg_advisory_xact_lock(714203,1)':'SELECT pg_advisory_xact_lock_shared(714203,1)');
        }
        result=await storage.run(context,async()=>{
          if(write && lock && lock!=='organization') await db.query('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',[lock]);
          // 写入先锁定事务游标；同一读模型不会混合两个提交批次。读请求仍可并行。
          if(write) await db.query('SELECT value FROM event_clock WHERE id=1 FOR UPDATE');
          await db.loadCommon();
          if(prepare)await prepare();
          return callback();
        });
        await client.query('COMMIT'); committed=true;
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      } finally {client.release();}
      if(committed && write) { try { await onCommit(context); for(const callback of context.afterCommit || []) await callback(); } catch { console.error('事务已提交，实时通知稍后会自动重试。'); } }
      return result;
    },
    readMeta:key=>storage.getStore().metadata.get(key),
    async writeMeta(key,value) {
      await db.run('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(value));
      storage.getStore().metadata.set(key,String(value));
    },
    allUsers:()=>storage.getStore().users,
    allDepartments:()=>storage.getStore().departments,
    userById:id=>storage.getStore().users.find(u=>u.id===Number(id)),
    async migrate({beforeUpgrade} = {}) {
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(714203,0)');
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        const files = fs.readdirSync(path.join(__dirname,'migrations')).filter(f=>f.endsWith('.sql')).sort();
        const applied = (await client.query('SELECT version FROM schema_migrations')).rows.map(r=>r.version);
        const pending = files.filter(f=>!applied.includes(f));
        if(applied.length && pending.length && beforeUpgrade) await beforeUpgrade(pending);
        for(const file of files) {
          const has=await client.query('SELECT 1 FROM schema_migrations WHERE version=$1',[file]);
          if(!has.rowCount){await client.query(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[file]);}
        }
        await client.query('COMMIT');
      } catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
    },
    async resetIdentities() {
      for(const table of ['users','departments','audit','checkins']) {
        const col=table==='checkins'?'ordinal':'id';
        await db.query(`SELECT setval(pg_get_serial_sequence('${table}','${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}),0)+1,false)`);
      }
    },
    async notify() {if (!storage.getStore().eventTypes.size) return; await db.query("SELECT pg_notify('goal_together_changed',?)",[JSON.stringify({schema,seq:storage.getStore().seq})]);},
    async listen(callback) {
      let client=null,timer=null,closed=false;
      const connect=async()=>{
        if(closed)return;
        let next;
        const reconnect=()=>{
          if(client===next)client=null;
          if(next){next.removeListener('error',reconnect);next.release(true);next=null;}
          if(!closed&&!timer)timer=setTimeout(()=>{timer=null;connect();},1000);
        };
        try {
          next=await pool.connect();
          if(closed){next.release();return;}
          client=next;
          next.on('error',reconnect);
          next.on('notification',msg=>{try{const data=JSON.parse(msg.payload);if(data.schema===schema)Promise.resolve(callback(data)).catch(()=>{});}catch{}});
          await next.query('LISTEN goal_together_changed');
        }catch{reconnect();}
      };
      await connect();
      return async()=>{closed=true;clearTimeout(timer);if(client){const previous=client;client=null;await previous.query('UNLISTEN *').catch(()=>{});previous.release();}};
    },
    close:()=>pool.end()
  };
  pool.on('error',()=>console.error('数据库连接中断，正在等待恢复。'));
  return db;
}
async function temporarySchema(kind) {
  loadEnv();
  const url=process.env[kind==='test'?'TEST_DATABASE_URL':'DEMO_DATABASE_URL'];
  if(!url || !new URL(url).pathname.endsWith('_'+kind))throw new Error(`请配置独立的 ${kind==='test'?'TEST':'DEMO'}_DATABASE_URL，库名必须以 _${kind} 结尾。`);
  const schema=`${kind}_${crypto.randomBytes(10).toString('hex')}`;
  const pool=new Pool({connectionString:url});
  try{await pool.query('CREATE SCHEMA '+identifier(schema));}finally{await pool.end();}
  return {url,schema,async cleanup(){
    if(!schema.startsWith(kind+'_'))throw new Error('拒绝清理非临时隔离空间。');
    const pool=new Pool({connectionString:url});
    try{await pool.query('DROP SCHEMA '+identifier(schema)+' CASCADE');}finally{await pool.end();}
  }};
}
module.exports={createDatabase,temporarySchema,identifier,loadEnv};

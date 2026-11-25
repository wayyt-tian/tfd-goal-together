'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
function postgresTool(db,program,args=[]) {
  const url=new URL(db.url);
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:url.searchParams.get('sslmode')||'prefer'};
  const version=spawnSync(program,['--version'],{encoding:'utf8'});
  if(version.status===0 && /\b16\./.test(version.stdout))return spawn(program,args,{env,stdio:['pipe','pipe','pipe']});
  const dockerArgs=['run','--rm','-i','--network','host'];
  for(const key of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE'])dockerArgs.push('-e',key);
  dockerArgs.push('postgres:16-alpine',program,...args);
  return spawn('docker',dockerArgs,{env,stdio:['pipe','pipe','pipe']});
}
async function backupDatabase(db,label='manual', targetDirectory) {
  const directory=targetDirectory || process.env.BACKUP_DIR || path.join(process.env.GUOQI_DATA_DIR||path.resolve(__dirname,'../../.data'),'backups');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,`${label}-${new Date().toISOString().replace(/[:.]/g,'-')}-${require('node:crypto').randomBytes(4).toString('hex')}.dump`);
  const child=postgresTool(db,'pg_dump',['--format=custom','--no-owner','--no-acl','--schema='+db.schema]);
  let stderr='';child.stderr.on('data',b=>{stderr+=b;});child.stdin.end();
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('数据库备份失败，请检查备份工具和数据库连接。')));});
  try{await Promise.all([pipeline(child.stdout,fs.createWriteStream(file,{flags:'wx',mode:0o600})),done]);return file;}
  catch(error){child.kill();fs.rmSync(file,{force:true});throw error;}
}
module.exports={backupDatabase,postgresTool};

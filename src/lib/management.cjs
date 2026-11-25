'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {importContacts}=require('./directory.cjs');
const id=()=>crypto.randomBytes(16).toString('hex');
function createManagement(c) {
  const {db,goals,requireCondition:check,can,canManageAccount,hashPassword,verifyPassword,passwordValue,issueToken,audit,orgChanged,backupTo,backupDirectory,base,mode,revision}=c;
  const started=Date.now();
  const requireCapability=(user,value)=>check(can(user,value),'你没有此项管理权限。',403);
  async function event(user,action,subject) {await audit(user.id,action,subject);await goals.emit(user.id,'org.changed',null,null,{action});}
  async function recordedBackup(user,label) {
    const key=id();
    try {
      const file=await backupTo(label);
      await db.run("INSERT INTO backups(id,actor,filename,label,status,bytes) VALUES (?,?,?,?,'ready',?)",key,user.id,path.basename(file),label,fs.statSync(file).size);
      await event(user,'backup.create',key);
      return {id:key,status:'ready',file};
    } catch(e) {
      await db.run("INSERT INTO backups(id,actor,label,status,error) VALUES (?,?,?,'failed',?)",key,user.id,label,'备份失败，请检查数据库连接和备份工具。');
      await event(user,'backup.failed',key);
      return {id:key,status:'failed',error:'备份失败，请检查数据库连接和备份工具。'};
    }
  }
  async function workbook(payload,fn) {
    check(typeof payload?.content==='string' && /^[A-Za-z0-9+/]*={0,2}$/.test(payload.content),'请上传有效的 XLSX 通讯录。');
    const bytes=Buffer.from(payload.content,'base64');
    check(bytes.length>0 && bytes.length<=5*1024*1024,'通讯录文件不能超过 5 MB。',413);
    check(bytes.subarray(0,2).toString()==='PK','文件不是有效的 XLSX 通讯录。');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'goal-directory-'));
    const file=path.join(directory,'contacts.xlsx');
    try {fs.writeFileSync(file,bytes,{mode:0o600});return await fn(file);}
    finally {fs.rmSync(directory,{recursive:true,force:true});}
  }
  async function handle({pathname,method,user,session,request,response,send,mutate,readBody}) {
    if(pathname==='/api/account' && method==='GET') {
      const data=await c.bootstrapFor(user);
      send(response,200,{account:{...c.adminUser(user),businessRole:data.access.role},capabilities:c.capabilities(user)});return true;
    }
    if(pathname==='/api/account/password' && method==='POST') {
      await mutate(async body=>{
        check(await verifyPassword(body.currentPassword,user.password_hash),'原密码不正确。',403);
        await db.run('UPDATE users SET password_hash=?,version=version+1 WHERE id=?',await hashPassword(passwordValue(body.password,check)),user.id);
        await db.run('UPDATE account_tokens SET used_at=now() WHERE user_id=? AND used_at IS NULL',user.id);
        await db.run('DELETE FROM sessions WHERE user_id=?',user.id);
        await event(user,'account.password',user.id);return {reauthenticate:true};
      });return true;
    }
    if(pathname==='/api/account/sessions/revoke' && method==='POST') {
      await mutate(async()=>{await db.run('DELETE FROM sessions WHERE user_id=?',user.id);await event(user,'account.logout_all',user.id);return {reauthenticate:true};});return true;
    }
    const tokenMatch=pathname.match(/^\/api\/admin\/users\/(\d+)\/activation$/);
    if(tokenMatch && method==='POST') {
      requireCapability(user,'members.manage');
      await mutate(async()=>{
        const target=db.userById(Number(tokenMatch[1]));check(target?.active && target.phone,'请先启用账号并配置手机号。',404);
        check(canManageAccount(user,target),'只有公司负责人可以为管理人员重置密码。',403);
        const token=await issueToken(db,target.id,user.id);
        await db.run('DELETE FROM sessions WHERE user_id=?',target.id);
        await event(user,'account.activation',target.id);
        return {path:`${base || '/'}${base?'/':''}#/activate?token=${token}`,expiresAt:new Date(Date.now()+1800000).toISOString()};
      });return true;
    }
    if(pathname==='/api/admin/departments/inactive' && method==='GET') {
      requireCapability(user,'organization.manage');
      send(response,200,{items:await db.many('SELECT id,name,parent_id AS "parentId",version FROM departments WHERE deleted=1 ORDER BY id')});return true;
    }
    const restore=pathname.match(/^\/api\/departments\/(\d+)\/restore$/);
    if(restore && method==='POST') {
      requireCapability(user,'organization.manage');
      await mutate(async body=>{
        const row=await db.one('SELECT * FROM departments WHERE id=? AND deleted=1',Number(restore[1]));check(row,'部门不存在或已恢复。',404);
        check(row.version===Number(body.version),'部门信息已变化，请重新载入。',409);
        const parent=body.parentId===undefined?row.parent_id:body.parentId;
        check(parent===null || db.allDepartments().some(d=>d.id===Number(parent)&&d.parent_id===null),'请先恢复上级部门，或选择在用的一级部门。');
        check(typeof (body.name??row.name)==='string','请填写部门名称。');
        const name=(body.name??row.name).trim();check(name && name.length<=40,'请填写不超过 40 字的部门名称。');
        check(!db.allDepartments().some(d=>d.name===name && d.parent_id===(parent===null?null:Number(parent))),'同层级已有同名部门，请修改名称。',409);
        await db.run('UPDATE departments SET deleted=0,name=?,parent_id=?,version=version+1 WHERE id=?',name,parent===null?null:Number(parent),row.id);
        await orgChanged(user,{action:'department.restore',subject:row.id});return {id:row.id};
      });return true;
    }
    if(pathname==='/api/admin/directory/template' && method==='GET') {
      requireCapability(user,'directory.import');
      const template=path.resolve(__dirname,'../../assets/directory-template.xlsx');
      response.downloadFile={file:template,name:'成员导入模板.xlsx'};return true;
    }
    if(pathname==='/api/admin/directory/preview' && method==='POST') {
      requireCapability(user,'directory.import');
      await mutate(async body=>{
        const summary=await workbook(body,file=>importContacts(db,file,{actor:user}));
        const key=id(),expiresAt=new Date(Date.now()+1800000).toISOString();
        await db.run('DELETE FROM directory_imports WHERE expires_at<now()');
        await db.run('INSERT INTO directory_imports(id,actor,revision,contacts,summary,expires_at) VALUES (?,?,?,?,?,?)',key,user.id,revision(),JSON.stringify({content:body.content}),JSON.stringify(summary),expiresAt);
        await event(user,'directory.preview',key);
        return {id:key,summary,expiresAt};
      });return true;
    }
    const apply=pathname.match(/^\/api\/admin\/directory\/([a-f0-9]{32})\/apply$/);
    if(apply && method==='POST') {
      requireCapability(user,'directory.import');
      await mutate(async()=>{
        const job=await db.one('SELECT * FROM directory_imports WHERE id=? AND actor=? AND applied_at IS NULL AND expires_at>now() FOR UPDATE',apply[1],user.id);
        check(job,'导入预览已失效，请重新上传预览。',409);
        check(job.revision===revision(),'组织已发生变化，请重新预览后导入。',409);
        const result=await workbook(JSON.parse(job.contacts),file=>importContacts(db,file,{apply:true,actor:user,expectedRevision:job.revision,backup:async label=>{
          const saved=await recordedBackup(user,label);check(saved.status==='ready','备份失败，导入未执行。',503);return saved.file;
        }}));
        await db.run("UPDATE directory_imports SET applied_at=now(),contacts='{}' WHERE id=?",job.id);
        await db.loadCommon();
        const {backup,...report}=result;return {report};
      });return true;
    }
    if(pathname==='/api/admin/audit' && method==='GET') {
      requireCapability(user,'audit.system');
      const params=new URL(request.url,'http://localhost').searchParams;
      const limit=30, before=Number(params.get('before'))||2147483647;
      const where=['id<?'],values=[before];
      if(!can(user,'audit.all'))where.push("(action LIKE 'account.%' OR action LIKE 'user.%' OR action LIKE 'department.%' OR action LIKE 'directory.%')");
      if(params.get('actor')){where.push('actor=?');values.push(Number(params.get('actor')));}
      if(params.get('action')){where.push('action LIKE ?');values.push('%'+params.get('action').slice(0,80)+'%');}
      for(const [key,op] of [['from','>='],['to','<=']])if(params.get(key)){check(/^\d{4}-\d{2}-\d{2}$/.test(params.get(key)),'日期格式不正确。');where.push('created_at '+op+' ?::date'+(key==='to'?" + interval '1 day' - interval '1 microsecond'":''));values.push(params.get(key));}
      const rows=await db.many('SELECT id,actor,action,subject,created_at AS at FROM audit WHERE '+where.join(' AND ')+' ORDER BY id DESC LIMIT 31',...values);
      const items=rows.slice(0,limit).map(row=>{
        let subjectLabel='业务记录';
        if(/^(account|user)\./.test(row.action))subjectLabel=db.userById(Number(row.subject))?.name||db.userById(row.actor)?.name||'账号';
        else if(row.action.startsWith('department.'))subjectLabel=db.allDepartments().find(d=>d.id===Number(row.subject))?.name||'部门';
        else if(row.action.startsWith('directory.'))subjectLabel='成员通讯录';
        else if(row.action.startsWith('backup.'))subjectLabel='数据库备份';
        else if(row.action.startsWith('settings.'))subjectLabel='全局规则';
        else if(row.action==='goal.handover')subjectLabel='目标负责人交接';
        return {...row,subjectLabel,actorName:db.userById(row.actor)?.name||'系统'};
      });
      send(response,200,{items,next:rows.length>limit?items.at(-1).id:null});return true;
    }
    if(pathname==='/api/admin/status' && method==='GET') {
      requireCapability(user,'system.read');await db.one('SELECT 1');
      const last=await db.one('SELECT status,created_at AS at FROM backups ORDER BY created_at DESC LIMIT 1');
      send(response,200,{mode,database:'正常',version:require('../../package.json').version,uptimeSeconds:Math.floor((Date.now()-started)/1000),lastBackup:last||null});return true;
    }
    if(pathname==='/api/admin/backups' && method==='GET') {
      requireCapability(user,'backup.manage');
      send(response,200,{items:await db.many('SELECT id,label,status,created_at AS at,bytes,error FROM backups ORDER BY created_at DESC LIMIT 50')});return true;
    }
    if(pathname==='/api/admin/backups' && method==='POST') {
      requireCapability(user,'backup.manage');
      await mutate(async()=>{const {file,...result}=await recordedBackup(user,'manual');return result;});return true;
    }
    const download=pathname.match(/^\/api\/admin\/backups\/([a-f0-9]{32})\/download$/);
    if(download && method==='GET') {
      requireCapability(user,'backup.manage');
      const row=await db.one("SELECT * FROM backups WHERE id=? AND status='ready'",download[1]);
      check(row?.filename && path.basename(row.filename)===row.filename,'备份不存在。',404);
      const file=path.join(backupDirectory,row.filename);check(fs.existsSync(file),'备份文件已移走，请创建新备份。',404);
      await event(user,'backup.download',row.id);
      response.downloadFile={file,name:'目标工作台备份.dump'};return true;
    }
    return false;
  }
  return {handle};
}
module.exports={createManagement};

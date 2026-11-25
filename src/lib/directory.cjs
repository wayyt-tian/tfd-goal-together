 'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
const {backupDatabase}=require('../db/backup.cjs');
const assert=(condition,message)=>{if(!condition){const e=new Error(message);e.status=400;throw e;}};
async function readContacts(sourcePath) {
  let result;
  try {result=await execFile('python3',[path.resolve(__dirname,'../../scripts/read-contacts.py'),path.resolve(sourcePath)],{maxBuffer:5*1024*1024,timeout:15000});}
  catch(e){throw Object.assign(new Error((e.stderr||'通讯录读取失败，请检查文件格式。').trim()),{status:400});}
  return JSON.parse(result.stdout);
}
  // v0.1/v0.2 初始化时生成的岗位占位账号，通讯录导入后不再需要
  const LEGACY_PLACEHOLDERS = new Set(['公司负责人', '品牌负责人', 'AIGC负责人', 'AI成片负责人', 'TOKEN负责人', '内容负责人', 'BPO负责人']);

async function importContacts(database,sourcePath,{apply=false,actor=null,backup=label=>backupDatabase(database,label),expectedRevision}={}) {
  const contacts = await readContacts(sourcePath);
  assert(contacts.length > 0 && contacts.length <= 500, '一次导入仅支持 1 至 500 位成员。');
  assert(new Set(contacts.map(item => item.phone)).size === contacts.length, '通讯录存在重复手机号。');
  assert(contacts.every(item => item.sourceId && item.name.length <= 30), '成员来源 ID 或姓名无效。');
  assert(new Set(contacts.map(item => item.sourceId)).size === contacts.length, '通讯录存在重复用户 ID。');
  assert(new Set(contacts.map(item => item.company)).size === 1, '通讯录包含多个公司，需分别处理。');
  assert(contacts.every(item => item.departments.length <= 2 && item.departments.every(name => name.length <= 40)), '部门名称或层级无效（最多两级）。');

let result;
const report=text=>{result=JSON.parse(text);};
const execute=async()=>{
  if(expectedRevision!==undefined)assert(Number(database.readMeta('revision'))===expectedRevision,'组织已发生变化，请重新预览后导入。');
      const metadata = key => database.readMeta(key);
      const hasTable = name => true;
      const withManager = true,
        withTitle = true,
        withGoals = true,
        withEvents = true;
      assert(metadata('configured') === '1', '请先在工作台配置公司负责人。');
      const previousRevision = Number(metadata('revision') || 0);
      // 目标与进展的指纹：导入前后必须完全一致
      const fingerprint = async () => JSON.stringify({
        legacy: metadata('performance'),
        goals: withGoals ? await database.one('SELECT COUNT(*) AS n, COALESCE(SUM(version),0) AS v FROM goals') : null,
        checkins: hasTable('checkins') ? await database.one('SELECT COUNT(*) AS n, COALESCE(SUM(value),0) AS v FROM checkins') : null
      });
      const before = await fingerprint();
      const beforeUsers = await database.many('SELECT * FROM users ORDER BY id');
      const beforeDepartments = await database.many('SELECT * FROM departments WHERE deleted=0 ORDER BY id');
      const owners = beforeUsers.filter(user => user.role === 'owner' && user.active);
      assert(owners.length, '至少需要保留一位公司负责人。');
      const profiles = hasTable('directory_profiles') ? await database.many('SELECT * FROM directory_profiles') : [];

      // 1. 匹配账号
      const seenUsers = new Set();
      const matches = contacts.map(contact => {
        const profile = profiles.find(item => item.source_id === contact.sourceId && item.source_company === contact.company);
        let user = profile && beforeUsers.find(item => item.id === profile.user_id);
        if (!user) {
          const phoneMatches = beforeUsers.filter(item => item.phone === contact.phone);
          assert(phoneMatches.length <= 1, `第 ${contact.sourceRow} 行匹配到多个已有账号，需要人工核对。`);
          user = phoneMatches[0];
        }
        if (!user) {
          const nameMatches = beforeUsers.filter(item => item.name === contact.name && !item.phone);
          assert(nameMatches.length <= 1, `第 ${contact.sourceRow} 行存在多个同名且未配置手机号的账号，需要人工核对。`);
          user = nameMatches[0];
        }
        assert(!user || !seenUsers.has(user.id), '多位通讯录成员匹配到了同一个工作台账号，需要人工核对。');
        if (user) {
          assert(!actor || actor.role==='owner' || user.role==='member', '系统管理员不能通过导入修改管理人员，请由公司负责人执行。');
          seenUsers.add(user.id);
          assert(!beforeUsers.some(other => other.id !== user.id && other.active && other.phone === contact.phone), `第 ${contact.sourceRow} 行的手机号与其他账号冲突。`);
          if (user.role === 'owner') assert(user.name === contact.name && user.phone === contact.phone, '通讯录中公司负责人的姓名或手机号与当前账号不同，请先在工作台核对。');
        }
        return {
          contact,
          user
        };
      });

      // 2. 需要归档的旧版岗位占位账号
      const archive = beforeUsers.filter(user => user.active && user.role !== 'owner' && !user.phone && !user.credential && !user.password_hash && !seenUsers.has(user.id) && LEGACY_PLACEHOLDERS.has(user.name));
      const archivedOwnedGoals = withGoals && archive.length ? (await database.one(`SELECT COUNT(*) AS n FROM goals WHERE archived_at IS NULL AND owner_id IN (${archive.map(() => '?').join(',')})`, ...archive.map(user => user.id))).n : 0;

      // 3. 部门
      const requiredPaths = new Set();
      for (const contact of contacts) contact.departments.forEach((_, index) => requiredPaths.add(contact.departments.slice(0, index + 1).join('/')));
      const existingPath = department => {
        const parent = beforeDepartments.find(item => item.id === department.parent_id);
        return `${parent ? parent.name + '/' : ''}${department.name}`;
      };
      const summary = {
        source: path.basename(sourcePath),
        company: contacts[0].company,
        contacts: contacts.length,
        newUsers: matches.filter(item => !item.user).length,
        matchedUsers: matches.filter(item => item.user).length,
        archivedPlaceholders: archive.map(user => user.name),
        goalsOwnedByArchived: archivedOwnedGoals,
        importedFirstLevel: [...requiredPaths].filter(item => !item.includes('/')).length,
        importedSecondLevel: [...requiredPaths].filter(item => item.includes('/')).length,
        newDepartments: [...requiredPaths].filter(item => !beforeDepartments.some(department => existingPath(department) === item)).length,
        pendingLogin: matches.filter(item => !item.user?.password_hash).length,
        withSupervisor: contacts.filter(item => item.managerPhone).length,
        unresolvedSupervisors: contacts.filter(item => item.managerPhone && !contacts.some(manager => manager.phone === item.managerPhone)).length
      };
      assert(!summary.unresolvedSupervisors, `${summary.unresolvedSupervisors} 位成员的直属上级不在这份通讯录里，请先核对。`);
      if (!apply) {
        report(JSON.stringify({
          mode: '计划（未写入）',
          ...summary,
          retainedEmptyDepartments: beforeDepartments.filter(department => !requiredPaths.has(existingPath(department))).map(existingPath),
          hint: ['确认无误后追加 --apply 执行导入，执行前会自动备份数据库。', archivedOwnedGoals ? `有 ${archivedOwnedGoals} 个目标由即将归档的占位账号负责，导入后请在目标页“编辑”里转交给真实负责人。` : ''].filter(Boolean)
        }, null, 2));
        return;
      }

      // ---------- 写入 ----------
      const backupPath = await backup('before-contact-import');
      const departmentIds = new Map(beforeDepartments.map(department => [existingPath(department), department.id]));
      for (const departmentPath of [...requiredPaths].sort((first, second) => first.split('/').length - second.split('/').length)) {
        if (departmentIds.has(departmentPath)) continue;
        const parts = departmentPath.split('/');
        const parentId = parts.length === 2 ? departmentIds.get(parts[0]) : null;
        const id = Number((await database.run('INSERT INTO departments(name,parent_id) VALUES (?,?)', parts.at(-1), parentId)).id);
        departmentIds.set(departmentPath, id);
      }
      const userIds = new Map();
      for (const {
        contact,
        user
      } of matches) {
        const departmentId = contact.departments.length ? departmentIds.get(contact.departments.join('/')) : null;
        let id = user?.id;
        if (user) {
          // 通讯录不会授予公司或部门的管理权限
          await database.run('UPDATE users SET name=?,phone=?,department_id=?,active=1,version=version+1 WHERE id=?', contact.name, contact.phone, departmentId, id);
          if (user.name !== contact.name || user.phone !== contact.phone) await database.run('DELETE FROM sessions WHERE user_id=?', id);
        } else id = Number((await database.run('INSERT INTO users(name,phone,department_id) VALUES (?,?,?)', contact.name, contact.phone, departmentId)).id);
        if (withTitle && contact.title) await database.run("UPDATE users SET title=? WHERE id=? AND (title IS NULL OR title='')", contact.title.slice(0, 40), id);
        userIds.set(contact.phone, id);
      }
      for (const {
        contact
      } of matches) {
        await database.run('INSERT INTO directory_profiles(user_id,source_id,source_company,alternate_names,direct_manager_id,source_row) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET source_id=excluded.source_id,source_company=excluded.source_company,alternate_names=excluded.alternate_names,direct_manager_id=excluded.direct_manager_id,source_row=excluded.source_row', userIds.get(contact.phone), contact.sourceId, contact.company, JSON.stringify(contact.alternateNames), contact.managerPhone ? userIds.get(contact.managerPhone) : null, contact.sourceRow);
      }
      // 汇报线：只补空的，不覆盖手工设置，不制造循环
      let reportingLines = 0;
      if (withManager) {
        const managerOf = new Map((await database.many('SELECT id, manager_id FROM users')).map(row => [row.id, row.manager_id]));
        const createsCycle = (userId, managerId) => {
          for (let cursor = managerId, guard = 0; cursor && guard < 500; cursor = managerOf.get(cursor), guard++) if (cursor === userId) return true;
          return false;
        };
        for (const {
          contact
        } of matches) {
          if (!contact.managerPhone) continue;
          const userId = userIds.get(contact.phone),
            managerId = userIds.get(contact.managerPhone);
          if (!managerId || managerId === userId || managerOf.get(userId) || createsCycle(userId, managerId)) continue;
          await database.run('UPDATE users SET manager_id=?,version=version+1 WHERE id=? AND manager_id IS NULL', managerId, userId);
          managerOf.set(userId, managerId);
          reportingLines++;
        }
      }
      for (const user of archive) {
        await database.run('UPDATE users SET active=0,version=version+1 WHERE id=?', user.id);
        await database.run('UPDATE departments SET manager_id=NULL,version=version+1 WHERE manager_id=?', user.id);
        if (withManager) await database.run('UPDATE users SET manager_id=NULL,version=version+1 WHERE manager_id=?', user.id);
        await database.run('DELETE FROM sessions WHERE user_id=?', user.id);
      }
      if ((await fingerprint()) !== before) throw new Error('目标或进展被意外改动，导入已撤回。');
      const importedAt = new Date().toISOString();
      const initialization = {
        ...summary,
        reportingLines,
        importedAt,
        sourceHash: crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')
      };
      await database.run('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'directoryInitialization', JSON.stringify(initialization));
      await database.run('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'revision', String(previousRevision + 1));
      await database.run('INSERT INTO audit(actor,action,subject,created_at) VALUES (?,?,?,?)', (actor?.id || owners[0].id), 'directory.initialize', JSON.stringify(summary), importedAt);
      // 让正在运行的工作台感知到组织变化（服务端每 20 秒检查一次新事件并推送给所有在线的人）
      if (withEvents) await database.run("INSERT INTO events(created_at,actor_id,type,goal_id,ref_id,payload) VALUES (?,?,'org.changed',NULL,NULL,?)", importedAt, (actor?.id || owners[0].id), JSON.stringify({
        action: 'directory.initialize',
        contacts: contacts.length,
        reportingLines
      }));
      const event = await database.one('SELECT value FROM event_clock WHERE id=1');
      database.context().seq = event.value;
      database.context().eventTypes.add('org.changed');
      await database.notify();
      report(JSON.stringify({
        mode: '已写入',
        ...summary,
        reportingLines,
        revision: previousRevision + 1,
        backup: backupPath
      }, null, 2));

};
if(database.context())await execute();
else await database.scope(execute,{write:apply,lock:apply?'organization':null});
return result;
}
module.exports={readContacts,importContacts};

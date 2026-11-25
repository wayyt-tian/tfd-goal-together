'use strict';
async function createApplication(options = {}) {

// 锅气家族 · 正式/演示独立应用实例 v0.4
// 单进程 Node 22 + PostgreSQL 16。业务规则在 lib/goals.cjs，演示数据在 lib/demo.cjs。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
  createDatabase
} = require('./db/index.cjs');
const {
  backupDatabase
} = require('./db/backup.cjs');
const {
  createGoalDomain
} = require('./lib/goals.cjs');
const {
  WEB,
  BRAND,
  FONTS,
  DATA_DIRECTORY
} = require('./paths.cjs');
const DEMO = options.demo === true;
const DEMO_LIVE = DEMO && options.live === true;
const BASE = options.base || '';
const MODE = DEMO ? 'demo' : 'formal';
const COOKIE = 'guoqi_' + MODE;
const dataDirectory = options.dataDirectory || DATA_DIRECTORY;
const backupDirectory = options.backupDirectory || path.join(dataDirectory, 'backups');
const TODAY_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(process.env.GUOQI_TODAY || '') ? process.env.GUOQI_TODAY : null;
const SESSION_MS = 8 * 3600 * 1000;
const { capabilities, can, canManageAccount } = require('./lib/permissions.cjs');
const { hashPassword, verifyPassword, passwordValue, digest, setupCredential, issueToken } = require('./lib/accounts.cjs');
const database = createDatabase({url: options.url, schema: options.schema});
try {
const prior = await database.one("SELECT to_regclass('metadata') AS existing");
if(prior.existing) {
  const tags=await database.many("SELECT key,value FROM metadata WHERE key IN ('workspaceMode','demoPersonas')");
  if(tags.some(t=>t.key==='workspaceMode' && t.value!==MODE) || !DEMO && tags.some(t=>t.key==='demoPersonas')) {throw new Error('数据库所属模式不一致，已拒绝启动。');}
}
let upgradeReport;
const reportFile=path.join(dataDirectory,'migration-report.json');
await database.migrate({beforeUpgrade: async files => {
  const file = await backupDatabase(database, 'before-upgrade', backupDirectory);
  upgradeReport={at:new Date().toISOString(),backup:path.basename(file),migrations:files,legacyCredentialsRetained:true,status:'prepared'};
  fs.writeFileSync(reportFile,JSON.stringify(upgradeReport,null,2),{mode:0o600});
}});
if(upgradeReport){upgradeReport.status='applied';fs.writeFileSync(reportFile,JSON.stringify(upgradeReport,null,2),{mode:0o600});}
const configured = (await database.one("SELECT value FROM metadata WHERE key='configured'"))?.value === '1';
const setup = !DEMO && !configured ? setupCredential(dataDirectory) : {file:null,valid:()=>false};
const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const today = () => TODAY_OVERRIDE || shanghaiDate.format(new Date());
const now = () => new Date().toISOString();
const {
  readMeta,
  writeMeta,
  allUsers,
  allDepartments,
  userById
} = database;
const revision = () => Number(readMeta('revision') || 0);
const bumpRevision = async () => writeMeta('revision', revision() + 1);
const audit = async (actor, action, subject) => database.run('INSERT INTO audit(actor,action,subject,created_at) VALUES (?,?,?,?)', actor ?? null, action, String(subject), now());
class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function requireCondition(condition, message, status = 400) {
  if (!condition) throw new RequestError(status, message);
}
const goals = createGoalDomain({
  db: database,
  RequestError,
  requireCondition,
  now,
  today,
  readMeta,
  writeMeta,
  allUsers,
  allDepartments,
  userById
});
async function transaction(callback) {
  const result = await callback();
  await database.loadCommon();
  await goals.prepareModel();
  return result;
}
const backupTo = async label => backupDatabase(database, label, backupDirectory);
await database.scope(async () => {
  const savedMode = readMeta('workspaceMode');
  requireCondition(!savedMode || savedMode === MODE, '数据库所属模式不一致，已拒绝启动。');
  requireCondition(DEMO || !readMeta('demoPersonas'), '不能将演示数据作为正式数据启动。');
  await writeMeta('workspaceMode', MODE);
  if (!readMeta('revision') && !allUsers().length) {
    if (DEMO) await require('./lib/demo.cjs').seed({
      db: database,
      writeMeta,
      today,
      now
    });else {
      await database.run("INSERT INTO users(id,name,role,title) VALUES (1,'公司负责人','owner','公司负责人')");
    }
    await writeMeta('revision', 1);
    await database.resetIdentities();
  }
}, {
  write: true,
  lock: 'organization'
});

// ---------- 通用工具 ----------
function textValue(value, max = 100) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function requiredText(value, label, max = 100) {
  const result = textValue(value, max);
  requireCondition(result, `请填写${label}。`);
  return result;
}
function normalizedPhone(value) {
  const phone = textValue(value, 30).replace(/[\s-]/g, '').replace(/^\+86/, '');
  requireCondition(/^1[3-9]\d{9}$/.test(phone), '请填写有效的 11 位中国大陆手机号。');
  return phone;
}
function requireOwner(user) {
  requireCondition(user.role === 'owner', '只有公司负责人可以管理组织和成员。', 403);
}
function departmentName(id) {
  return id === null ? '公司直属' : allDepartments().find(d => d.id === id)?.name || '未分配部门';
}
function adminUser(user, owned = new Map()) {
  const profile = database.context().profiles.find(p => p.user_id === user.id);
  return {
    id: user.id,
    name: user.name,
    title: user.title || '',
    dept: departmentName(user.department_id),
    departmentId: user.department_id,
    managerId: user.manager_id || null,
    managerName: userById(user.manager_id)?.name || '',
    role: user.role,
    active: Boolean(user.active),
    phone: user.phone || '',
    phoneMasked: user.phone ? user.phone.slice(0, 3) + '****' + user.phone.slice(7) : '未配置',
    loginConfigured: Boolean(user.phone && user.password_hash),
    version: user.version,
    managedRole: user.role,
    openGoals: owned.get(user.id) || 0,
    ...(profile ? {
      directory: {
        sourceId: profile.source_id,
        alternateNames: JSON.parse(profile.alternate_names),
        directManagerId: profile.direct_manager_id,
        directManagerName: userById(profile.direct_manager_id)?.name || ''
      }
    } : {})
  };
}
async function bootstrapFor(user) {
  const extras = {
    demo: DEMO,
    demoLive: DEMO_LIVE,
    mode: MODE,
    availableModes: options.availableModes || [MODE]
  };
  if (user.role === 'owner') {
    extras.directoryInitialization = JSON.parse(readMeta('directoryInitialization') || 'null');
    const migration = JSON.parse(readMeta('goalsMigrated') || 'null');
    extras.migration = migration && !migration.fresh && !migration.skipped ? migration : null;
  }
  const data = await goals.bootstrap(user, extras);
  data.access.capabilities = capabilities(user); data.access.managementRole = user.role;
  data.me.phone = user.phone || ''; data.me.version = user.version;
  return data;
}
function validManager(userId, managerId) {
  if (managerId === null || managerId === undefined || managerId === '') return null;
  const id = Number(managerId);
  const manager = userById(id);
  requireCondition(manager && manager.active, '直属上级需要是在职成员。');
  requireCondition(id !== userId, '不能把自己设为直属上级。');
  const seen = new Set();
  for (let cursor = manager; cursor && cursor.manager_id; cursor = userById(cursor.manager_id)) {
    requireCondition(cursor.manager_id !== userId, `这样设置会形成循环汇报（${manager.name} 的汇报线上已经有这位成员）。`);
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
  }
  return id;
}
async function deactivate(id) {
  const target = userById(id);
  // 离职后，原来直属他的人改为向他的上级汇报，避免团队关系断档
  await database.run('UPDATE users SET manager_id=? WHERE manager_id=?', target.manager_id ?? null, id);
  await database.run('UPDATE users SET active=0,version=version+1 WHERE id=?', id);
  await database.run('UPDATE departments SET manager_id=NULL WHERE manager_id=?', id);
  await database.run('DELETE FROM sessions WHERE user_id=?', id);
}
async function orgChanged(user, detail) {
  await bumpRevision();
  await goals.emit(user.id, 'org.changed', null, null, detail);
  await audit(user.id, detail.action, detail.subject ?? '');
}

// ---------- HTTP 基础 ----------
function readBody(request) {
  if (request.bodyPromise) return request.bodyPromise;
  return request.bodyPromise = new Promise((resolve, reject) => {
    let contents = '';
    request.on('data', chunk => {
      contents += chunk;
      if (Buffer.byteLength(contents) > (request.url?.startsWith('/api/admin/directory/preview') ? 8*1024*1024 : 1e6)) {
        reject(new RequestError(413, '提交的数据过大。'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(contents ? JSON.parse(contents) : {});
      } catch {
        reject(new RequestError(400, '请求数据格式不正确。'));
      }
    });
    request.on('error', reject);
  });
}
function send(response, status, payload, extraHeaders = {}) {
  if (response.buffered) {
    response.pending = {
      status,
      payload,
      extraHeaders
    };
    return;
  }
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
function sessionToken(request) {
  const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
async function getSession(request) {
  const token = sessionToken(request);
  if (!token) return null;
  const session = await database.one('SELECT * FROM sessions WHERE token_hash = ? AND expires > ?', tokenHash(token), Date.now());
  return session && userById(session.user_id)?.active ? session : null;
}
async function setSession(response, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  await database.run('DELETE FROM sessions WHERE expires <= ?', Date.now());
  await database.run('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES (?,?,?,?)', tokenHash(token), user.id, csrf, Date.now() + SESSION_MS);
  const secure = process.env.PUBLIC_ORIGIN?.startsWith('https://') ? '; Secure' : '';
  send(response, 200, {
    data: await bootstrapFor(user),
    csrf
  }, {
    'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=${BASE || "/"}; Max-Age=${SESSION_MS / 1000}${secure}`
  });
}

// ---------- 实时：SSE 只推送“有新变化了”的游标，客户端再按自己的权限取增量 ----------
const streams = new Set();
let lastBroadcastSeq = 0;
let lastPresence = -1;
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const stream of streams) {
    try {
      stream.response.write(message);
    } catch {
      streams.delete(stream);
    }
  }
}
function online() {
  return new Set([...streams].map(stream => stream.userId)).size;
}
let presenceTimer = null;
function schedulePresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    const count = online();
    if (count !== lastPresence) {
      lastPresence = count;
      broadcast('presence', {
        online: count
      });
    }
  }, 1500);
}
function afterCommit() {/* 仅由事务提交回调广播，事务内不会提前通知。 */}
database.setOnCommit(async context => {
  goals.commit(context);
  await closeRevokedStreams();
  if (context.seq > lastBroadcastSeq) {
    lastBroadcastSeq = context.seq;
    broadcast('seq', {
      seq: context.seq
    });
  }
});
const stopListening = await database.listen(async data => {
  if(data.seq<=lastBroadcastSeq)return;
  goals.invalidate();
  await closeRevokedStreams();
  const row = await database.one('SELECT value FROM event_clock WHERE id=1');
  if (row.value > lastBroadcastSeq) {
    lastBroadcastSeq = row.value;
    broadcast('seq', {
      seq: row.value
    });
  }
});
async function closeRevokedStreams() {
  if(!streams.size)return;
  const hashes=[...streams].map(s=>s.tokenHash);
  const alive=new Set((await database.many('SELECT token_hash FROM sessions WHERE token_hash=ANY(?::text[]) AND expires>?',hashes,Date.now())).map(s=>s.token_hash));
  for(const stream of streams)if(!alive.has(stream.tokenHash)){stream.response.end();streams.delete(stream);}
}
function openStream(request, response, session) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const stream = {
    response,
    userId: session.user_id,
    tokenHash: session.token_hash
  };
  const mine = [...streams].filter(item => item.userId === session.user_id);
  if (mine.length >= 6) {
    mine[0].response.end();
    streams.delete(mine[0]);
  }
  streams.add(stream);
  response.write(`retry: 4000\nevent: hello\ndata: ${JSON.stringify({
    seq: goals.currentSeq(),
    online: online()
  })}\n\n`);
  request.on('close', () => {
    streams.delete(stream);
    schedulePresence();
  });
  schedulePresence();
}
let heartbeatBusy = false;
const heartbeat = setInterval(async () => {
  if (heartbeatBusy) return;
  heartbeatBusy = true;
  try {
    const hashes = [...new Set([...streams].map(s => s.tokenHash))];
    const alive = new Set(hashes.length ? (await database.many('SELECT token_hash FROM sessions WHERE token_hash=ANY(?::text[]) AND expires>?', hashes, Date.now())).map(r => r.token_hash) : []);
    for (const stream of streams) {
      if (!alive.has(stream.tokenHash)) {
        stream.response.end();
        streams.delete(stream);
      } else stream.response.write(': ping\n\n');
    }
    const row = await database.one('SELECT value FROM event_clock WHERE id=1');
    if (row.value > lastBroadcastSeq) {
      goals.invalidate();
      lastBroadcastSeq = row.value;
      broadcast('seq', {
        seq: row.value
      });
    }
  } catch {
    console.error('实时连接检查暂时失败，将自动重试。');
  } finally {
    heartbeatBusy = false;
  }
}, 20000).unref();

const management = require('./lib/management.cjs').createManagement({
  db:database,goals,requireCondition,RequestError,can,canManageAccount,capabilities,
  hashPassword,verifyPassword,passwordValue,issueToken,digest,adminUser,bootstrapFor,
  audit,orgChanged,backupTo,backupDirectory,base:BASE,mode:MODE,revision,bumpRevision,today
});
// ---------- 接口 ----------
const failures = new Map();
function query(request) {
  return new URL(request.url, 'http://localhost').searchParams;
}
async function api(request, response, pathname) {
  const method = request.method;
  const mutation = !['GET', 'HEAD'].includes(method);
  if (mutation) {
    requireCondition((request.headers['content-type'] || '').startsWith('application/json'), '请求需要使用 JSON 格式。', 415);
    const expectedOrigin = process.env.PUBLIC_ORIGIN || `http://${request.headers.host}`;
    requireCondition(!request.headers.origin || request.headers.origin === expectedOrigin, '请求来源不匹配。', 403);
    requireCondition(request.headers['sec-fetch-site'] !== 'cross-site', '不接受跨站请求。', 403);
  }
  const session = await getSession(request);
  const user = session ? userById(session.user_id) : null;
  if (pathname === '/api/session' && method === 'GET') {
    return send(response, 200, {
      configured: readMeta('configured') === '1',
      authenticated: Boolean(user),
      demo: DEMO, mode: MODE, availableModes: options.availableModes || [MODE],
      ...(user ? {
        data: await bootstrapFor(user),
        csrf: session.csrf
      } : {})
    });
  }
  if (pathname === '/api/setup' && method === 'POST') {
    requireCondition(readMeta('configured') !== '1', '公司负责人账号已初始化，请直接登录。', 409);
    const body = await readBody(request);
    const name = requiredText(body.name, '负责人姓名', 30),
      phone = normalizedPhone(body.phone),
      password = passwordValue(body.password, requireCondition);
    requireCondition(setup.valid(body.setupToken), '初始化凭证无效或已过期，请向服务器管理员获取。', 403);
    await transaction(async () => {
      requireCondition(readMeta('configured') !== '1', '公司负责人账号已初始化，请直接登录。', 409);
      requireCondition(userById(1), '数据库缺少初始负责人记录，请检查数据目录。', 500);
      await database.run("UPDATE users SET name=?,phone=?,password_hash=?,role='owner',active=1,version=version+1 WHERE id=1", name, phone, await hashPassword(password));
      await writeMeta('configured', 1);
      await bumpRevision();
      await audit(1, 'account.initialize', 1);
      await goals.emit(1, 'org.changed', null, null, {
        action: 'account.initialize'
      });
    });
    (database.context().afterCommit ||= []).push(() => {if(setup.file)fs.rmSync(setup.file, {force:true});});
    afterCommit();
    return setSession(response, userById(1));
  }
  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(request);
    const phone = textValue(body.phone, 30).replace(/[\s-]/g, '').replace(/^\+86/, '');
    const rateKey = request.socket.remoteAddress + ':' + phone;
    const failure = failures.get(rateKey);
    if (failure && failure.count >= 5 && failure.until > Date.now()) throw new RequestError(429, '尝试次数过多，请 10 分钟后再试。');
    const candidate = await database.one('SELECT * FROM users WHERE phone = ? AND active=1', phone);
    const credentialMatches = await verifyPassword(body.password, candidate?.password_hash);
    if (!candidate || !credentialMatches) {
      failures.set(rateKey, {
        count: failure?.until > Date.now() ? failure.count + 1 : 1,
        until: Date.now() + 600000
      });
      if (failures.size > 2000) for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key);
      throw new RequestError(401, '手机号或密码不匹配，忘记密码请联系管理员。');
    }
    failures.delete(rateKey);
    await audit(candidate.id, 'account.login', candidate.id);
    return setSession(response, candidate);
  }
  if (pathname === '/api/account/activate' && method === 'POST') {
    const body=await readBody(request);
    const password=passwordValue(body.password,requireCondition);
    requireCondition(typeof body.token==='string' && /^[a-f0-9]{64}$/.test(body.token),'设置链接无效或已过期，请联系管理员重新生成。',400);
    const token=await database.one("SELECT * FROM account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>now() FOR UPDATE",digest(body.token));
    requireCondition(token && userById(token.user_id)?.active,'设置链接无效或已过期，请联系管理员重新生成。',400);
    await database.run('UPDATE account_tokens SET used_at=now() WHERE token_hash=?',token.token_hash);
    await database.run('UPDATE users SET password_hash=?,version=version+1 WHERE id=?',await hashPassword(password),token.user_id);
    await database.run('DELETE FROM sessions WHERE user_id=?',token.user_id);
    await audit(token.user_id,'account.password',token.user_id);
    await bumpRevision();await goals.emit(token.user_id,'org.changed',null,null,{action:'account.password'});
    await database.loadCommon();
    return send(response,200,{ok:true});
  }
  if (pathname === '/api/demo/personas' && method === 'GET') {
    requireCondition(DEMO, '接口不存在。', 404);
    const personas = JSON.parse(readMeta('demoPersonas') || '[]').map(persona => ({
      ...persona,
      name: userById(persona.userId)?.name || '',
      dept: departmentName(userById(persona.userId)?.department_id ?? null),
      title: userById(persona.userId)?.title || ''
    }));
    return send(response, 200, {
      personas,
      live: DEMO_LIVE
    });
  }
  if (pathname === '/api/demo/login' && method === 'POST') {
    requireCondition(DEMO, '接口不存在。', 404);
    const body = await readBody(request);
    const allowed = JSON.parse(readMeta('demoPersonas') || '[]').some(persona => persona.userId === Number(body.userId)) || body.any === true;
    const candidate = userById(body.userId);
    requireCondition(allowed && candidate && candidate.active, '演示身份不存在。', 404);
    return setSession(response, candidate);
  }
  requireCondition(user, '请先登录。', 401);
  if (mutation) requireCondition(request.headers['x-csrf-token'] === session.csrf, '登录验证已失效，请刷新后重试。', 403);

  // 写操作统一入口：事务 → 广播游标 → 可选地顺带返回调用者的增量
  const mutate = async fn => {
    const body = await readBody(request);
    const previousTeam = new Set(goals.teamOf(user.id).team);
    const result = await transaction(() => fn(body));
    if(user.role==='system_admin') requireCondition([...goals.teamOf(user.id).team].every(id=>previousTeam.has(id)), '此操作会扩大你本人的业务可见范围，请由公司负责人设置相关组织任命。',403);
    afterCommit();
    const payload = {
      ok: true,
      result
    };
    const since = request.headers['x-since'];
    if (since !== undefined && /^\d+$/.test(String(since))) payload.delta = await goals.delta(userById(user.id), Number(since));
    return send(response, 200, payload);
  };
  if (await management.handle({pathname,method,user,session,request,response,send,mutate,readBody})) return;
  if (pathname === '/api/logout' && method === 'POST') {
    await database.run('DELETE FROM sessions WHERE token_hash=?', session.token_hash);
    for (const stream of streams) if (stream.tokenHash === session.token_hash) {
      stream.response.end();
      streams.delete(stream);
    }
    return send(response, 200, {
      ok: true
    }, {
      'Set-Cookie': `${COOKIE}=; Path=${BASE || '/'}; HttpOnly; SameSite=Strict; Max-Age=0`
    });
  }
  if (pathname === '/api/bootstrap' && method === 'GET') return send(response, 200, {
    data: await bootstrapFor(user)
  });
  if (pathname === '/api/delta' && method === 'GET') return send(response, 200, await goals.delta(user, query(request).get('since')));
  if (pathname === '/api/stream' && method === 'GET') return openStream(request, response, session);
  if (pathname === '/api/events' && method === 'GET') {
    const params = query(request);
    return send(response, 200, await goals.eventsFor(user, {
      before: params.get('before'),
      limit: params.get('limit') || 30,
      goalId: params.get('goal') || null,
      subtree: params.get('subtree') === '1',
      filter: ['all', 'mine', 'team', 'help', 'new'].includes(params.get('filter')) ? params.get('filter') : 'all',
      personId: params.get('person') ? Number(params.get('person')) : null
    }));
  }
  if (pathname === '/api/archived' && method === 'GET') return send(response, 200, {
    items: await goals.archivedList(user)
  });
  if (pathname === '/api/checkins' && method === 'GET') return send(response, 200, await goals.myCheckins(user, {
    before: query(request).get('before')
  }));
  if (pathname === '/api/me/seen' && method === 'POST') {
    const body = await readBody(request);
    await goals.markSeen(user, body);
    return send(response, 200, {
      ok: true
    });
  }
  if (pathname === '/api/goals' && method === 'POST') return mutate(async body => await goals.createGoal(user, body));
  const goalMatch = pathname.match(/^\/api\/goals\/([A-Za-z0-9-]{1,80})(?:\/(split|join|done|archive|restore|checkins))?$/);
  if (goalMatch) {
    const [, id, action] = goalMatch;
    if (!action && method === 'GET') return send(response, 200, await goals.goalDetail(user, id));
    if (!action && method === 'PATCH') return mutate(async body => await goals.updateGoal(user, id, body));
    if (action && method === 'POST') {
      const handlers = {
        split: goals.splitGoal,
        join: goals.joinGoal,
        done: goals.setDone,
        archive: goals.archiveGoal,
        restore: async (u, goalId) => await goals.restoreGoal(u, goalId),
        checkins: goals.createCheckin
      };
      return mutate(body => handlers[action](user, id, body));
    }
  }
  const voidMatch = pathname.match(/^\/api\/checkins\/([A-Za-z0-9-]{1,80})\/void$/);
  if (voidMatch && method === 'POST') return mutate(async body => await goals.voidCheckin(user, voidMatch[1], body));
  const cheerMatch = pathname.match(/^\/api\/events\/(\d+)\/cheer$/);
  if (cheerMatch && method === 'POST') {
    await readBody(request);
    const result = await transaction(async () => await goals.toggleCheer(user, cheerMatch[1]));
    (database.context().afterCommit ||= []).push(() => broadcast('cheer', {
      seq: result.seq,
      count: result.count,
      by: user.id,
      actorId: result.actorId,
      on: result.cheered
    }));
    return send(response, 200, {
      ok: true,
      result
    });
  }
  if (pathname === '/api/settings' && method === 'GET') return send(response, 200, {
    settings: goals.settings()
  });
  if (pathname === '/api/settings' && method === 'PUT') return mutate(async body => {
    await goals.saveSettings(user, body);
    await audit(user.id, 'settings.update', JSON.stringify(body));
    return goals.settings();
  });
  if (pathname === '/api/admin/users' && method === 'GET') {
    requireCondition(can(user,'members.manage'),'没有成员管理权限。',403);
    const owned = user.role==='owner' ? await goals.ownedCounts() : new Map();
    return send(response, 200, {
      users: allUsers().map(member => adminUser(member, owned)),
      directoryInitialization: JSON.parse(readMeta('directoryInitialization') || 'null')
    });
  }
  const handoverMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/handover$/);
  if (handoverMatch && method === 'POST') {
    requireOwner(user);
    return mutate(async body => {
      const result = await goals.handoverGoals(user, Number(handoverMatch[1]), body);
      await bumpRevision();
      await audit(user.id, 'goal.handover', JSON.stringify({
        from: Number(handoverMatch[1]),
        to: Number(body.toId),
        count: result.count
      }));
      return result;
    });
  }
  if (pathname === '/api/admin/directory-managers' && method === 'POST') return mutate(async () => {
    const result = await goals.applyDirectoryManagers(user);
    await bumpRevision();
    await audit(user.id, 'directory.managers', result.changed);
    return result;
  });
  if (pathname === '/api/departments' && method === 'POST') {
    requireCondition(can(user,'organization.manage'),'没有组织管理权限。',403);
    return mutate(async body => {
      const name = requiredText(body.name, '部门名称', 40),
        parent = body.parentId ? Number(body.parentId) : null;
      if (parent) requireCondition(allDepartments().some(department => department.id === parent && department.parent_id === null), '二级部门只能归属到一级部门。');
      requireCondition(!allDepartments().some(department => department.parent_id === parent && department.name === name), '同一层级已存在同名部门。');
      if (body.managerId) requireCondition(userById(body.managerId)?.active, '请选择有效负责人。');
      const id = Number((await database.run('INSERT INTO departments(name,parent_id,manager_id) VALUES (?,?,?)', name, parent, body.managerId ? Number(body.managerId) : null)).id);
      await orgChanged(user, {
        action: 'department.create',
        subject: id
      });
      return {
        id
      };
    });
  }
  const departmentMatch = pathname.match(/^\/api\/departments\/(\d+)$/);
  if (departmentMatch && ['PUT', 'DELETE'].includes(method)) {
    requireCondition(can(user,'organization.manage'),'没有组织管理权限。',403);
    const id = Number(departmentMatch[1]);
    return mutate(async body => {
      const department = allDepartments().find(item => item.id === id);
      requireCondition(department, '部门不存在。', 404);
      requireCondition(Number(body.version)===department.version,'部门已被其他人修改，请重新载入。',409);
      if (method === 'DELETE') {
        requireCondition(!allDepartments().some(item => item.parent_id === id), '请先移动或删除该部门下的二级部门。', 409);
        requireCondition(!(await database.many('SELECT org_ids FROM goals')).some(row => JSON.parse(row.org_ids || '[]').includes(id)), '还有目标归属在这个组织下（含已归档目标），请先调整这些目标的归属组织。', 409);
        requireCondition(!allUsers().some(member => member.active && member.department_id === id), '请先调整该部门的成员归属，再删除部门。', 409);
        await database.run('UPDATE departments SET deleted=1,manager_id=NULL,version=version+1 WHERE id=?', id);
      } else {
        const name = requiredText(body.name, '部门名称', 40),
          parent = body.parentId ? Number(body.parentId) : null;
        if (parent) requireCondition(parent !== id && allDepartments().some(item => item.id === parent && item.parent_id === null), '请选择有效的一级上级部门。');
        if (parent) requireCondition(!allDepartments().some(item => item.parent_id === id), '拥有二级部门的一级部门不能降为二级。');
        requireCondition(!allDepartments().some(item => item.id !== id && item.name === name && item.parent_id === parent), '同一层级已存在同名部门。');
        if (body.managerId) requireCondition(userById(body.managerId)?.active, '请选择有效负责人。');
        await database.run('UPDATE departments SET name=?,parent_id=?,manager_id=?,version=version+1 WHERE id=?', name, parent, body.managerId ? Number(body.managerId) : null, id);
      }
      await orgChanged(user, {
        action: method === 'DELETE' ? 'department.delete' : 'department.update',
        subject: id
      });
      return {
        id
      };
    });
  }
  const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (pathname === '/api/users' && method === 'POST' || userMatch && ['PUT', 'DELETE'].includes(method)) {
    requireCondition(can(user,'members.manage'),'没有成员管理权限。',403);
    const id = userMatch ? Number(userMatch[1]) : null;
    return mutate(async body => {
      const existing = id ? userById(id) : null;
      if (id) {
        requireCondition(existing, '成员不存在。', 404);
        requireCondition(canManageAccount(user,existing),'不能管理此账号，请联系公司负责人。',403);
        requireCondition(Number(body.version)===existing.version,'成员信息已被修改，请重新载入。',409);
      }
      if (method === 'DELETE') {
        requireCondition(id !== user.id, '不能停用当前登录的公司负责人，请先由其他负责人操作。');
        requireCondition(existing.role !== 'owner' || allUsers().filter(member => member.active && member.role === 'owner').length > 1, '至少需要保留一位公司负责人。');
        await deactivate(id);
        await orgChanged(user, {
          action: 'user.delete',
          subject: id
        });
        return {
          id
        };
      }
      const name = body.name !== undefined ? requiredText(body.name, '成员姓名', 30) : existing?.name;
      requireCondition(name, '请填写成员姓名。');
      const phone = body.phone !== undefined && body.phone !== '' ? normalizedPhone(body.phone) : existing?.phone || null;
      requireCondition(phone || existing, '请填写成员手机号，作为登录账号。');
      const departmentId = body.departmentId !== undefined ? body.departmentId === null ? null : Number(body.departmentId) : existing ? existing.department_id : null;
      requireCondition(departmentId === null || allDepartments().some(department => department.id === departmentId), '请选择有效的所属部门。');
      const role = body.role ?? existing?.role ?? 'member';
      requireCondition(['owner','system_admin','member'].includes(role),'请选择有效角色。');
      requireCondition(role==='member' && (!existing || existing.role==='member') || can(user,'roles.assign'),'只有公司负责人可以任命管理角色。',403);
      const active = body.active !== undefined ? body.active !== false : existing ? Boolean(existing.active) : true;
      const title = body.title !== undefined ? textValue(body.title, 20) : existing?.title || '';
      const managerId = body.managerId !== undefined ? validManager(id, body.managerId) : existing?.manager_id ?? null;
      if (phone) requireCondition(!allUsers().some(member => member.id !== id && member.active && member.phone === phone), '该手机号已被其他在职成员使用。', 409);
      requireCondition(!existing || existing.role !== 'owner' || role === 'owner' && active || allUsers().some(member => member.id !== id && member.role === 'owner' && member.active), '至少需要保留一位公司负责人。');
      requireCondition(id !== user.id || active, '不能停用当前登录的账号。');
      requireCondition(body.lastFour===undefined && body.password===undefined,'请通过一次性设置链接配置密码。');
      let savedId = id;
      if (existing) {
        if (existing.active && !active) await deactivate(id);
        await database.run('UPDATE users SET name=?,phone=?,department_id=?,role=?,active=?,title=?,manager_id=?,version=version+1 WHERE id=?', name, phone, departmentId, role, active ? 1 : 0, title, active ? managerId : existing.manager_id, id);
        if (phone !== existing.phone || role !== existing.role || managerId !== existing.manager_id || departmentId !== existing.department_id || active !== Boolean(existing.active)) await database.run('DELETE FROM sessions WHERE user_id=?',id);
      } else {
        savedId = Number((await database.run('INSERT INTO users(name,phone,department_id,role,title,manager_id) VALUES (?,?,?,?,?,?)', name, phone, departmentId, role, title, managerId)).id);
      }
      await orgChanged(user, {
        action: existing ? 'user.update' : 'user.create',
        subject: savedId
      });
      return {
        id: savedId
      };
    });
  }
  throw new RequestError(404, '接口不存在。');
}

// ---------- 静态资源 ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) return null;
  if (decoded === '/' || decoded === '/index.html') return path.join(WEB, 'index.html');
  if (decoded === '/fonts/dm-sans-latin.woff2') return path.join(FONTS, 'dm-sans-latin.woff2');
  const brand = decoded.match(/^\/assets\/brand\/([a-z0-9-]+\.(?:webp|png|svg))$/);
  if (brand) return path.join(BRAND, brand[1]);
  const file = path.resolve(WEB, '.' + decoded);
  if (!file.startsWith(WEB + path.sep)) return null;
  return file;
}
const compressed = new Map();
const handle = async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      const write = !['GET', 'HEAD'].includes(request.method) || /^\/api\/admin\/backups\/[a-f0-9]+\/download$/.test(pathname);
      let lock = null;
      if (write) {
        if (request.method !== 'GET' && !(request.headers['content-type'] || '').startsWith('application/json')) throw new RequestError(415, '请求需要使用 JSON 格式。');
        const body = request.method === 'GET' ? {} : await readBody(request);
        if (/^\/api\/(users|departments|settings|setup|admin|account)/.test(pathname)) lock = 'organization';else {
          let target = pathname.match(/^\/api\/goals\/([^/]+)/)?.[1] || body.parentId;
          const checkin = pathname.match(/^\/api\/checkins\/([^/]+)\/void/);
          if (checkin) target = (await database.one('SELECT goal_id FROM checkins WHERE id=?', checkin[1]))?.goal_id;
          const event = pathname.match(/^\/api\/events\/(\d+)\/cheer/);
          if (event) target = (await database.one('SELECT goal_id FROM events WHERE seq=?', Number(event[1])))?.goal_id;
          if (target) {
            const row = await database.one('WITH RECURSIVE path AS (SELECT id,parent_id FROM goals WHERE id=? UNION ALL SELECT g.id,g.parent_id FROM goals g JOIN path p ON g.id=p.parent_id) SELECT id FROM path WHERE parent_id IS NULL', target);
            lock = 'tree:' + (row?.id || target);
          } else lock = 'account';
        }
      }
      response.buffered = true;
      await database.scope(async () => {
        await api(request, response, pathname);
        if (write) await database.notify();
      }, {
        write,
        lock,
        prepare: async () => await goals.prepareModel()
      });
      response.buffered = false;
      if (response.downloadFile) {
        const {
          file,
          name
        } = response.downloadFile;
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="backup.dump"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(file).pipe(response);
        return;
      }
      if (response.pending) {
        const {
          status,
          payload,
          extraHeaders
        } = response.pending;
        return send(response, status, payload, extraHeaders);
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) return send(response, 405, {
      error: '不支持的请求方式。'
    });
    const file = staticFile(pathname);
    const type = file && TYPES[path.extname(file)];
    if (!file || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(response, 404, {
      error: '页面不存在。'
    });
    const stat = fs.statSync(file);
    const etag = '"' + stat.size.toString(16) + '-' + Math.trunc(stat.mtimeMs).toString(16) + '"';
    const headers = {
      'Content-Type': type, ETag: etag, Vary: 'Accept-Encoding',
      'Cache-Control': pathname.startsWith('/static/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {})
    };
    if(request.headers['if-none-match'] === etag) { response.writeHead(304, headers); return response.end(); }
    let content = await fs.promises.readFile(file);
    if(content.length > 1024 && /javascript|text\/|json|svg/.test(type)) {
      const accept = request.headers['accept-encoding'] || '';
      const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
      if(encoding) {
        const key = file + ':' + etag + ':' + encoding;
        if(!compressed.has(key)) {
          if(compressed.size > 100)compressed.clear();
          const compress = require('node:util').promisify(encoding === 'br' ? zlib.brotliCompress : zlib.gzip);
          compressed.set(key, await compress(content, encoding === 'br' ? { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } } : {}));
        }
        content=compressed.get(key); headers['Content-Encoding']=encoding;
      }
    }
    headers['Content-Length']=content.length;
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.buffered = false;
    if (!error.status) console.error('请求执行失败：', error.code || error.name);
    if (!response.headersSent) send(response, error.status || 500, {
      error: error.status ? error.message : '服务暂时出错了，请稍后重试。'
    });
  }
};
let simulator = null;
if (DEMO_LIVE) simulator = require('./lib/demo.cjs').startSimulator({ db: database, goals, transaction, userById, today });
async function close() {
  simulator?.stop(); clearInterval(heartbeat); clearTimeout(presenceTimer);
  for (const stream of streams) stream.response.end();
  await stopListening(); await database.close();
}
return {handle, close, database, setupFile: setup.file};
} catch(error) {await database.close().catch(()=>{});throw error;}
}
module.exports = {createApplication};

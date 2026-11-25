'use strict';
// 测试公共工具：用临时数据目录启动一个真实的工作台进程，按“人”保存登录态调用接口。
// 所有测试都只用虚构的人和数字，不读取任何真实通讯录。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { temporarySchema, createDatabase } = require('../src/db/index.cjs');

const APP = path.resolve(__dirname, '..');

async function startServer({ env = {}, dataDir, legacyFixtures = true } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'guoqi-test-'));
  const isolation = env.DATABASE_SCHEMA ? null : await temporarySchema('test');
  if (!isolation && (!env.DATABASE_URL || !new URL(env.DATABASE_URL).pathname.endsWith('_test') || !/^test_[a-z0-9_]+$/.test(env.DATABASE_SCHEMA))) throw new Error('测试只能使用专用测试库和 test_ 隔离空间。');
  const database = createDatabase(isolation || { url: env.DATABASE_URL, schema: env.DATABASE_SCHEMA });
  const child = spawn(process.execPath, [path.join(APP, 'src', 'server.cjs')], {
    cwd: APP,
    env: { ...process.env, NODE_NO_WARNINGS: '1', PORT: '0', HOST: '127.0.0.1', DATABASE_URL: database.url, DATABASE_SCHEMA: database.schema, GUOQI_DATA_DIR: dir, GUOQI_DEMO: '0', GUOQI_DEMO_LIVE: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  let origin;
  try { origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('工作台 10 秒内没有启动：' + stderr)), 10000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/http:\/\/[\d.]+:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`工作台提前退出（${code}）：${stderr}`)); });
  });
  } catch (error) {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    await database.close();
    if (isolation) await isolation.cleanup();
    if (!dataDir) fs.rmSync(dir, { recursive:true, force:true });
    throw error;
  }
  const jar = {};
  async function rawCall(who, method, url, body, extra = {}) {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who].cookie, 'X-CSRF-Token': jar[who].csrf } : {}), ...extra };
    const response = await fetch(origin + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const cookie = response.headers.get('set-cookie');
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    if (cookie && json?.csrf) jar[who] = { cookie: cookie.split(';')[0], csrf: json.csrf };
    return { status: response.status, json, headers: response.headers, text };
  }
  // 旧目标领域用例的虚构凭据/部门转为新版账号流程；新协议用例使用 rawCall。
  async function call(who, method, url, body, extra={}) {
    if(!legacyFixtures)return rawCall(who,method,url,body,extra);
    const oldSecret=body?.lastFour;
    body=body?{...body}:body;
    if(oldSecret!==undefined){delete body.lastFour;if(url==='/api/setup'||url==='/api/login')body.password='虚构测试密码-'+oldSecret.toUpperCase();}
    if(url==='/api/setup' && method==='POST')body.setupToken=fs.existsSync(path.join(dir,'setup-token.json'))?JSON.parse(fs.readFileSync(path.join(dir,'setup-token.json'),'utf8')).token:'已初始化';
    if(/^\/api\/(users|departments)\/\d+$/.test(url) && ['PUT','DELETE'].includes(method) && body?.version===undefined) {
      const table=url.includes('/users/')?'users':'departments';const row=await database.one('SELECT version FROM '+table+' WHERE id=?',Number(url.split('/').at(-1)));
      body={...body,version:row?.version};
    }
    const result=await rawCall(who,method,url,body,extra);
    if(result.status!==200)return result;
    if(url==='/api/setup' && method==='POST') {
      const names=[['内容业务',null],['成片方向',1],['AIGC方向',1],['创意方向',1],['解决方案',null],['TOKEN业务',5],['BPO业务',5],['管理咨询',5],['品牌经营',5],['营销与销售',null],['KA-LA客户',10],['SMB客户',10],['AIE',null],['FDE',13],['AI应用',13],['AI Core',13],['财务及人力中心',null],['财务分析',17],['财务管理',17],['招聘',17],['绩效',17]];
      for(const [name,parentId] of names)ok(await rawCall(who,'POST','/api/departments',{name,parentId}));
      result.json.data=(await rawCall(who,'GET','/api/bootstrap')).json.data;
    }
    if(oldSecret!==undefined && /^\/api\/users(?:\/\d+)?$/.test(url) && ['POST','PUT'].includes(method)) {
      const userId=result.json.result.id;
      const issued=ok(await rawCall(who,'POST','/api/admin/users/'+userId+'/activation',{}));
      const token=new URLSearchParams(issued.result.path.split('?')[1]).get('token');
      ok(await rawCall('__activate','POST','/api/account/activate',{token,password:'虚构测试密码-'+oldSecret.toUpperCase()}));
    }
    return result;
  }
  async function stop() {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    await database.close();
    if (isolation) await isolation.cleanup();
    if (!dataDir) fs.rmSync(dir, { recursive: true, force: true });
  }
  const serverErrors = () => stderr.split('\n').filter(line => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line)).join('\n');
  return { origin, call, rawCall, jar, stop, dir, database, stdout: () => stdout, serverErrors };
}

// 断言接口成功并返回 json，失败时把服务端的中文提示带出来
function ok(response, label = '') {
  if (response.status !== 200) throw new Error(`${label} 期望 200，实际 ${response.status}：${response.json?.error || response.text}`);
  return response.json;
}

// 依次运行测试用例，输出简洁的中文结果
async function run(title, cases) {
  const started = Date.now();
  let passed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (error) { console.log(`  ✗ ${name}`); console.error(error); process.exitCode = 1; return false; }
  }
  console.log(`${title}：${passed}/${cases.length} 通过（${Date.now() - started} ms）`);
  return true;
}

module.exports = { APP, startServer, ok, run };

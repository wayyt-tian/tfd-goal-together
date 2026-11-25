'use strict';
// 一键启动演示环境：每次都用一个全新的临时数据目录，装入 63 位虚构成员和他们的目标、进展，绝不碰正式数据。
// 用法：
//   npm run demo                      演示数据（静态）
//   npm run demo:live                 演示数据 + 每 20–40 秒自动出现一条虚构动态，用来体验“实时感”
//   node scripts/start-demo.cjs --open               启动后自动用默认浏览器打开
//   node scripts/start-demo.cjs --port=5000 --keep   指定端口（默认 4180，避开正式工作台的 4173）；退出后保留临时数据目录
//   node scripts/start-demo.cjs --check              启动 → 检查四个演示身份都能进入 → 退出（用于交付验收）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { temporarySchema } = require('../src/db/index.cjs');
(async () => {
const isolation = await temporarySchema('demo');
const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const live = flag('live');
const check = flag('check');
const keep = flag('keep');
const open = flag('open');
const port = option('port') ?? (check ? '0' : process.env.PORT || '4180');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guoqi-demo-'));

const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.cjs')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, NODE_NO_WARNINGS: '1', DATABASE_URL: isolation.url, DATABASE_SCHEMA: isolation.schema, GUOQI_DATA_DIR: dataDir, GUOQI_DEMO: '1', GUOQI_DUAL: '0', GUOQI_DEMO_LIVE: live ? '1' : '0', PORT: port, HOST: process.env.HOST || '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
const cleanup = () => { if (!keep) fs.rmSync(dataDir, { recursive: true, force: true }); };
child.stderr.on('data', chunk => {
  const text = String(chunk).split('\n').filter(line => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line)).join('\n');
  if (text) process.stderr.write(text + '\n');
});
child.on('exit', async code => {
  if (!keep) await isolation.cleanup();
  cleanup();
  if (!check) console.log(keep ? `演示已停止，数据保留在 ${dataDir}` : '演示已停止，临时数据已清除。');
  process.exit(process.exitCode || code || 0);
});
const stop = () => { if (child.exitCode === null) child.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

child.stdout.on('data', async chunk => {
  output += chunk;
  if (!check) process.stdout.write(chunk);
  const match = output.match(/http:\/\/[\w.]+:\d+/);
  if (!match || child.started) return;
  child.started = true;
  if (!check) {
    console.log('\n用浏览器打开上面的地址，在登录页选择一个演示身份即可进入（全部为虚构数据）。');
    console.log('建议顺序：公司负责人 → 业务负责人 → 一线成员 → 新同事。按 Ctrl+C 结束演示。\n');
    if (open) {
      const [command, ...rest] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open'];
      spawn(command, [...rest, match[0]], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
    return;
  }
  try {
    const origin = match[0];
    const personas = (await (await fetch(origin + '/api/demo/personas')).json()).personas;
    if (personas.length !== 4) throw new Error('演示身份数量不对：' + personas.length);
    const lines = [];
    for (const persona of personas) {
      const response = await fetch(origin + '/api/demo/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: persona.userId }) });
      const { data } = await response.json();
      if (response.status !== 200) throw new Error(persona.label + ' 无法进入');
      const cookie = response.headers.get('set-cookie').split(';')[0];
      const page = await fetch(origin + '/', { headers: { Cookie: cookie } });
      if (page.status !== 200) throw new Error('首页打不开');
      lines.push(`  ${persona.label}（${persona.name}）：${data.goals.filter(goal => !goal.context).length} 个相关目标，${data.access.teamIds.length} 位团队成员`);
    }
    console.log(`PASS 演示环境可以启动，4 个演示身份都能进入：\n${lines.join('\n')}`);
    stop();
  } catch (error) {
    console.error('演示检查失败：' + error.message);
    process.exitCode = 1;
    stop();
  }
});

})().catch(error => { console.error('演示启动失败：' + error.message); process.exitCode = 1; });

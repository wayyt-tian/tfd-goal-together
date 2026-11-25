'use strict';
// 交付包启动冒烟：用全新的临时数据目录启动正式模式（非演示），检查首次使用状态、页面引用的全部静态资源、
// 品牌图片、私有文件不可访问；再用演示模式检查四个演示身份。不会读写任何正式数据。
// 用法：node tools/smoke-start.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const { temporarySchema } = require('../src/db/index.cjs');
const APP = path.resolve(__dirname, '..');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guoqi-delivery-smoke-'));
  let child;
  const isolation = await temporarySchema('test');
  try {
    child = spawn(process.execPath, [path.join(APP, 'src', 'server.cjs')], { cwd: directory, env: { ...process.env, NODE_NO_WARNINGS: '1', HOST: '127.0.0.1', PORT: '0', DATABASE_URL: isolation.url, DATABASE_SCHEMA: isolation.schema, GUOQI_DATA_DIR: directory, GUOQI_DEMO: '0', PUBLIC_ORIGIN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('启动超时：' + stderr)), 15000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`工作台退出（${code}）：${stderr}`)); });
      child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
    const session = await (await fetch(origin + '/api/session')).json();
    assert.deepEqual(session, { configured: false, authenticated: false, demo: false, mode:'formal',availableModes:['formal'] });
    assert.equal((await fetch(origin + '/api/bootstrap')).status, 401);
    assert.equal((await fetch(origin + '/api/demo/personas')).status, 404, '正式模式下没有演示入口');

    const html = await (await fetch(origin + '/')).text();
    assert.match(html, /src="\/static\/[^"]+\.js"/);
    const resources = new Set([...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map(match => match[1]));
    // 前端脚本和样式里用到的品牌图、模块
    for (const file of walk(path.join(APP, 'web', 'dist')).filter(file => /\.(js|css)$/.test(file))) {
      resources.add('/' + path.relative(path.join(APP, 'web', 'dist'), file).split(path.sep).join('/'));
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/\/assets\/brand\/[a-z0-9-]+\.(?:webp|png|svg)/g)) resources.add(match[0]);
    }
    resources.add('/fonts/dm-sans-latin.woff2');
    for (const resource of resources) {
      const response = await fetch(origin + resource);
      assert.equal(response.status, 200, resource);
      const type = response.headers.get('content-type');
      if (resource.endsWith('.js')) assert.ok(type.startsWith('application/javascript'), resource);
      if (resource.endsWith('.css')) assert.ok(type.startsWith('text/css'), resource);
    }
    for (const resource of ['/src/server.cjs', '/src/paths.cjs', '/src/lib/goals.cjs', '/docs/examples/api-examples.json', '/tests/test-helpers.cjs', '/tools/update-manifest.cjs', '/manifest.json', '/server.cjs', '/lib/goals.cjs', '/lib/demo.cjs', '/package.json', '/.data/workbench.sqlite', '/scripts/import-contacts.cjs', '/assets/brand/source/guoqi-ip-original.svg', '/%2e%2e/server.cjs']) {
      assert.equal((await fetch(origin + resource)).status, 404, resource);
    }
    const brand = [...resources].filter(item => item.startsWith('/assets/brand/'));
    console.log(`PASS 正式模式首次启动：未初始化状态正确，${resources.size} 个静态资源（含 ${brand.length} 张品牌图）可访问，私有文件均不可访问。`);

    const demo = spawnSync(process.execPath, [path.join(APP, 'scripts', 'start-demo.cjs'), '--check'], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert.equal(demo.status, 0, demo.stderr);
    process.stdout.write(demo.stdout);
    console.log(JSON.stringify({ node: process.version, isolatedData: true, realWorkspaceTouched: false }));
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
    await isolation.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

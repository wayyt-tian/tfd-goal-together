'use strict';
// 安全与静态资源：源码、数据目录、品牌原始文件不对外；写操作必须是同源 JSON 且带登录校验码；页面带内容安全策略。
const assert = require('node:assert/strict');
const { startServer, ok, run } = require('./test-helpers.cjs');

(async () => {
  const s = await startServer({ env: { GUOQI_TODAY: '2026-11-24' } });
  const { call, origin } = s;
  const raw = (url, init = {}) => fetch(origin + url, init);
  try {
    await run('安全与静态资源', [
      ['页面、脚本、字体和品牌图可以访问', async () => {
        const page = await raw('/');
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
        assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(page.headers.get('x-frame-options'), 'DENY');
        const html = await page.text();
        assert.match(html, /锅气家族/);
        for (const [url, type] of [[html.match(/src="(\/static\/[^"]+\.js)"/)[1], 'application/javascript'], [html.match(/href="(\/static\/[^"]+\.css)"/)[1], 'text/css'], ['/fonts/dm-sans-latin.woff2', 'font/woff2'], ['/assets/brand/guoqi-logo.webp', 'image/webp'], ['/assets/brand/ip-happy.webp', 'image/webp'], ['/assets/brand/guoqi-mark.png', 'image/png']]) {
          const response = await raw(url);
          assert.equal(response.status, 200, url);
          assert.ok(response.headers.get('content-type').startsWith(type), url);
        }
        const referenced = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(match => match[1]);
        assert.ok(referenced.length >= 3);
        for (const url of referenced) assert.equal((await raw(url)).status, 200, '页面引用的资源要存在：' + url);
      }],
      ['源码、数据、品牌原始文件和越级路径一律 404', async () => {
        for (const url of ['/js/main.js', '/js/main.jsx', '/css/app.css', '/.env', '/src/server.cjs', '/src/paths.cjs', '/src/lib/goals.cjs', '/src/lib/legacy-v02-demo.json', '/docs/examples/api-examples.json', '/docs/00_先读我.md', '/tests/test-helpers.cjs', '/tools/update-manifest.cjs', '/manifest.json', '/assets/fonts/OFL-DM-Sans.txt', '/assets/licenses/LICENSE-lucide.txt']) {
          assert.equal((await raw(url)).status, 404, url);
        }
        for (const url of ['/server.cjs', '/lib/goals.cjs', '/package.json', '/.data/workbench.sqlite', '/.gitignore', '/../server.cjs', '/%2e%2e/server.cjs', '/js/%2e%2e/%2e%2e/server.cjs', '/assets/brand/source/guoqi-ip-original.svg', '/assets/brand/README.md', '/assets/brand/%2e%2e/%2e%2e/server.cjs', '/scripts/import-contacts.cjs', '/js/%00main.js', '/%E0%A4%A']) {
          const response = await raw(url);
          assert.equal(response.status, 404, url);
        }
        assert.equal((await raw('/js/main.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
      }],
      ['写操作要求 JSON、同源和登录校验码', async () => {
        assert.equal((await raw('/api/setup', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
        assert.equal((await raw('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
        assert.equal((await raw('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status, 403);
        ok(await call('owner', 'POST', '/api/setup', { name: '测试负责人', phone: '13900000001', lastFour: '1111' }));
        const cookie = s.jar.owner.cookie;
        const body = JSON.stringify({ scope: 'company', kind: 'action', title: '无校验码', startDate: '2026-11-01', endDate: '2026-11-30' });
        assert.equal((await raw('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body })).status, 403);
        assert.equal((await raw('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': 'x'.repeat(48) }, body })).status, 403);
        ok(await call('owner', 'POST', '/api/goals', JSON.parse(body)));
        const bad = await raw('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': s.jar.owner.csrf }, body: '{坏的' });
        assert.equal(bad.status, 400);
      }],
      ['会话 Cookie 为 HttpOnly + SameSite=Strict，退出后失效', async () => {
        const response = await raw('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '13900000001', password: '虚构测试密码-1111' }) });
        const cookie = response.headers.get('set-cookie');
        assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
        const { csrf } = await response.json();
        const session = cookie.split(';')[0];
        assert.equal((await raw('/api/bootstrap', { headers: { Cookie: session } })).status, 200);
        assert.equal((await raw('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session, 'X-CSRF-Token': csrf }, body: '{}' })).status, 200);
        assert.equal((await raw('/api/bootstrap', { headers: { Cookie: session } })).status, 401);
        assert.equal((await raw('/api/bootstrap', { headers: { Cookie: 'guoqi_session=' + 'a'.repeat(64) } })).status, 401);
      }],
      ['连续输错 5 次后暂时锁定', async () => {
        for (let i = 0; i < 5; i++) assert.equal((await call('guess', 'POST', '/api/login', { phone: '13900000001', name: '测试负责人', lastFour: '000' + i })).status, 401);
        assert.equal((await call('guess', 'POST', '/api/login', { phone: '13900000001', name: '测试负责人', lastFour: '1111' })).status, 429);
      }],
      ['未开启演示模式时演示接口不存在；未登录拿不到数据', async () => {
        assert.equal((await call('anon', 'GET', '/api/demo/personas')).status, 404);
        assert.equal((await call('anon', 'POST', '/api/demo/login', { userId: 1 })).status, 404);
        for (const url of ['/api/bootstrap', '/api/events', '/api/delta?since=0', '/api/stream', '/api/admin/backup']) assert.equal((await call('anon', 'GET', url)).status, 401, url);
        assert.equal((await call('anon', 'GET', '/api/nope')).status, 401);
      }],
      ['负责人可以下载数据备份', async () => {
        const created=ok(await call('owner','POST','/api/admin/backups',{})).result;
        const response = await raw('/api/admin/backups/'+created.id+'/download', { headers: { Cookie: s.jar.owner.cookie } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/octet-stream');
        assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8/);
        assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), 'PGDMP');
      }]
    ]);
    const errors = s.serverErrors();
    if (errors) { console.error('服务端输出了错误：\n' + errors); process.exitCode = 1; }
  } finally { await s.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

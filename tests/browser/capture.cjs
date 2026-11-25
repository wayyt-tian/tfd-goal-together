'use strict';
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '../..');
async function capture({ origin, output }) {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const personas = (await (await fetch(origin + '/api/demo/personas')).json()).personas;
  let count = 0;
  try {
    for (const width of [1366, 1440, 390]) {
      for (let role = 0; role < personas.length; role++) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.setFixedTime(new Date('2026-11-25T02:00:00Z'));
        await page.goto(origin);
        await page.waitForSelector('.personas');
        if (!role) await page.screenshot({ path: path.join(output, `${width}-auth.png`), animations: 'disabled', fullPage: true });
        const response = await context.request.post(origin + '/api/demo/login', { data: { userId: personas[role].userId } });
        const { data } = await response.json();
        const goal = data.goals.find(g => g.perms.checkin && g.kind === 'measure' && !g.parentId) || data.goals.find(g => g.perms.checkin && g.kind === 'measure') || data.goals.find(g => !g.context);
        const routes = [['home','#/'],['map','#/map'],['pulse','#/pulse'],['person',`#/p/${data.me.id}`],['records','#/me/records'],['goal-path',`#/g/${goal.id}/path`],['goal-people',`#/g/${goal.id}/people`],['goal-feed',`#/g/${goal.id}/feed`]];
        if (data.access.role !== 'member') routes.push(['team','#/team']);
        if (!role) for (const tab of ['members','org','rules','archived','data']) routes.push([`admin-${tab}`,`#/admin/${tab}`]);
        await page.reload();
        for (const [name, hash] of routes) {
          await page.goto(origin + '/' + hash);
          await page.waitForSelector('.page');
          await page.waitForTimeout(500);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: path.join(output, `${width}-${role}-${name}.png`), animations:'disabled', fullPage:true });
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errors.push(`${width}/${role}/${name} 横向溢出`);
          count++;
        }
        await page.goto(origin + '/#/'); await page.waitForSelector('.page');
        for (const [name, selector] of [['new','button[data-act="new-goal"]'],['checkin','button[data-act="checkin"]']]) {
          const button = page.locator(selector + ':visible').first();
          if (!await button.count()) continue;
          await button.click(); await page.waitForSelector('dialog[open]'); await page.waitForTimeout(200);
          await page.screenshot({ path: path.join(output, `${width}-${role}-sheet-${name}.png`), animations:'disabled',fullPage:true });
          await page.keyboard.press('Escape'); await page.waitForTimeout(220); count++;
        }
        await context.close();
      }
    }
  } finally { await browser.close(); }
  if (errors.length) throw new Error(errors.join('\n'));
  return { count, errors };
}
module.exports = { capture };
if (require.main === module) {
  const legacy = process.argv.includes('--baseline');
  (async () => {
    let child, dir;
    try {
      let origin = process.env.VISUAL_ORIGIN;
      if (legacy) {
        dir = fs.mkdtempSync('/tmp/goal-visual-legacy-');
        const baseline = fs.readFileSync('/tmp/goal-together-pg-react-baseline','utf8');
        child = spawn(process.execPath, ['--require',path.join(root,'tests/fixed-clock.cjs'),path.join(baseline,'src/server.cjs')], { env:{...process.env,GUOQI_DATA_DIR:dir,GUOQI_DEMO:'1',GUOQI_TODAY:'2026-11-25',GUOQI_NOW:'2026-11-25T02:00:00Z',HOST:'127.0.0.1',PORT:'0',NODE_NO_WARNINGS:'1'},stdio:['ignore','pipe','pipe'] });
        origin = await new Promise((resolve,reject)=>{ let text=''; child.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);}); child.once('exit', code=>reject(new Error('基线服务退出：'+code))); });
      }
      const output = legacy ? '/tmp/goal-together-visual-baseline' : '/tmp/goal-together-visual-react';
      console.log(JSON.stringify(await capture({origin,output})));
    } finally {
      if(child && child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}
      if(dir)fs.rmSync(dir,{recursive:true,force:true});
    }
  })().catch(e=>{console.error(e);process.exitCode=1;});
}

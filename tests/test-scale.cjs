'use strict';
// 规模：在虚构演示数据（63 人）基础上再加 17 位虚构成员凑满 80 人，检查数据量和每个人看到的范围；顺序功能样本，不是负载测试。
// 目标是 50–80 人时，第一次用的人打开首页也不会被大量信息淹没。
const assert = require('node:assert/strict');
const { startServer, ok, run } = require('./test-helpers.cjs');

const LIMITS = { ownerBytes: 1_500_000, memberBytes: 400_000 };

(async () => {
  const s = await startServer({ env: { GUOQI_TODAY: '2026-11-24', GUOQI_DEMO: '1' } });
  const { call } = s;
  const report = [];
  const timed = async (who, url) => {
    const started = performance.now();
    const response = await call(who, 'GET', url);
    return { ms: performance.now() - started, bytes: Buffer.byteLength(response.text), json: ok(response, url) };
  };
  let personas, owner, extra = [];
  try {
    await run('80 人规模', [
      ['演示数据：63 位虚构成员、4 个演示身份', async () => {
        personas = ok(await call('anon', 'GET', '/api/demo/personas')).personas;
        assert.deepEqual(personas.map(p => p.label), ['公司负责人', '业务负责人', '一线成员', '新同事']);
        owner = personas[0];
        const data = ok(await call('owner', 'POST', '/api/demo/login', { userId: owner.userId })).data;
        assert.equal(data.access.role, 'admin');
        assert.equal(data.people.filter(p => p.active).length, 63);
      }],
      ['补 17 位虚构成员到 80 人，并把一项公司目标拆给他们', async () => {
        const data = ok(await call('owner', 'GET', '/api/bootstrap')).data;
        const lead = data.people.find(p => p.id === personas[1].userId);
        for (let i = 0; i < 17; i++) {
          const id = ok(await call('owner', 'POST', '/api/users', { name: `规模测试${String(i + 1).padStart(2, '0')}`, phone: `1370000${String(1000 + i)}`, lastFour: '1234', departmentId: lead.departmentId, managerId: lead.id }), '新建成员').result.id;
          extra.push(id);
        }
        const fresh = ok(await call('owner', 'GET', '/api/bootstrap')).data;
        assert.equal(fresh.people.filter(p => p.active).length, 80);
        const root = fresh.goals.find(goal => !goal.parentId && goal.scope === 'company' && goal.kind === 'measure' && goal.perms.child);
        ok(await call('owner', 'POST', `/api/goals/${root.id}/split`, { items: extra.map(ownerId => ({ ownerId, target: 1 })) }), '拆给 17 人');
        for (const id of extra.slice(0, 5)) {
          ok(await call('x' + id, 'POST', '/api/demo/login', { userId: id, any: true }));
          const mine = ok(await call('x' + id, 'GET', '/api/bootstrap')).data.goals.find(goal => goal.ownerId === id && goal.perms.checkin);
          ok(await call('x' + id, 'POST', `/api/goals/${mine.id}/checkins`, { value: 0.5, note: '规模测试的一笔' }));
        }
      }],
      ['每个演示身份的首屏数据：大小受控、只含相关内容', async () => {
        for (const persona of personas) {
          const who = 'p' + persona.userId;
          ok(await call(who, 'POST', '/api/demo/login', { userId: persona.userId }));
          const first = await timed(who, '/api/bootstrap'); // 登录后的第一次加载：这个人的可见范围是现算的
          const { ms, bytes } = first;
          const data = first.json.data;
          const own = data.goals.filter(goal => !goal.context).length;
          const context = data.goals.length - own;
          report.push({ 身份: persona.label, 角色: data.access.role, 可见目标: own, 上下文: context, 团队人数: data.access.teamIds.length, 首屏KB: Math.round(bytes / 1024), 耗时ms: Math.round(ms) });
          assert.ok(bytes < (data.access.role === 'admin' ? LIMITS.ownerBytes : LIMITS.memberBytes), `${persona.label} 首屏 ${bytes} 字节`);
        }
        const [admin, lead, member, newcomer] = report;
        assert.equal(admin.角色, 'admin'); assert.equal(lead.角色, 'lead'); assert.equal(member.角色, 'member');
        assert.ok(lead.可见目标 < admin.可见目标 && member.可见目标 < lead.可见目标, '越往下看到的越聚焦');
        assert.ok(lead.团队人数 >= 10, '业务负责人能看到整个团队');
        assert.ok(newcomer.可见目标 <= 12, '新同事第一次进来只看到少量和自己相关的目标');
      }],
      ['抽查 20 位成员：看到的每一项都和自己或团队有关', async () => {
        const all = ok(await call('owner', 'GET', '/api/bootstrap')).data;
        const byId = new Map(all.goals.map(goal => [goal.id, goal]));
        const sample = all.people.filter(p => p.active && !p.admin).filter((_, index) => index % 4 === 0).slice(0, 20);
        assert.equal(sample.length, 20);
        for (const person of sample) {
          const who = 's' + person.id;
          ok(await call(who, 'POST', '/api/demo/login', { userId: person.id, any: true }));
          const data = ok(await call(who, 'GET', '/api/bootstrap')).data;
          const team = new Set([person.id, ...data.access.teamIds]);
          const visible = new Map(data.goals.map(goal => [goal.id, goal]));
          const involved = goal => team.has(goal.ownerId) || goal.memberIds.some(id => team.has(id));
          for (const goal of data.goals) {
            if (goal.context) { assert.ok(all.goals.some(child => child.parentId === goal.id), '上下文目标必须是某个可见目标的上层'); continue; }
            let cursor = goal, related = false;
            while (cursor && !related) { related = involved(cursor); cursor = cursor.parentId ? byId.get(cursor.parentId) : null; }
            assert.ok(related, `${person.name} 看到了无关目标：${goal.title}`);
            if (goal.parentId) assert.ok(visible.has(goal.parentId), '可见目标的上层路径也要可见（作为上下文）');
          }
          const own = data.goals.find(goal => goal.ownerId === person.id && goal.perms.checkin);
          if (own) assert.equal((await call(who, 'GET', '/api/goals/' + own.id)).status, 200);
        }
      }],
      ['动态流、增量和目标详情的功能', async () => {
        const events = await timed('owner', '/api/events?limit=30');
        assert.equal(events.json.items.length, 30);
        const mine = await timed('p' + personas[2].userId, '/api/events?filter=mine');
        const seq = ok(await call('owner', 'GET', '/api/bootstrap')).data.seq;
        const share = ok(await call('x' + extra[0], 'GET', '/api/bootstrap')).data.goals.find(goal => goal.ownerId === extra[0] && goal.perms.checkin);
        ok(await call('x' + extra[0], 'POST', `/api/goals/${share.id}/checkins`, { value: 0.2, note: '又一笔' }));
        const delta = await timed('owner', '/api/delta?since=' + seq);
        assert.ok(delta.json.goals.length >= 2 && delta.json.goals.length < 10, '一次更新只带回这条路径上的几个目标');
        const roots = ok(await call('owner', 'GET', '/api/bootstrap')).data.goals.filter(goal => !goal.parentId && goal.scope === 'company');
        for (const root of roots) {
          const detail = await timed('owner', '/api/goals/' + root.id);
          assert.ok(detail.json.contributions.length <= 80);
        }
        report.push({ 身份: '动态 30 条', 耗时ms: Math.round(events.ms) }, { 身份: '增量', 耗时ms: Math.round(delta.ms), 目标数: delta.json.goals.length });
      }]
    ]);
    console.table(report);
    const errors = s.serverErrors();
    if (errors) { console.error('服务端输出了错误：\n' + errors); process.exitCode = 1; }
  } finally { await s.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

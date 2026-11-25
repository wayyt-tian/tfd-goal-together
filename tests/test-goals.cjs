'use strict';
// 目标主流程：汇总口径、可见范围、权限边界、进展记录与撤回、拆解、完成/重开、归档/恢复、增量同步、实时推送、点赞。
// 全部用虚构成员，库是临时目录，跑完即删。
const assert = require('node:assert/strict');
const { startServer, ok, run } = require('./test-helpers.cjs');

(async () => {
  const s = await startServer({ env: { GUOQI_TODAY: '2026-11-24' } });
  const { call } = s;
  const ids = {};
  const boot = async who => ok(await call(who, 'GET', '/api/bootstrap'), who + ' 引导数据').data;
  const goalOf = async (who, id) => ok(await call(who, 'GET', '/api/goals/' + id), who + ' 目标详情');
  const titles = data => data.goals.map(goal => goal.title + (goal.context ? '（上下文）' : '')).sort();
  try {
    await run('目标主流程', [
      ['空库初始化公司负责人', async () => {
        const session = ok(await call('owner', 'GET', '/api/session'));
        assert.equal(session.configured, false);
        const data = ok(await call('owner', 'POST', '/api/setup', { name: '测试负责人', phone: '13900000001', lastFour: '1111' }), '初始化').data;
        assert.equal(data.access.role, 'admin');
        assert.equal(data.departments.length, 21);
        assert.equal((await call('x', 'POST', '/api/setup', { name: '再来一次', phone: '13900000009', lastFour: '9999' })).status, 409);
      }],
      ['建成员与汇报关系，拒绝循环汇报', async () => {
        const add = async (key, body) => { ids[key] = ok(await call('owner', 'POST', '/api/users', body), '新建 ' + body.name).result.id; };
        await add('lead', { name: '虚构组长', phone: '13900000002', lastFour: '2222', departmentId: 2, title: '组长' });
        await add('member', { name: '虚构组员', phone: '13900000003', lastFour: '3333', departmentId: 2, managerId: ids.lead });
        await add('other', { name: '虚构同事', phone: '13900000004', lastFour: '4444', departmentId: 6 });
        await add('stranger', { name: '虚构路人', phone: '13900000005', lastFour: '5555', departmentId: 4 });
        const cycle = await call('owner', 'PUT', '/api/users/' + ids.lead, { managerId: ids.member });
        assert.equal(cycle.status, 400); assert.match(cycle.json.error, /循环汇报/);
        assert.equal((await call('owner', 'PUT', '/api/users/' + ids.lead, { managerId: ids.lead })).status, 400);
        assert.equal((await call('owner', 'POST', '/api/users', { name: '撞号', phone: '13900000002', lastFour: '1234' })).status, 409);
        for (const [key, phone, name, lastFour] of [['lead', '13900000002', '虚构组长', '2222'], ['member', '13900000003', '虚构组员', '3333'], ['other', '13900000004', '虚构同事', '4444'], ['stranger', '13900000005', '虚构路人', '5555']]) {
          ok(await call(key, 'POST', '/api/login', { phone, name, lastFour }), key + ' 登录');
        }
        assert.equal((await call('bad', 'POST', '/api/login', { phone: '13900000003', name: '虚构组员', lastFour: '0000' })).status, 401);
      }],
      ['公司目标只能由负责人创建', async () => {
        const body = { scope: 'company', kind: 'measure', title: '月度成交额', unit: '万元', target: 1000, startDate: '2026-11-01', endDate: '2026-11-30' };
        assert.equal((await call('member', 'POST', '/api/goals', body)).status, 403);
        ids.root = ok(await call('owner', 'POST', '/api/goals', body), '建公司目标').result.id;
        const bad = await call('owner', 'POST', '/api/goals', { ...body, endDate: '2026-10-01' });
        assert.equal(bad.status, 400);
      }],
      ['拆给成员，并通过 X-Since 顺带拿到增量', async () => {
        const since = ok(await call('owner', 'GET', '/api/delta?since=0')).seq;
        const response = ok(await call('owner', 'POST', `/api/goals/${ids.root}/split`, { items: [{ ownerId: ids.lead, target: 600, title: '自营渠道成交额' }, { ownerId: ids.member, target: 300 }] }, { 'X-Since': String(since) }), '拆解');
        [ids.leadShare, ids.memberShare] = response.result.ids;
        assert.equal(response.delta.reload, false);
        assert.ok(response.delta.goals.some(goal => goal.id === ids.root));
        assert.equal(response.delta.goals.length, 3);
        const twice = await call('owner', 'POST', `/api/goals/${ids.root}/split`, { items: [{ ownerId: ids.lead, target: 1 }] });
        assert.equal(twice.status, 400, '同一人默认不能在同一目标下拿第二份');
      }],
      ['可见范围：本人、汇报线上级、上下文祖先、无关的人', async () => {
        const member = await boot('member');
        assert.equal(member.access.role, 'member');
        assert.deepEqual(titles(member), ['月度成交额（上下文）', '虚构组员 · 月度成交额'].sort());
        const lead = await boot('lead');
        assert.equal(lead.access.role, 'lead');
        assert.deepEqual(lead.access.teamIds, [ids.member]);
        assert.deepEqual(titles(lead), ['月度成交额（上下文）', '自营渠道成交额', '虚构组员 · 月度成交额'].sort());
        assert.equal((await boot('stranger')).goals.length, 0, '默认“只看自己的路径”时，无关的人看不到');
        assert.equal((await boot('owner')).goals.length, 3);
        assert.equal((await call('member', 'GET', '/api/goals/' + ids.leadShare)).status, 404);
        assert.equal((await call('member', 'GET', `/api/events?goal=${ids.leadShare}`)).status, 404);
        const root = await goalOf('member', ids.root);
        assert.equal(root.goal.context, true);
        assert.equal(root.goal.hiddenChildren, 1, '上下文目标会告诉你还有几项看不到');
      }],
      ['部门负责人也能看到本部门成员的目标', async () => {
        ok(await call('owner', 'POST', `/api/goals/${ids.root}/split`, { items: [{ ownerId: ids.other, target: 200, title: '解决方案带来的成交' }] }), '拆给另一部门');
        assert.ok(!titles(await boot('lead')).includes('解决方案带来的成交'));
        ok(await call('owner', 'PUT', '/api/departments/6', { name: 'TOKEN业务', parentId: 5, managerId: ids.lead }), '设部门负责人');
        assert.ok(titles(await boot('lead')).includes('解决方案带来的成交'));
        ok(await call('owner', 'PUT', '/api/departments/6', { name: 'TOKEN业务', parentId: 5, managerId: null }), '撤销部门负责人');
        assert.ok(!titles(await boot('lead')).includes('解决方案带来的成交'));
      }],
      ['记进展：只有负责人和协作者能填数字，其他能看到的人可以留言', async () => {
        ok(await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: 120, note: '双 11 返场', signal: 'ok', date: '2026-11-20' }), '组员记一笔');
        ok(await call('lead', 'POST', `/api/goals/${ids.leadShare}/checkins`, { value: 300, date: '2026-11-23' }), '组长记一笔');
        assert.equal((await call('member', 'POST', `/api/goals/${ids.leadShare}/checkins`, { value: 5 })).status, 404);
        const forbidden = await call('lead', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: 5 });
        assert.equal(forbidden.status, 403); assert.match(forbidden.json.error, /留言/);
        ok(await call('lead', 'POST', `/api/goals/${ids.memberShare}/checkins`, { note: '周五一起看下直播数据' }), '上级留言');
        assert.equal((await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: 10, date: '2026-11-25' })).status, 400, '不能记未来');
        assert.equal((await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: 10, date: '2026-10-31' })).status, 400, '不能超出周期');
        assert.equal((await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: -10 })).status, 400, '冲减要写原因');
        assert.equal((await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: -500, note: '退款' })).status, 400, '冲减后不能为负');
        assert.equal((await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, {})).status, 400);
      }],
      ['汇总：数字逐层相加，按时间进度判断节奏', async () => {
        const { goal, contributions } = await goalOf('owner', ids.root);
        assert.equal(goal.stat.value, 420);
        assert.equal(goal.stat.completion, 0.42);
        assert.equal(goal.stat.timeProgress, 0.8);
        assert.equal(goal.stat.assigned, 1100, '允许超额分配，只提示');
        assert.equal(goal.stat.gap, -100);
        assert.equal(goal.stat.status, 'risk');
        assert.equal(goal.stat.childCount, 3);
        assert.equal(goal.stat.people, 4);
        const byId = Object.fromEntries(contributions.map(c => [c.userId, c]));
        assert.equal(byId[ids.member].value, 120); assert.equal(byId[ids.member].target, 300);
        assert.equal(byId[ids.lead].value, 300); assert.equal(byId[ids.lead].target, 600);
        const share = (await goalOf('member', ids.memberShare)).goal;
        assert.equal(share.stat.completion, 0.4);
        assert.equal(share.stat.status, 'ok', '新目标头 3 天是观察期');
      }],
      ['同一条记录重复提交只算一次，撤回与恢复', async () => {
        const body = { id: 'ck-idem-0001', value: 30, note: '补录' };
        ok(await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, body));
        const again = ok(await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, body));
        assert.equal(again.result.duplicate, true);
        assert.equal((await call('lead', 'POST', `/api/goals/${ids.memberShare}/checkins`, body)).status, 409);
        assert.equal((await goalOf('owner', ids.root)).goal.stat.value, 450);
        assert.equal((await call('lead', 'POST', '/api/checkins/ck-idem-0001/void', {})).status, 403, '只能撤回自己的记录');
        ok(await call('member', 'POST', '/api/checkins/ck-idem-0001/void', { reason: '录重了' }));
        assert.equal((await call('member', 'POST', '/api/checkins/ck-idem-0001/void', {})).status, 409);
        assert.equal((await goalOf('owner', ids.root)).goal.stat.value, 420);
        const mine = ok(await call('member', 'GET', '/api/checkins')).items;
        assert.ok(mine.find(item => item.id === 'ck-idem-0001').voided, '撤回的记录保留，只做标记');
        ok(await call('member', 'POST', '/api/checkins/ck-idem-0001/void', { restore: true }));
        assert.equal((await goalOf('owner', ids.root)).goal.stat.value, 450);
      }],
      ['越过 100% 时发喜报，已完成的目标状态为完成', async () => {
        ok(await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { value: 150, note: '大促收官' }));
        const share = (await goalOf('member', ids.memberShare)).goal;
        assert.equal(share.stat.value, 300); assert.equal(share.stat.status, 'done');
        const events = ok(await call('member', 'GET', '/api/events?filter=mine')).items;
        assert.ok(events.some(event => event.type === 'goal.achieved' && event.goalId === ids.memberShare));
      }],
      ['修改目标：上级可调目标值，本人只能改描述，版本冲突会提示', async () => {
        const share = (await goalOf('member', ids.memberShare)).goal;
        assert.equal((await call('member', 'PATCH', `/api/goals/${ids.memberShare}`, { version: share.version, target: 350 })).status, 403);
        ok(await call('member', 'PATCH', `/api/goals/${ids.memberShare}`, { version: share.version, note: '主要来自直播间' }), '本人改说明');
        assert.equal((await call('lead', 'PATCH', `/api/goals/${ids.memberShare}`, { version: share.version, target: 350 })).status, 409, '旧版本号');
        ok(await call('lead', 'PATCH', `/api/goals/${ids.memberShare}`, { version: share.version + 1, target: 350 }), '上级调目标值');
        assert.equal((await goalOf('member', ids.memberShare)).goal.stat.status === 'done', false);
        assert.equal((await call('other', 'PATCH', `/api/goals/${ids.memberShare}`, { version: share.version + 2, title: '改名' })).status, 404);
      }],
      ['在已关联的目标下继续拆关键动作；看不到的目标不能拆', async () => {
        ids.action = ok(await call('member', 'POST', '/api/goals', { parentId: ids.memberShare, kind: 'action', title: '完成 3 场直播复盘', endDate: '2026-11-28' }), '组员加关键动作').result.id;
        assert.equal((await call('other', 'POST', '/api/goals', { parentId: ids.memberShare, kind: 'action', title: '越权' })).status, 404);
        assert.equal((await call('member', 'POST', `/api/goals/${ids.action}/checkins`, { value: 1 })).status, 400, '“做完就行”不填数字');
      }],
      ['完成与重开；“做完就行”的上级按下层完成比例计算', async () => {
        ids.flow = ok(await call('owner', 'POST', '/api/goals', { scope: 'company', kind: 'action', title: '上线新品质检流程', startDate: '2026-11-01', endDate: '2026-11-30' })).result.id;
        const [leadStep, memberStep] = ok(await call('owner', 'POST', `/api/goals/${ids.flow}/split`, { items: [{ ownerId: ids.lead, title: '写好质检清单' }, { ownerId: ids.member, title: '跑通首批抽检' }] })).result.ids;
        ok(await call('member', 'POST', `/api/goals/${memberStep}/done`, { note: '首批 20 件已抽检' }));
        assert.equal((await call('member', 'POST', `/api/goals/${memberStep}/done`, {})).status, 409);
        assert.equal((await goalOf('owner', ids.flow)).goal.stat.completion, 0.5);
        ok(await call('lead', 'POST', `/api/goals/${leadStep}/done`, {}));
        assert.equal((await goalOf('owner', ids.flow)).goal.stat.status, 'done');
        ok(await call('lead', 'POST', `/api/goals/${leadStep}/done`, { done: false }));
        assert.equal((await goalOf('owner', ids.flow)).goal.stat.completion, 0.5);
      }],
      ['自主目标：可挂靠到看得到的组织目标，上级可为团队成员发起', async () => {
        const personal = { scope: 'personal', kind: 'measure', title: '读完 2 本增长书', unit: '本', target: 2, startDate: '2026-11-01', endDate: '2026-11-30' };
        ids.personal = ok(await call('member', 'POST', '/api/goals', { ...personal, alignId: ids.root }), '自主目标').result.id;
        assert.equal((await call('member', 'POST', '/api/goals', { ...personal, alignId: ids.leadShare })).status, 400, '挂靠看不到的目标');
        ok(await call('lead', 'POST', '/api/goals', { ...personal, title: '带新人跑通一场直播', ownerId: ids.member }), '上级为下属发起');
        assert.equal((await call('member', 'POST', '/api/goals', { ...personal, ownerId: ids.lead })).status, 403);
        const detail = await goalOf('owner', ids.root);
        assert.deepEqual(detail.aligned, [ids.personal]);
        assert.ok(titles(await boot('lead')).includes('读完 2 本增长书'), '上级看得到下属的自主目标');
        assert.ok(!titles(await boot('other')).includes('读完 2 本增长书'));
      }],
      ['主动加入组织目标成为协作者，再退出', async () => {
        assert.equal((await call('stranger', 'POST', `/api/goals/${ids.root}/join`, {})).status, 404);
        ok(await call('other', 'POST', `/api/goals/${ids.root}/join`, {}), '加入');
        const root = (await boot('other')).goals.find(goal => goal.id === ids.root);
        assert.equal(root.context, false); assert.equal(root.perms.checkin, true);
        assert.equal((await call('other', 'POST', `/api/goals/${ids.root}/join`, {})).status, 400);
        ok(await call('other', 'POST', `/api/goals/${ids.root}/join`, { leave: true }), '退出');
      }],
      ['“公司目标全员公开”：能看到全部拆解，自主目标仍只对相关的人可见', async () => {
        assert.equal((await call('member', 'PUT', '/api/settings', { openness: 'open' })).status, 403);
        ok(await call('owner', 'PUT', '/api/settings', { openness: 'open' }));
        const open = await boot('stranger');
        assert.ok(titles(open).includes('月度成交额') && titles(open).includes('自营渠道成交额'));
        assert.ok(!titles(open).includes('读完 2 本增长书'), '别人的自主目标仍不可见');
        assert.equal((await call('stranger', 'POST', `/api/goals/${ids.leadShare}/checkins`, { value: 1 })).status, 403, '看得到也不能替别人填数');
        ok(await call('owner', 'PUT', '/api/settings', { openness: 'path' }));
        assert.equal((await boot('stranger')).goals.length, 0);
      }],
      ['归档整组目标并恢复', async () => {
        const action = (await goalOf('lead', ids.action)).goal;
        assert.equal((await call('other', 'POST', `/api/goals/${ids.action}/archive`, { version: action.version })).status, 404);
        ok(await call('lead', 'POST', `/api/goals/${ids.action}/archive`, { version: action.version, reason: '改成线下复盘' }), '上级归档');
        assert.equal((await call('member', 'GET', '/api/goals/' + ids.action)).status, 404);
        assert.ok(ok(await call('lead', 'GET', '/api/archived')).items.some(item => item.id === ids.action));
        ok(await call('lead', 'POST', `/api/goals/${ids.action}/restore`, {}), '恢复');
        assert.equal((await goalOf('member', ids.action)).goal.title, '完成 3 场直播复盘');
        const root = (await goalOf('owner', ids.root)).goal;
        assert.equal((await call('lead', 'POST', `/api/goals/${ids.root}/archive`, { version: root.version })).status, 403, '公司目标只能由负责人归档');
      }],
      ['动态筛选与点赞', async () => {
        const help = ok(await call('owner', 'GET', '/api/events?filter=new')).items;
        assert.ok(help.length >= 3 && help.every(event => ['goal.created', 'goal.split'].includes(event.type)));
        const team = ok(await call('lead', 'GET', '/api/events?filter=team')).items;
        const owners = new Map((await boot('lead')).goals.map(goal => [goal.id, goal.ownerId]));
        assert.ok(team.length > 0 && team.every(event => event.actorId === ids.member || owners.get(event.goalId) === ids.member), '“团队”只看下属的动态');
        const target = ok(await call('lead', 'GET', `/api/events?goal=${ids.memberShare}`)).items.find(event => event.type === 'goal.achieved');
        const on = ok(await call('lead', 'POST', `/api/events/${target.seq}/cheer`, {})).result;
        assert.deepEqual([on.count, on.cheered], [1, true]);
        const off = ok(await call('lead', 'POST', `/api/events/${target.seq}/cheer`, {})).result;
        assert.deepEqual([off.count, off.cheered], [0, false]);
        ok(await call('lead', 'POST', `/api/events/${target.seq}/cheer`, {}));
        assert.ok((await boot('member')).cheersReceived.some(item => item.userId === ids.lead), '被点赞的人能看到是谁');
        const hidden = ok(await call('lead', 'GET', `/api/events?goal=${ids.leadShare}`)).items[0];
        assert.equal((await call('member', 'POST', `/api/events/${hidden.seq}/cheer`, {})).status, 404);
      }],
      ['增量：只带回自己看得到的变化；组织调整时要求整体刷新', async () => {
        const seq = ok(await call('member', 'GET', '/api/delta?since=0')).seq;
        assert.deepEqual(ok(await call('member', 'GET', '/api/delta?since=' + seq)).goals, []);
        ok(await call('lead', 'POST', `/api/goals/${ids.leadShare}/checkins`, { value: 20 }));
        const delta = ok(await call('member', 'GET', '/api/delta?since=' + seq));
        assert.ok(delta.goals.some(goal => goal.id === ids.root));
        assert.ok(!delta.goals.some(goal => goal.id === ids.leadShare));
        assert.ok(!delta.events.some(event => event.goalId === ids.leadShare), '看不到的目标的动态不会推给你');
        ok(await call('owner', 'PUT', '/api/users/' + ids.stranger, { title: '新职位' }));
        assert.equal(ok(await call('member', 'GET', '/api/delta?since=' + seq)).reload, true);
      }],
      ['实时推送：有人更新后，其他在线的人马上收到游标', async () => {
        const controller = new AbortController();
        const response = await fetch(s.origin + '/api/stream', { headers: { Cookie: s.jar.owner.cookie }, signal: controller.signal });
        assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const until = async (pattern, ms = 4000) => {
          const deadline = Date.now() + ms;
          while (!pattern.test(buffer)) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('没有等到推送：' + buffer);
            const chunk = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve(null), remaining))]);
            if (chunk?.value) buffer += decoder.decode(chunk.value);
          }
        };
        await until(/event: hello/);
        const before = Number(buffer.match(/"seq":(\d+)/)[1]);
        ok(await call('member', 'POST', `/api/goals/${ids.memberShare}/checkins`, { note: '收到，周五见' }));
        await until(/event: seq\ndata: \{"seq":\d+\}/);
        const pushed = Number(buffer.match(/event: seq\ndata: \{"seq":(\d+)\}/)[1]);
        assert.ok(pushed > before);
        controller.abort();
      }],
      ['只有公司负责人能管理组织', async () => {
        assert.equal((await call('lead', 'GET', '/api/admin/users')).status, 403);
        assert.equal((await call('lead', 'POST', '/api/departments', { name: '越权部门' })).status, 403);
        assert.equal((await call('lead', 'PUT', '/api/users/' + ids.member, { title: '越权' })).status, 403);
        const users = ok(await call('owner', 'GET', '/api/admin/users')).users;
        assert.ok(users.every(user => !('credential' in user)), '不返回登录凭据');
        assert.equal(users.find(user => user.id === ids.member).managerName, '虚构组长');
      }],
      ['成员停用后，下属自动改为向其上级汇报', async () => {
        ok(await call('owner', 'PUT', '/api/users/' + ids.lead, { managerId: 1 }));
        ok(await call('owner', 'DELETE', '/api/users/' + ids.lead, {}));
        const users = ok(await call('owner', 'GET', '/api/admin/users')).users;
        assert.equal(users.find(user => user.id === ids.member).managerId, 1);
        assert.equal((await call('lead', 'GET', '/api/bootstrap')).status, 401, '停用后会话失效');
      }]
    ]);
    const errors = s.serverErrors();
    if (errors) { console.error('服务端输出了错误：\n' + errors); process.exitCode = 1; }
  } finally { await s.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

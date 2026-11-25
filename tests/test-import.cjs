'use strict';
// 通讯录导入：用 Python 标准库现场生成一份虚构的飞书通讯录 XLSX（绝不使用真实花名册），检查
//   计划模式只读；写入模式先备份、只补空的汇报线和职位、归档旧版占位账号、不动目标和进展、
//   插入 org.changed 让在线的工作台刷新；重复导入不会重复建人；异常文件直接拒绝。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { APP, startServer, ok, run } = require('./test-helpers.cjs');

const MAKE_XLSX = `
import json, sys, zipfile
from xml.sax.saxutils import escape
rows = json.load(sys.stdin)
def col(i): return chr(65 + i)
body = ''.join('<row r="%d">%s</row>' % (r, ''.join('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col(i), r, escape(v)) for i, v in enumerate(row) if v != '')) for r, row in enumerate(rows, start=1))
sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>%s</sheetData></worksheet>' % body
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as book:
    book.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    book.writestr('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="成员" sheetId="1" r:id="rId1"/></sheets></workbook>')
    book.writestr('xl/worksheets/sheet1.xml', sheet)
`;
const HEADER = ['用户 ID', '姓名', '联系手机', '部门', '直属上级', '账号状态', '职位'];
const COMPANY = '虚构锅气公司';
const ROWS = [
  ['U001', '虚构老板', '13800000001', COMPANY, '', '正常', '创始人'],
  ['U002', '虚构内容负责人', '13800000002', `${COMPANY}/内容业务`, '虚构老板 13800000001', '正常', '负责人'],
  ['U003', '虚构成片同学', '138 0000 0003', `${COMPANY}/内容业务/成片方向`, '+8613800000002', '正常', '剪辑师'],
  ['U004', '虚构新部门同学', '13800000004', `${COMPANY}/增长实验室/私域小组`, '13800000002', '', ''],
  ['U005', '手工成员', '13800000005', `${COMPANY}/内容业务/AIGC方向`, '13800000004', '正常', ''],
  ['U006', '虚构双名|Alias', '13800000006', `${COMPANY}/解决方案/TOKEN业务`, '13800000003', '正常', '顾问']
];

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'guoqi-import-'));
  const dataDir = path.join(work, 'data');
  const xlsx = (name, rows) => {
    const file = path.join(work, name);
    const result = spawnSync('python3', ['-c', MAKE_XLSX, file], { input: JSON.stringify([['虚构通讯录导出'], HEADER, ...rows]), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return file;
  };
  const importer = (file, ...flags) => {
    const result = spawnSync(process.execPath, [path.join(APP, 'scripts', 'import-contacts.cjs'), file, ...flags], { cwd: APP, env: { ...process.env, NODE_NO_WARNINGS: '1', GUOQI_DATA_DIR: dataDir, DATABASE_URL: s.database.url, DATABASE_SCHEMA: s.database.schema }, encoding: 'utf8' });
    const stderr = result.stderr.split('\n').filter(line => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line)).join('\n');
    let json = null; try { json = JSON.parse(result.stdout); } catch { /* 失败时没有 JSON */ }
    return { status: result.status, json, stderr, stdout: result.stdout };
  };
  const s = await startServer({ dataDir, env: { GUOQI_TODAY: '2026-11-24' } });
  const { call } = s;
  const ids = {};
  const users = async () => ok(await call('owner', 'GET', '/api/admin/users')).users;
  const byName = (list, name) => list.find(user => user.name === name);
  let seqBefore, file;
  try {
    await run('通讯录导入', [
      ['准备：负责人、手工成员、两个旧版占位账号和它们负责的目标', async () => {
        ok(await call('owner', 'POST', '/api/setup', { name: '虚构老板', phone: '13800000001', lastFour: '1111' }));
        ids.manual = ok(await call('owner', 'POST', '/api/users', { name: '手工成员', phone: '13800000005', lastFour: '5555', departmentId: 2, managerId: 1 })).result.id;
        ids.brand = (await s.database.run('INSERT INTO users(name,department_id) VALUES (?,?)', '品牌负责人', 9)).id;
        ids.aigc = (await s.database.run('INSERT INTO users(name,department_id) VALUES (?,?)', 'AIGC负责人', 3)).id;
        ids.follower = ok(await call('owner', 'POST', '/api/users', { name: '虚构跟随者', phone: '13800000007', lastFour: '7777', departmentId: 9, managerId: ids.brand })).result.id;
        ids.root = ok(await call('owner', 'POST', '/api/goals', { scope: 'company', kind: 'measure', title: '品牌成交额', unit: '万元', target: 100, startDate: '2026-11-01', endDate: '2026-11-30' })).result.id;
        ids.placeholderGoal = ok(await call('owner', 'POST', `/api/goals/${ids.root}/split`, { items: [{ ownerId: ids.brand, target: 60 }] })).result.ids[0];
        ok(await call('owner', 'POST', `/api/goals/${ids.root}/checkins`, { value: 12, note: '公司层直接记的一笔' }));
        seqBefore = ok(await call('owner', 'GET', '/api/bootstrap')).data.seq;
        file = xlsx('contacts.xlsx', ROWS);
      }],
      ['计划模式：给出摘要，不写入任何东西', async () => {
        const before = await users();
        const plan = importer(file);
        assert.equal(plan.status, 0, plan.stderr);
        assert.equal(plan.json.mode, '计划（未写入）');
        assert.equal(plan.json.company, COMPANY);
        assert.deepEqual([plan.json.contacts, plan.json.newUsers, plan.json.matchedUsers, plan.json.newDepartments, plan.json.withSupervisor, plan.json.pendingLogin], [6, 4, 2, 2, 5, 4]);
        assert.deepEqual(plan.json.archivedPlaceholders.sort(), ['AIGC负责人', '品牌负责人'].sort());
        assert.equal(plan.json.goalsOwnedByArchived, 1);
        assert.ok(plan.json.hint.some(line => /转交/.test(line)));
        assert.doesNotMatch(plan.stdout, /1380000000\d/, '输出里不出现手机号');
        assert.deepEqual(await users(), before);
        assert.ok(!fs.existsSync(path.join(dataDir, 'backups')) || !fs.readdirSync(path.join(dataDir, 'backups')).some(name => name.startsWith('before-contact-import-')));
        assert.equal(ok(await call('owner', 'GET', '/api/delta?since=' + seqBefore)).goals.length, 0);
      }],
      ['写入模式：先备份，再建人、建部门、补汇报线', async () => {
        const result = importer(file, '--apply');
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.json.mode, '已写入');
        assert.equal(result.json.reportingLines, 4, '手工设置过上级的人不被覆盖');
        assert.ok(fs.existsSync(result.json.backup) && /before-contact-import-/.test(result.json.backup));
        const list = await users();
        const lead = byName(list, '虚构内容负责人'), cut = byName(list, '虚构成片同学'), growth = byName(list, '虚构新部门同学'), alias = byName(list, '虚构双名'), manual = byName(list, '手工成员');
        assert.deepEqual([lead.dept, lead.managerId, lead.title, lead.loginConfigured], ['内容业务', 1, '负责人', false]);
        assert.deepEqual([cut.dept, cut.managerId, cut.title, cut.phoneMasked], ['成片方向', lead.id, '剪辑师', '138****0003']);
        assert.deepEqual([growth.dept, growth.managerId], ['私域小组', lead.id]);
        assert.deepEqual([alias.managerId, alias.directory.alternateNames, alias.directory.sourceId], [cut.id, ['Alias'], 'U006']);
        assert.deepEqual([manual.id, manual.dept, manual.managerId, manual.directory.directManagerId], [ids.manual, 'AIGC方向', 1, growth.id]);
        const owner = byName(list, '虚构老板');
        assert.deepEqual([owner.title, owner.role, owner.managerId], ['公司负责人', 'owner', null], '职位只补空的；通讯录不改负责人身份');
        const departments = ok(await call('owner', 'GET', '/api/bootstrap')).data.departments;
        const lab = departments.find(d => d.name === '增长实验室');
        assert.ok(lab && lab.parentId === null && departments.some(d => d.name === '私域小组' && d.parentId === lab.id));
      }],
      ['旧版占位账号归档；它们负责的目标保留，指向它们的汇报线清空', async () => {
        const list = await users();
        assert.equal(byName(list, '品牌负责人').active, false);
        assert.equal(byName(list, 'AIGC负责人').active, false);
        assert.equal(byName(list, '虚构跟随者').managerId, null);
        assert.equal(byName(list, '虚构跟随者').active, true);
        const goal = ok(await call('owner', 'GET', '/api/goals/' + ids.placeholderGoal)).goal;
        assert.equal(goal.ownerId, ids.brand);
      }],
      ['目标与进展不动；在线的工作台收到“组织变了”', async () => {
        const root = ok(await call('owner', 'GET', '/api/goals/' + ids.root)).goal;
        assert.equal(root.stat.value, 12);
        assert.equal(ok(await call('owner', 'GET', '/api/delta?since=' + seqBefore)).reload, true);
        assert.equal(ok(await call('owner', 'GET', '/api/bootstrap')).data.directoryInitialization.contacts, 6);
      }],
      ['导入的人通过设置链接配置密码后可以登录，汇报线立即生效', async () => {
        const lead = byName(await users(), '虚构内容负责人');
        ok(await call('owner', 'PUT', '/api/users/' + lead.id, { lastFour: '2222' }));
        const data = ok(await call('lead', 'POST', '/api/login', { phone: '13800000002', name: '虚构内容负责人', lastFour: '2222' })).data;
        assert.equal(data.access.role, 'lead');
        assert.equal(data.access.directReportIds.length, 2);
        assert.equal(data.access.teamIds.length, 3, '下属的下属也算团队');
      }],
      ['重复导入：按来源 ID 匹配，不重复建人', async () => {
        const again = importer(file, '--apply');
        assert.equal(again.status, 0, again.stderr);
        assert.deepEqual([again.json.newUsers, again.json.matchedUsers, again.json.newDepartments, again.json.reportingLines], [0, 6, 0, 0]);
        assert.equal((await users()).filter(user => user.active).length, 7);
      }],
      ['异常文件直接拒绝', async () => {
        const cases = [
          ['owner.xlsx', ROWS.map((row, index) => index === 0 ? ['U001', '另一位老板', '13800000001', COMPANY, '', '正常', ''] : row), /公司负责人的姓名或手机号/],
          ['boss.xlsx', [...ROWS, ['U009', '虚构外援', '13800000009', `${COMPANY}/内容业务`, '13800009999', '正常', '']], /直属上级不在这份通讯录里/],
          ['dup.xlsx', [...ROWS, ['U010', '虚构重号', '13800000006', `${COMPANY}/内容业务`, '', '正常', '']], /重复手机号/],
          ['multi.xlsx', [...ROWS, ['U011', '虚构多部门', '13800000011', `${COMPANY}/内容业务，${COMPANY}/解决方案`, '', '正常', '']], /多个所属部门/],
          ['phone.xlsx', [...ROWS, ['U012', '虚构坏号', '1380000', `${COMPANY}/内容业务`, '', '正常', '']], /手机号格式不正确/],
          ['state.xlsx', [...ROWS, ['U013', '虚构停用', '13800000013', `${COMPANY}/内容业务`, '', '已停用', '']], /账号状态/]
        ];
        const before = await users();
        for (const [name, rows, pattern] of cases) {
          const result = importer(xlsx(name, rows), '--apply');
          assert.equal(result.status, 1, name);
          assert.match(result.stderr, pattern, name);
        }
        assert.deepEqual(await users(), before);
      }]
    ]);
    const errors = s.serverErrors();
    if (errors) { console.error('服务端输出了错误：\n' + errors); process.exitCode = 1; }
  } finally {
    await s.stop();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

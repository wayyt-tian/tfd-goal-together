'use strict';

// 演示数据：全部人物、数字均为虚构，只在 GUOQI_DEMO=1 且数据库为空时写入，用于体验和截图。
// 部门结构沿用工作台默认组织；日期相对“今天”生成，所以任何时候打开都是“本月正在进行”的样子。
const crypto = require('node:crypto');
const {
  monthRange,
  dayNum
} = require('./goals.cjs');
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const dateOf = num => new Date(num * DAY).toISOString().slice(0, 10);
const addDays = (date, n) => dateOf(dayNum(date) + n);
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const DEPARTMENTS = [[1, '内容业务', null], [2, '成片方向', 1], [3, 'AIGC方向', 1], [4, '创意方向', 1], [5, '解决方案', null], [6, 'TOKEN业务', 5], [7, 'BPO业务', 5], [8, '管理咨询', 5], [9, '品牌经营', 5], [10, '营销与销售', null], [11, 'KA-LA客户', 10], [12, 'SMB客户', 10], [13, 'AIE', null], [14, 'FDE', 13], [15, 'AI应用', 13], [16, 'AI Core', 13], [17, '财务及人力中心', null], [18, '财务分析', 17], [19, '财务管理', 17], [20, '招聘', 17], [21, '绩效', 17]];
// [部门, 负责人/组长, 组长职位, [成员...], 成员职位]
const TEAMS = [[2, '陈默', '成片组长', ['夏一鸣', '范小满', '刘清扬', '孟可欣'], '编导'], [3, '苏晓', 'AIGC 组长', ['姜禾', '陆景行', '方糖', '杜若'], 'AIGC 设计师'], [4, '何一帆', '创意组长', ['许多多', '秦朗月', '黎安'], '创意策划'], [6, '唐果', 'TOKEN 组长', ['吴见', '郑北辰', '冯悦'], '客户成功'], [7, '宋雨桐', 'BPO 组长', ['曹立', '袁小舟', '邓佳'], '运营专员'], [8, '程朗', '咨询组长', ['俞航', '钱多'], '咨询顾问'], [9, '叶星河', '品牌经营组长', ['贺然', '孔令仪', '严小鹿', '魏东'], '店铺运营'], [11, '许诺', 'KA 组长', ['金子涵', '潘越', '卢小雨', '谢晨'], '达人商务'], [12, '邵青', 'SMB 组长', ['汤圆圆', '田野', '毛思远', '石磊'], '客户经理'], [14, '顾北', 'FDE 组长', ['雷鸣', '薛晴', '傅一'], '前线工程师'], [15, '白露', 'AI 应用组长', ['龙飞', '姚瑶', '戴文'], '应用工程师'], [16, '秦川', 'AI Core 组长', ['莫凡', '柯一'], '算法工程师'], [18, '沈清', '财务分析组长', ['胡桃'], '财务分析师'], [19, '蒋明', '财务经理', [], ''], [20, '林小溪', '招聘组长', ['熊可'], '招聘专员'], [21, '段宁', '绩效专员', [], '']];
const HEADS = {
  1: ['周以宁', '内容业务负责人'],
  5: ['韩知远', '解决方案负责人'],
  10: ['罗嘉', '营销与销售负责人'],
  13: ['江屿', 'AIE 负责人'],
  17: ['温婉', '财务及人力负责人']
};
const NOTES = {
  ok: ['双 11 返场直播转化不错', '新品首发两场直播，节奏正常', '老客复购拉动了一波', '本周投放回报稳住了', '新签一个达人专场', '店铺大促报名通过', '客户续约顺利', '按计划推进中', '周末两场直播都完成了', '新渠道开始出单'],
  ahead: ['爆款返场超预期', '达人专场卖爆了，提前完成大半', '大客户追加了订单', '新玩法跑通，效果比预想好'],
  watch: ['流量比预期少两成，在调投放', '本周退款率偏高，正在排查原因', '达人档期往后挪了一周', '客户审批流程比预想慢', '素材过审慢了几天'],
  risk: ['主推品断货，补货要到下周', '大客户回款延期，需要一起推一下', '直播间被限流，需要投放和内容一起支持', '核心客户预算冻结，需要换打法', '人手不够，两条线顾不过来'],
  comment: ['周三一起过一下投放计划', '我来对接仓库，先保住下周的货', '这个思路很好，可以复制到别的店', '需要我出面找客户的话随时说', '辛苦了，周会上一起看看怎么补', '有数据了同步我一下']
};
async function seed({
  db,
  writeMeta,
  today,
  now
}) {
  const rand = prng(20261124);
  const pick = list => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
  const T = today();
  const [START, END] = monthRange(T.slice(0, 7));
  const nowMs = Date.parse(now());
  const midnight = Date.UTC(Number(T.slice(0, 4)), Number(T.slice(5, 7)) - 1, Number(T.slice(8, 10)), -8, 0, 0);
  const elapsedToday = Math.max(5 * 60000, Math.min(nowMs - midnight, 20 * 3600000));
  const timeOn = (date, early = false) => {
    if (date >= T) return new Date(nowMs - Math.round(between(90000, elapsedToday))).toISOString();
    const [y, m, d] = date.split('-').map(Number);
    const hour = early ? between(9, 11) : between(9.2, 22.5);
    const at = Date.UTC(y, m - 1, d, 0, 0, 0) + (hour - 8) * 3600000;
    return new Date(Math.min(at, nowMs - 60000)).toISOString();
  };
  const elapsedDays = dayNum(T) - dayNum(START) + 1;
  const monthDays = dayNum(END) - dayNum(START) + 1;
  const timeProgress = elapsedDays / monthDays;

  // ---------- 组织与人 ----------
  for (const [id, name, parent] of DEPARTMENTS) await db.run('INSERT INTO departments(id,name,parent_id) VALUES (?,?,?)', id, name, parent);
  const insertUser = 'INSERT INTO users(id,name,phone,credential,department_id,role,active,title,manager_id) VALUES (?,?,?,NULL,?,?,1,?,?)';
  let nextId = 1;
  const people = {};
  const addUser = async (name, departmentId, title, managerId, role = 'member') => {
    const id = nextId++;
    await db.run(insertUser, id, name, '199' + String(id).padStart(8, '0'), departmentId, role, title, managerId);
    people[name] = id;
    return id;
  };
  const ceo = await addUser('林远舟', null, '公司负责人', null, 'owner');
  const heads = {};
  for (const [deptId, [name, title]] of Object.entries(HEADS)) {
    heads[deptId] = await addUser(name, Number(deptId), title, ceo);
    await db.run('UPDATE departments SET manager_id=? WHERE id=?', heads[deptId], Number(deptId));
  }
  const teamMembers = {};
  for (const [deptId, lead, leadTitle, members, memberTitle] of TEAMS) {
    const parent = DEPARTMENTS.find(d => d[0] === deptId)[2];
    const leadId = await addUser(lead, deptId, leadTitle, heads[parent]);
    await db.run('UPDATE departments SET manager_id=? WHERE id=?', leadId, deptId);
    teamMembers[deptId] = [];
    for (const name of members) teamMembers[deptId].push(await addUser(name, deptId, memberTitle, leadId));
  }
  const P = name => people[name];

  // ---------- 目标树 ----------
  const goals = [],
    members = [],
    checkins = [],
    events = [];
  const byId = new Map();
  let sortCounter = 0;
  const gid = () => 'g-' + crypto.randomUUID();
  function goal(spec) {
    const g = {
      id: spec.id || gid(),
      parent_id: spec.parent?.id || null,
      scope: spec.scope || spec.parent?.scope || 'company',
      kind: spec.kind || 'measure',
      title: spec.title,
      note: spec.note || '',
      unit: spec.kind === 'action' ? '' : spec.unit || spec.parent?.unit || '万元',
      target: spec.kind === 'action' ? null : spec.target,
      start_date: spec.start || START,
      end_date: spec.end || END,
      owner_id: spec.owner,
      org_ids: JSON.stringify(spec.orgIds || []),
      align_id: spec.alignId || null,
      created_by: spec.createdBy || spec.owner,
      created_at: spec.createdAt || timeOn(START, true),
      done_at: null,
      done_by: null,
      sort: sortCounter++,
      members: spec.members || [],
      profile: spec.profile || null
    };
    if (spec.done) {
      g.done_at = spec.doneAt || timeOn(addDays(T, -Math.floor(between(1, Math.max(1, elapsedDays - 2)))));
      g.done_by = g.owner_id;
    }
    if (g.done_at && g.done_at < g.created_at) g.done_at = g.created_at;
    goals.push(g);
    byId.set(g.id, g);
    for (const m of g.members) members.push({
      goal_id: g.id,
      user_id: m,
      added_by: g.created_by,
      added_at: g.created_at
    });
    if (!spec.silent) events.push({
      at: g.created_at,
      actor: g.created_by,
      type: 'goal.created',
      goal: g.id,
      payload: {
        title: g.title,
        kind: g.kind,
        scope: g.scope,
        target: g.target,
        unit: g.unit,
        parentTitle: spec.parent?.title || null,
        ownerIds: [g.owner_id, ...g.members]
      }
    });
    if (g.done_at) events.push({
      at: g.done_at,
      actor: g.done_by,
      type: 'goal.done',
      goal: g.id,
      payload: {
        title: g.title,
        note: ''
      }
    });
    return g;
  }
  function split(parent, items, by, at) {
    const created = items.map(item => goal({
      parent,
      title: item.title,
      target: item.target,
      owner: item.owner,
      members: item.members,
      createdBy: by,
      createdAt: at,
      profile: item.profile,
      silent: true,
      orgIds: JSON.parse(parent.org_ids)
    }));
    events.push({
      at,
      actor: by,
      type: 'goal.split',
      goal: parent.id,
      payload: {
        title: parent.title,
        count: created.length,
        ownerIds: created.map(c => c.owner_id),
        total: items.reduce((s, i) => s + (i.target || 0), 0),
        unit: parent.unit,
        childIds: created.map(c => c.id)
      }
    });
    return created;
  }
  const early = d => timeOn(addDays(START, Math.min(d, Math.max(0, elapsedDays - 1))), true);

  // 北极星 1：本月 GMV
  const gmv = goal({
    id: 'demo-gmv',
    title: '本月 GMV',
    unit: '万元',
    target: 1000,
    owner: ceo,
    note: '口径：已签收订单金额，扣除退款。',
    createdAt: early(0)
  });
  const [selfRun, koc, live] = split(gmv, [{
    title: '自营渠道成交额',
    target: 450,
    owner: P('叶星河')
  }, {
    title: '达人合作成交额',
    target: 150,
    owner: P('罗嘉')
  }, {
    title: '内容与直播成交额',
    target: 400,
    owner: P('周以宁')
  }], ceo, early(0));
  selfRun.org_ids = '[9]';
  koc.org_ids = '[10]';
  live.org_ids = '[1]';
  const brandShares = split(selfRun, [{
    title: '天猫旗舰店成交额',
    target: 120,
    owner: P('贺然'),
    profile: 'ok'
  }, {
    title: '抖音商城成交额',
    target: 110,
    owner: P('孔令仪'),
    profile: 'ahead',
    members: [P('金子涵')]
  }, {
    title: '京东自营成交额',
    target: 90,
    owner: P('严小鹿'),
    profile: 'watch'
  }, {
    title: '私域社群成交额',
    target: 60,
    owner: P('魏东'),
    profile: 'risk'
  }], P('叶星河'), early(1));
  const [ka, smb] = split(koc, [{
    title: 'KA 达人成交额',
    target: 80,
    owner: P('许诺')
  }, {
    title: 'SMB 达人成交额',
    target: 70,
    owner: P('邵青')
  }], P('罗嘉'), early(1));
  split(ka, [{
    title: '头部达人专场',
    target: 30,
    owner: P('金子涵'),
    profile: 'done'
  }, {
    title: '腰部达人矩阵',
    target: 25,
    owner: P('潘越'),
    profile: 'ok'
  }, {
    title: '新达人孵化',
    target: 25,
    owner: P('卢小雨'),
    profile: 'stale'
  }], P('许诺'), early(2));
  split(smb, [{
    title: '本地生活达人',
    target: 25,
    owner: P('汤圆圆'),
    profile: 'ok'
  }, {
    title: '垂类达人合作',
    target: 25,
    owner: P('田野'),
    profile: 'watch',
    members: [P('谢晨')]
  }, {
    title: '达人复投',
    target: 20,
    owner: P('毛思远'),
    profile: 'ok'
  }], P('邵青'), early(2));
  const [film, aigc, creative] = split(live, [{
    title: '成片带货成交额',
    target: 150,
    owner: P('陈默')
  }, {
    title: 'AIGC 内容成交额',
    target: 130,
    owner: P('苏晓')
  }, {
    title: '创意直播成交额',
    target: 120,
    owner: P('何一帆')
  }], P('周以宁'), early(1));
  const filmShares = split(film, [{
    title: '品牌短片带货',
    target: 45,
    owner: P('夏一鸣'),
    profile: 'ok'
  }, {
    title: '达人二创成片',
    target: 40,
    owner: P('范小满'),
    profile: 'ahead'
  }, {
    title: '日更短视频',
    target: 35,
    owner: P('刘清扬'),
    profile: 'risk'
  }, {
    title: '直播切片分发',
    target: 30,
    owner: P('孟可欣'),
    profile: 'ok'
  }], P('陈默'), early(2));
  const aigcShares = split(aigc, [{
    title: 'AI 商品图带货',
    target: 50,
    owner: P('姜禾'),
    profile: 'ok'
  }, {
    title: 'AI 数字人直播',
    target: 45,
    owner: P('陆景行'),
    profile: 'watch',
    members: [P('柯一')]
  }, {
    title: 'AI 短视频矩阵',
    target: 25,
    owner: P('方糖'),
    profile: 'ok'
  }], P('苏晓'), early(2));
  split(creative, [{
    title: '节日营销直播',
    target: 50,
    owner: P('许多多'),
    profile: 'ok'
  }, {
    title: '主题快闪直播',
    target: 40,
    owner: P('秦朗月'),
    profile: 'stale'
  }, {
    title: '联名创意内容',
    target: 30,
    owner: P('黎安'),
    profile: 'ahead'
  }], P('何一帆'), early(2));

  // 北极星 2：浪花收入（工具与咨询对外合作带来的 AI Token 收入）
  const wave = goal({
    id: 'demo-wave',
    title: '本月浪花收入',
    unit: '万元',
    target: 30,
    owner: ceo,
    note: '工具与管理咨询对外合作带来的 AI Token 收入。',
    createdAt: early(0)
  });
  const [token, picture, share] = split(wave, [{
    title: 'TOKEN 对外合作收入',
    target: 12,
    owner: P('唐果')
  }, {
    title: 'AI 画面业务收入',
    target: 10,
    owner: P('白露')
  }, {
    title: 'AI 成片分润收入',
    target: 8,
    owner: P('宋雨桐')
  }], ceo, early(0));
  token.org_ids = '[6]';
  picture.org_ids = '[15]';
  share.org_ids = '[7]';
  split(token, [{
    title: '老客户续费',
    target: 4,
    owner: P('吴见'),
    profile: 'ok'
  }, {
    title: '新客户签约',
    target: 4,
    owner: P('郑北辰'),
    profile: 'risk'
  }, {
    title: '渠道伙伴分成',
    target: 3,
    owner: P('冯悦'),
    profile: 'watch'
  }], P('唐果'), early(1));
  split(picture, [{
    title: '品牌方批量出图',
    target: 4,
    owner: P('龙飞'),
    profile: 'ahead'
  }, {
    title: '电商代运营出图',
    target: 3.5,
    owner: P('姚瑶'),
    profile: 'ok'
  }, {
    title: '设计工作室订阅',
    target: 2.5,
    owner: P('戴文'),
    profile: 'risk'
  }], P('白露'), early(1));
  split(share, [{
    title: '成片分润 · 美妆客户',
    target: 3,
    owner: P('曹立'),
    profile: 'ok'
  }, {
    title: '成片分润 · 食品客户',
    target: 3,
    owner: P('袁小舟'),
    profile: 'ok'
  }, {
    title: '成片分润 · 家居客户',
    target: 2,
    owner: P('邓佳'),
    profile: 'watch'
  }], P('宋雨桐'), early(1));

  // 北极星 3：管理咨询收入
  const consult = goal({
    id: 'demo-consult',
    title: '本月管理咨询收入',
    unit: '万元',
    target: 20,
    owner: P('韩知远'),
    orgIds: [8],
    createdBy: ceo,
    createdAt: early(0)
  });
  const [projects] = split(consult, [{
    title: '咨询项目收入',
    target: 12,
    owner: P('程朗')
  }, {
    title: '投放岛分成收入',
    target: 8,
    owner: P('韩知远'),
    profile: 'ok'
  }], P('韩知远'), early(1));
  split(projects, [{
    title: '零售客户增长诊断',
    target: 6,
    owner: P('俞航'),
    profile: 'ok'
  }, {
    title: '新消费品牌陪跑',
    target: 6,
    owner: P('钱多'),
    profile: 'ahead'
  }], P('程朗'), early(2));

  // 北极星 4：做完就行型——AI 提效
  const aiTools = goal({
    id: 'demo-ai',
    kind: 'action',
    title: 'AI 提效：本月上线 3 个内部工具',
    owner: P('江屿'),
    orgIds: [13],
    createdBy: ceo,
    createdAt: early(0),
    note: '每个工具上线后至少有一个业务团队在用。'
  });
  const picker = goal({
    parent: aiTools,
    kind: 'action',
    title: '选品助手上线',
    owner: P('顾北'),
    members: [P('雷鸣'), P('贺然')],
    createdBy: P('江屿'),
    createdAt: early(1)
  });
  goal({
    parent: picker,
    kind: 'action',
    title: '需求评审',
    owner: P('顾北'),
    createdAt: early(2),
    done: true,
    doneAt: timeOn(addDays(START, Math.min(4, elapsedDays - 1)))
  });
  goal({
    parent: picker,
    kind: 'action',
    title: '业务联调',
    owner: P('雷鸣'),
    createdAt: early(2),
    done: elapsedDays > 12
  });
  goal({
    parent: picker,
    kind: 'action',
    title: '品牌经营组灰度试用',
    owner: P('薛晴'),
    members: [P('贺然'), P('孔令仪')],
    createdAt: early(3),
    end: addDays(END, -2)
  });
  goal({
    parent: aiTools,
    kind: 'action',
    title: '直播脚本生成器接入飞书',
    owner: P('秦川'),
    members: [P('莫凡')],
    createdBy: P('江屿'),
    createdAt: early(1),
    end: addDays(T, -1) > START ? addDays(T, -1) : END
  });
  goal({
    parent: aiTools,
    kind: 'action',
    title: '投放数据日报自动化',
    owner: P('戴文'),
    createdBy: P('江屿'),
    createdAt: early(1),
    done: true
  });

  // 北极星 5：关键岗位到岗
  const hiring = goal({
    id: 'demo-hire',
    title: '关键岗位到岗',
    unit: '人',
    target: 6,
    owner: P('温婉'),
    orgIds: [17],
    createdBy: ceo,
    createdAt: early(0)
  });
  split(hiring, [{
    title: '技术岗到岗',
    target: 3,
    owner: P('林小溪'),
    profile: 'watch'
  }, {
    title: '业务岗到岗',
    target: 3,
    owner: P('熊可'),
    profile: 'ok'
  }], P('温婉'), early(1));

  // 关键动作：成员在自己的份额下面自己加的“路径”
  const [tmall] = brandShares;
  goal({
    parent: tmall,
    kind: 'action',
    title: '首页改版上线',
    owner: P('贺然'),
    createdAt: early(3),
    done: true
  });
  goal({
    parent: tmall,
    title: '店铺新客',
    unit: '人',
    target: 5000,
    owner: P('贺然'),
    createdAt: early(3),
    profile: 'ok'
  });
  goal({
    parent: tmall,
    kind: 'action',
    title: '搜索词优化（新想法）',
    owner: P('贺然'),
    members: [P('龙飞')],
    createdAt: timeOn(addDays(T, -1)),
    note: '用选品助手的搜索词数据，先在两个类目试。'
  });
  goal({
    parent: filmShares[2],
    kind: 'action',
    title: '拍摄排期调整到每天两条',
    owner: P('刘清扬'),
    members: [P('孟可欣')],
    createdAt: timeOn(T)
  });
  goal({
    parent: aigcShares[1],
    kind: 'action',
    title: '数字人直播间话术库',
    owner: P('陆景行'),
    members: [P('柯一')],
    createdAt: timeOn(addDays(T, -2))
  });
  // 新人：刚加入，第一次使用
  goal({
    parent: aigc,
    title: 'AI 主图测款带货',
    target: 10,
    owner: P('杜若'),
    createdBy: P('苏晓'),
    createdAt: timeOn(addDays(T, -1)),
    start: addDays(T, -1) < START ? START : addDays(T, -1),
    profile: 'fresh'
  });

  // 自主目标（个人发起，可以挂靠到组织目标；不计入公司汇总）
  const personal = [['夏一鸣', '每周一篇直播复盘', '篇', 4, 'demo-gmv', 'ok'], ['姜禾', '学会用 AI 做商品主图', null, null, null, 'done'], ['潘越', '积累 20 个新达人', '个', 20, 'demo-gmv', 'ahead'], ['魏东', '搭好私域社群看板', null, null, 'demo-gmv', 'open'], ['吴见', '整理 TOKEN 客户案例库', '篇', 6, 'demo-wave', 'watch'], ['俞航', '输出一套诊断方法论', null, null, 'demo-consult', 'open'], ['龙飞', '沉淀 10 个出图模板', '个', 10, 'demo-wave', 'ok'], ['胡桃', '月度经营分析模板', null, null, null, 'done'], ['孟可欣', '学会 AI 剪辑工作流', null, null, null, 'open'], ['汤圆圆', '每周拜访 3 个本地商家', '个', 12, 'demo-gmv', 'ok'], ['薛晴', '读完两本增长黑客的书', '本', 2, null, 'ok'], ['许多多', '节日选题库 50 条', '条', 50, null, 'risk'], ['熊可', '优化面试流程', null, null, 'demo-hire', 'open'], ['陈默', '带新人跑通成片流程', null, null, null, 'open'], ['孔令仪', '直播间转化率提升方案', null, null, 'demo-gmv', 'open'], ['孔令仪', '每周两场直播复盘', '场', 8, null, 'ok']];
  for (const [name, title, unit, target, alignId, profile] of personal) {
    goal({
      scope: 'personal',
      kind: unit ? 'measure' : 'action',
      title,
      unit: unit || '',
      target,
      owner: P(name),
      alignId,
      createdAt: timeOn(addDays(START, Math.floor(between(0, Math.max(1, elapsedDays - 1))))),
      profile: unit ? profile : null,
      done: profile === 'done'
    });
  }

  // ---------- 进展 ----------
  const kidsOf = id => goals.filter(g => g.parent_id === id);
  const signalFor = profile => profile === 'risk' ? rand() < 0.65 ? 'help' : 'watch' : profile === 'watch' ? rand() < 0.6 ? 'watch' : null : rand() < 0.35 ? 'ok' : null;
  const earlyMorning = elapsedToday < 4 * 3600000; // 凌晨打开时，“今天”的记录不要全挤在最近几十分钟里
  let todayCount = 0;
  for (const g of goals) {
    if (g.kind !== 'measure' || !g.profile || g.profile === 'fresh' || kidsOf(g.id).some(k => k.kind === 'measure' && k.unit === g.unit)) continue;
    const tp = timeProgress;
    const factor = {
      ahead: tp + between(0.08, 0.22),
      ok: tp + between(-0.04, 0.05),
      watch: tp - between(0.08, 0.14),
      risk: Math.max(0.06, tp - between(0.22, 0.4)),
      stale: Math.max(0.08, tp - between(0.12, 0.3)),
      done: between(1.0, 1.12)
    }[g.profile] ?? tp;
    const decimals = g.unit === '万元' ? g.target < 20 ? 2 : 1 : 0;
    const scale = 10 ** decimals;
    const units = Math.max(1, Math.round(g.target * Math.max(0.02, factor) * scale)); // 以最小单位计的总量
    const createdDay = dayNum(g.created_at.slice(0, 10));
    const firstDay = Math.max(dayNum(START) + 1, createdDay);
    let lastDay = g.profile === 'stale' ? Math.max(firstDay, dayNum(T) - Math.round(between(9, 13))) : dayNum(T) - Math.floor(between(0, rand() < 0.5 ? 1.5 : 3.5));
    if (lastDay === dayNum(T) && earlyMorning && todayCount++ >= 3) lastDay -= 1;
    lastDay = Math.min(dayNum(T), Math.max(firstDay, lastDay));
    const span = lastDay - firstDay;
    const count = Math.max(1, Math.min(7, Math.round(span / 4) + (rand() < 0.5 ? 1 : 0), units));
    const days = new Set([lastDay]);
    while (days.size < Math.min(count, span + 1)) days.add(firstDay + Math.floor(rand() * (span + 1)));
    const sorted = [...days].sort((x, y) => x - y);
    const weights = sorted.map(() => between(0.5, 1.5));
    const sumW = weights.reduce((sum, w) => sum + w, 0);
    let left = units;
    const parts = sorted.map((_, index) => {
      if (index === sorted.length - 1) return left;
      const share = Math.max(1, Math.min(left - (sorted.length - 1 - index), Math.round(units * weights[index] / sumW)));
      left -= share;
      return share;
    });
    sorted.forEach((day, index) => {
      const value = parts[index] / scale;
      if (!(value > 0)) return;
      const date = dateOf(day);
      const last = index === sorted.length - 1;
      const profile = g.profile === 'stale' ? 'ok' : g.profile === 'done' ? 'ahead' : g.profile;
      checkins.push({
        id: 'c-' + crypto.randomUUID(),
        goal_id: g.id,
        author_id: g.owner_id,
        date,
        value,
        note: last || rand() < 0.5 ? pick(NOTES[profile] || NOTES.ok) : '',
        signal: last ? signalFor(g.profile) : null,
        created_at: timeOn(date)
      });
    });
  }
  // 上级和同事的留言（只写一句话，不改数字）
  for (const g of goals.filter(x => ['risk', 'watch'].includes(x.profile))) {
    const parent = byId.get(g.parent_id);
    if (!parent || rand() < 0.35) continue;
    const date = addDays(T, -Math.floor(between(0, 2)));
    checkins.push({
      id: 'c-' + crypto.randomUUID(),
      goal_id: g.id,
      author_id: parent.owner_id === g.owner_id ? ceo : parent.owner_id,
      date,
      value: null,
      note: pick(NOTES.comment),
      signal: null,
      created_at: timeOn(date)
    });
  }
  // 协作者也会记进展
  for (const g of goals.filter(x => x.members.length && x.kind === 'measure' && x.profile && x.profile !== 'stale')) {
    const date = addDays(T, -Math.floor(between(1, 4)));
    if (date < START) continue;
    const value = Math.round(g.target * between(0.04, 0.08) * 10) / 10;
    checkins.push({
      id: 'c-' + crypto.randomUUID(),
      goal_id: g.id,
      author_id: g.members[0],
      date,
      value,
      note: '协作带来的成交',
      signal: null,
      created_at: timeOn(date)
    });
  }
  for (const c of checkins) {
    const g = byId.get(c.goal_id);
    events.push({
      at: c.created_at,
      actor: c.author_id,
      type: 'checkin.created',
      goal: c.goal_id,
      ref: c.id,
      checkin: c,
      payload: {
        title: g.title,
        value: c.value,
        unit: g.unit,
        note: c.note,
        signal: c.signal,
        comment: c.value === null && !c.signal
      }
    });
  }

  // ---------- 写库 ----------
  const insertGoal = `INSERT INTO goals(id,parent_id,scope,kind,title,note,unit,target,start_date,end_date,owner_id,org_ids,align_id,created_by,created_at,updated_at,done_at,done_by,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  for (const g of goals) await db.run(insertGoal, g.id, g.parent_id, g.scope, g.kind, g.title, g.note, g.unit, g.target, g.start_date, g.end_date, g.owner_id, g.org_ids, g.align_id, g.created_by, g.created_at, g.created_at, g.done_at, g.done_by, g.sort);
  const insertMember = 'INSERT INTO goal_members(goal_id,user_id,added_by,added_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING';
  for (const m of members) await db.run(insertMember, m.goal_id, m.user_id, m.added_by, m.added_at);
  const insertCheckin = 'INSERT INTO checkins(id,goal_id,author_id,date,value,note,signal,created_at) VALUES (?,?,?,?,?,?,?,?)';
  for (const c of checkins) await db.run(insertCheckin, c.id, c.goal_id, c.author_id, c.date, c.value, c.note, c.signal, c.created_at);
  events.sort((a, b) => a.at.localeCompare(b.at));
  const insertEvent = 'INSERT INTO events(created_at,actor_id,type,goal_id,ref_id,payload) VALUES (?,?,?,?,?,?)';
  const running = new Map();
  const achieved = new Set();
  const seqs = [];
  for (const e of events) {
    if (e.type === 'checkin.created' && e.checkin.value !== null) {
      const g = byId.get(e.goal);
      const total = Math.round(((running.get(g.id) || 0) + e.checkin.value) * 10000) / 10000;
      running.set(g.id, total);
      e.payload.total = total;
      e.payload.target = g.target;
      e.payload.completion = g.target ? Math.round(total / g.target * 10000) / 10000 : null;
    }
    const seq = Number((await db.run(insertEvent, e.at, e.actor, e.type, e.goal, e.ref || null, JSON.stringify(e.payload))).id);
    seqs.push({
      seq,
      e
    });
    const g = byId.get(e.goal);
    if (e.type === 'checkin.created' && g.target && running.get(g.id) >= g.target && !achieved.has(g.id)) {
      achieved.add(g.id);
      const s2 = Number((await db.run(insertEvent, e.at, e.actor, 'goal.achieved', g.id, e.ref, JSON.stringify({
        title: g.title,
        total: running.get(g.id),
        target: g.target,
        unit: g.unit
      }))).id);
      seqs.push({
        seq: s2,
        e: {
          ...e,
          type: 'goal.achieved'
        }
      });
    }
  }
  const finalSeq = seqs.length ? seqs[seqs.length - 1].seq : 0;
  await db.run('UPDATE goals SET seq=?', finalSeq);

  // 加油：同事给最近的进展和喜报点赞
  const everyone = Object.values(people);
  const insertCheer = 'INSERT INTO cheers(event_seq,user_id,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING';
  for (const {
    seq,
    e
  } of seqs.slice(-80)) {
    const n = e.type === 'goal.achieved' || e.type === 'goal.done' ? Math.floor(between(3, 9)) : e.type === 'checkin.created' && e.checkin?.value ? Math.floor(between(0, 4)) : 0;
    for (let i = 0; i < n; i++) {
      const who = pick(everyone);
      if (who !== e.actor) await db.run(insertCheer, seq, who, new Date(Math.min(nowMs - 30000, Date.parse(e.at) + between(60000, 3 * 3600000))).toISOString());
    }
  }

  // 演示身份：老用户的“上次来访”放在约 20 小时前，这样一进来就能看到“你不在时发生了什么”
  const before = Date.now() - 20 * 3600000;
  const lastSeen = [...seqs].reverse().find(item => Date.parse(item.e.at) <= before)?.seq || Math.max(0, finalSeq - 12);
  const personas = [{
    userId: ceo,
    label: '公司负责人',
    summary: '看全局：从公司目标一路下探到每个人'
  }, {
    userId: P('周以宁'),
    label: '业务负责人',
    summary: '看团队：14 人的进展、风险和新想法'
  }, {
    userId: P('孔令仪'),
    label: '一线成员',
    summary: '记进展：我负责的、我参与的、我的自主目标'
  }, {
    userId: P('杜若'),
    label: '新同事',
    summary: '第一次用：跟着三步引导上手'
  }];
  const state = 'INSERT INTO user_state(user_id,last_seen_seq,onboarded) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen_seq=excluded.last_seen_seq, onboarded=excluded.onboarded';
  for (const id of everyone) if (id !== P('杜若')) await db.run(state, id, lastSeen, 1);
  await writeMeta('demoPersonas', JSON.stringify(personas));
  await writeMeta('configured', 1);
}
module.exports = {
  seed,
  startSimulator,
  NOTES
};

function startSimulator({ db, goals, transaction, userById, today }) {
  const rand = Math.random;
  const pick = list => list[Math.floor(rand() * list.length)];
  let timer = null, stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await db.scope(async () => {
      const t = today();
      const m = goals.model();
      const leaves = [...m.goals.values()].filter(g => !g.archived_at && !(m.kids.get(g.id) || []).length && g.start_date <= t && g.end_date >= t && userById(g.owner_id)?.active && userById(g.owner_id).role !== 'owner');
      const measures = leaves.filter(g => g.kind === 'measure' && g.target > 0 && (m.stats.get(g.id)?.completion ?? 0) < 1.25);
      const roll = rand();
      await transaction(async () => {
        if (roll < 0.62 && measures.length) {
          const g = pick(measures);
          const author = rand() < 0.2 && g.members.length ? pick(g.members) : g.owner_id;
          const value = Math.max(g.unit === '万元' ? 0.1 : 1, Math.round(g.target * (0.02 + rand() * 0.05) * (g.unit === '万元' ? 10 : 1)) / (g.unit === '万元' ? 10 : 1));
          const status = m.stats.get(g.id)?.status;
          const profile = status === 'risk' ? 'risk' : status === 'watch' ? 'watch' : 'ok';
          await goals.createCheckin(userById(author), g.id, { value, note: pick(NOTES[profile]), signal: profile === 'risk' && rand() < 0.4 ? 'help' : profile === 'ok' && rand() < 0.3 ? 'ok' : null, simulated: true });
        } else if (roll < 0.8 && measures.length) {
          const g = pick(measures.filter(x => ['risk', 'watch'].includes(m.stats.get(x.id)?.status)).concat(measures).slice(0, 40));
          const parent = g.parent_id ? m.goals.get(g.parent_id) : null;
          const author = parent && parent.owner_id !== g.owner_id ? parent.owner_id : g.members[0] || null;
          if (author && userById(author)?.active) await goals.createCheckin(userById(author), g.id, { note: pick(NOTES.comment), simulated: true });
        } else if (roll < 0.9 && measures.length) {
          const g = pick(measures);
          const ideas = ['复用爆款脚本到新品', '和达人约一场联合直播', '把高转化素材做成模板', '找老客户做一次回访', '试一个新的投放人群包'];
          await goals.createGoal(userById(g.owner_id), { parentId: g.id, kind: 'action', title: pick(ideas), simulated: true });
        } else {
          const recent = await db.many("SELECT seq, actor_id FROM events WHERE type IN ('checkin.created','goal.achieved','goal.done','goal.created') ORDER BY seq DESC LIMIT 15");
          const people = (await db.many("SELECT id FROM users WHERE active=1")).map(r => r.id);
          const event = recent.length && pick(recent);
          const who = pick(people);
          if (event && who !== event.actor_id && !(await db.one('SELECT 1 FROM cheers WHERE event_seq=? AND user_id=?', event.seq, who))) await db.run('INSERT INTO cheers(event_seq,user_id,created_at) VALUES (?,?,?)', event.seq, who, new Date().toISOString());
        }
      });
      await db.notify();
      }, {write:true,lock:'organization',prepare:()=>goals.prepareModel()});
    } catch (error) { if (!error.status) console.error('演示模拟出错：', error.message); }
    timer = setTimeout(tick, 20000 + Math.random() * 20000);
  };
  timer = setTimeout(tick, 8000);
  return { stop() { stopped = true; clearTimeout(timer); } };
}


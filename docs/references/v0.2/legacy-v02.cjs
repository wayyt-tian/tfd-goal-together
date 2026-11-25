'use strict';
// 识别 v0.2 内置的演示种子（v0.2 的 seed.js：7 个角色化成员、2026-07 至 2026-12 的虚构流水）。
// v0.2 首次启动时会把这份种子写进业务数据；升级到 v0.3 时，和种子完全一致的“虚构进展”和“演示历史月份”不迁入，
// 原样保存在升级前备份和数据库的 performance_legacy 里。
// 指纹只比对数字和归属字段（周期、指标、目标值、成员编号、日期、数值），不含任何文字；改过这些字段的记录按你的数据处理。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CORE = {
  company: ['period', 'metric', 'target'],
  goals: ['id', 'period', 'metric', 'group', 'target'],
  assignments: ['id', 'goal', 'member', 'target'],
  entries: ['id', 'assignment', 'date', 'value']
};
const FILE = path.join(__dirname, 'legacy-v02-demo.json');

function fingerprint(kind, record) {
  const values = CORE[kind].map(key => (record && record[key] !== undefined ? record[key] : null));
  return crypto.createHash('sha256').update(kind + '|' + JSON.stringify(values)).digest('hex').slice(0, 16);
}

let cached = null;
function demoSeed() {
  if (cached) return cached;
  let data = { planPeriod: null };
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 没有指纹文件时，全部按你的数据迁移 */ }
  const sets = Object.fromEntries(Object.keys(CORE).map(kind => [kind, new Set(data[kind] || [])]));
  cached = {
    planPeriod: data.planPeriod || null,
    has: (kind, record) => sets[kind].has(fingerprint(kind, record))
  };
  return cached;
}

module.exports = { CORE, fingerprint, demoSeed };

'use strict';
// 依次运行全部测试（每个测试都启动独立的工作台进程和临时数据目录，互不影响）。
// 用法：npm test    或    node tests/test-all.cjs [goals static scale database import]
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ALL = ['goals', 'static', 'scale', 'database', 'import', 'formal', 'operations'];
const picked = process.argv.slice(2).filter(name => ALL.includes(name));
const suites = picked.length ? picked : ALL;
const started = Date.now();
const failed = [];
console.log(`锅气家族工作台 v${require('../package.json').version} 测试 · Node ${process.version}`);
for (const name of suites) {
  console.log(`\n▶ test-${name}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `test-${name}.cjs`)], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  process.stdout.write(result.stdout);
  const stderr = result.stderr.split('\n').filter(line => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line)).join('\n');
  if (stderr) process.stderr.write(stderr + '\n');
  if (result.status !== 0) failed.push(name);
}
console.log(`\n${failed.length ? '✗ 未通过：' + failed.map(name => 'test-' + name).join('、') : '✓ 全部通过'}（${suites.length} 组，${((Date.now() - started) / 1000).toFixed(1)} 秒）`);
process.exitCode = failed.length ? 1 : 0;

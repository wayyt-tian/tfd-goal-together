'use strict';
// 交付包完整性校验：
//   1) manifest.json 里每个文件都存在、字节数和 sha256 一致；
//   2) 包里没有清单之外的文件，也没有数据库、.data、node_modules 等不该交付的东西；
//   3) 文本文件里出现的手机号只能是虚构号段（138/139/137 0000 开头、199 开头），防止误带真实通讯录。
// 用法：node tools/verify-package.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const excluded = relative => relative !== '.env.example' && /^(?:\.git|node_modules|\.data|test-results|playwright-report)(?:\/|$)|^web\/dist(?:\/|$)|^\.env(?:\..*)?$|^\.impeccable\/(?:hook\.cache|config\.local)\.json$/.test(relative);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const problems = [];
const listed = new Set();
for (const file of manifest.files) {
  const target = path.resolve(root, file.path);
  listed.add(file.path);
  if (!target.startsWith(root + path.sep)) { problems.push('路径无效：' + file.path); continue; }
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) { problems.push('缺少文件：' + file.path); continue; }
  const buffer = fs.readFileSync(target);
  if (buffer.length !== file.bytes || crypto.createHash('sha256').update(buffer).digest('hex') !== file.sha256) problems.push('内容已变化：' + file.path);
}
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (dir === root && entry.name === '.git') return [];
  const full = path.join(dir, entry.name);
  if (excluded(path.relative(root,full).split(path.sep).join('/'))) return [];
  if (entry.isSymbolicLink()) { problems.push('不允许符号链接：' + path.relative(root, full)); return []; }
  return entry.isDirectory() ? walk(full) : [full];
});
const FORBIDDEN = [/\.(sqlite(-wal|-shm)?|db|dump)$/, /(^|\/)\.data\//, /(^|\/)node_modules\//, /(^|\/)__pycache__\//, /\.pyc$/, /(^|\/)\.DS_Store$/, /单位员工档案/];
const FICTIONAL = /^(1380000|1390000|1370000|199)/;
let scanned = 0;
for (const full of walk(root)) {
  const relative = path.relative(root, full).split(path.sep).join('/');
  if (relative === 'manifest.json') continue;
  if (!listed.has(relative)) problems.push('清单之外的文件：' + relative);
  if (FORBIDDEN.some(pattern => pattern.test(relative))) problems.push('不应交付的文件：' + relative);
  if (/\.(md|cjs|js|jsx|mjs|json|sql|txt|py|html|css|yaml)$/.test(relative)) {
    scanned++;
    for (const match of fs.readFileSync(full, 'utf8').matchAll(/(?<!\d)1[3-9]\d{9}(?!\d)/g)) {
      if (!FICTIONAL.test(match[0])) problems.push(`疑似真实手机号：${relative}（${match[0].slice(0, 3)}****${match[0].slice(7)}）`);
    }
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`PASS 交付包完整：${manifest.files.length} 个文件与清单一致，无清单外文件，${scanned} 个文本文件未发现真实手机号；${manifest.packageId}`);

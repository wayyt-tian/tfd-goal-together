'use strict';
// 更新可交付文件的指纹；Git 元数据不属于交付内容。
// 用法：npm run package:manifest，完成后再运行 npm run package:check。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const excluded = relative => relative !== '.env.example' && /^(?:\.git|node_modules|\.data|test-results|playwright-report)(?:\/|$)|^web\/dist(?:\/|$)|^\.env(?:\..*)?$|^\.impeccable\/(?:hook\.cache|config\.local)\.json$/.test(relative);
const target = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && ['.git', 'manifest.json'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (excluded(relative)) continue;
    if (entry.isSymbolicLink()) throw new Error('不允许符号链接：' + relative);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.(?:sqlite(?:-wal|-shm)?|db|dump)$|(?:^|\/)(?:\.data|node_modules|__pycache__)\/|(?:^|\/)\.DS_Store$|\.pyc$|单位员工档案/.test(relative)) {
      throw new Error('不应交付的文件：' + relative);
    }
    const buffer = fs.readFileSync(full);
    files.push({ path: relative, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
  }
}
walk(root);
manifest.files = files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
manifest.layoutRevision = '2026-11-25';
fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
console.log(`已更新交付清单：${files.length} 个文件。请运行 npm run package:check 检查完整性和样本隐私。`);

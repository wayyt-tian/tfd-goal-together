'use strict';
// 只为本项目生成本地配置；复用镜像，不访问其他应用容器。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const file = path.join(root, '.env');
if (!fs.existsSync(file)) {
  const password = crypto.randomBytes(24).toString('hex');
  const base = `postgres://goal_together:${password}@127.0.0.1:55436/`;
  fs.writeFileSync(file, `POSTGRES_PASSWORD=${password}\nPOSTGRES_PORT=55436\nDATABASE_URL=${base}goal_together\nDEMO_DATABASE_URL=${base}goal_together_demo\nTEST_DATABASE_URL=${base}goal_together_test\n`, { mode: 0o600 });
  console.log('已生成本项目本地连接配置（.env，不进入版本库）。');
}
const result = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'postgres'], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;

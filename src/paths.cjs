'use strict';
// 统一从本文件定位仓库，启动目录不会影响资源位置。
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
module.exports = {
  ROOT,
  WEB: path.join(ROOT, 'web', 'dist'),
  BRAND: path.join(ROOT, 'assets', 'brand'),
  FONTS: path.join(ROOT, 'assets', 'fonts'),
  DATA_DIRECTORY: process.env.GUOQI_DATA_DIR || path.join(ROOT, '.data')
};

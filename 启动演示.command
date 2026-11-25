#!/bin/bash
# 双击体验目标共创台；需要先安装依赖、配置项目专用 PostgreSQL，见 README.md。
cd "$(dirname "$0")" || exit 1

# 双击运行时不会加载终端配置，这里补上常见的 Node 安装位置（含 nvm）
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

pause() { read -r -n 1 -p "按任意键关闭这个窗口…"; echo; }
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node 22（https://nodejs.org 下载 LTS 版本），再双击本文件。"
  pause; exit 1
fi
new_enough() { node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! new_enough && command -v nvm >/dev/null 2>&1; then nvm use 22 >/dev/null 2>&1; fi
if ! new_enough; then
  echo "当前 Node 版本是 $(node -v)，需要 22.13 或更高。"
  pause; exit 1
fi

echo "正在启动演示（实时模拟：每 20–40 秒出现一条虚构动态）…"
npm run build && node scripts/start-demo.cjs --live --open
pause

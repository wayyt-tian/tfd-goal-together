# 目标共创台 · Goal Together

轻松协同的团队目标工作台，支持多层目标拆解、成员协作、增量进展和实时同步。不打分、不排名。项目仓库：[tfd-goal-together](https://github.com/wayyt-tian/tfd-goal-together)。

技术栈：React 19 + Vite 7，服务端 JavaScript（Node.js 22.13+），PostgreSQL 16。保留原有页面布局、样式、导航、Logo 和 IP 素材。

```sh
npm ci
npm run db:setup       # 复用本机 postgres:16-alpine，创建本项目独立容器和卷
npm run build
HOST=0.0.0.0 PORT=4180 npm start  # 正式与演示共用入口，数据分别隔离
```

首次在其他机器使用，需要先准备 Docker 和 `postgres:16-alpine` 镜像。配置保存在本地 `.env`，示例见 [.env.example](.env.example)。演示使用独立的 `goal_together_demo` 数据库和随机隔离空间，正常退出时自动删除。正式库、测试库和演示库彼此独立。

```sh
npm run dev:server     # 终端一：临时演示后端，4181 端口
npm run dev            # 终端二：Vite 开发页面，5173 端口
npm test               # 构建 + 7 组后端回归，仅使用专用测试/演示库
npm run test:browser   # Chromium 浏览器交互回归
npm run demo:check
npm run test:smoke
```

浏览器测试第一次运行前执行 `npx playwright install chromium`。

服务器发布使用仓库自带的 [goal-together-release skill](.agents/skills/goal-together-release/SKILL.md)。换机器克隆后，需要 Python 3.10+、Git、OpenSSH、Docker 和操作者自己的服务器访问权限；在本机完成隔离数据库测试与镜像构建，再上传服务器校验和部署。目标为 `https://goal.tywldx.ltd`，按 50GB 小盘预算运维，回滚镜像归档保存在开发机；发布验收后默认只保留当前版本及容器引用，清理本项目旧镜像。命令、凭据准备与实际发布状态见 [服务器发布](docs/15_服务器发布.md)。

正式入口为 `/formal/`，演示为 `/demo/`；登录页和头像菜单可切换。默认端口 4173，可通过环境设置 4180。正式库使用 `DATABASE_URL`，从空白开始；手机号和密码登录，首次配置凭证位于本机 `.data/formal/setup-token.json`。`npm run demo` 保持独立虚构演示。**不读取或迁移旧 SQLite 数据**；`GUOQI_DATA_DIR` 现在只控制备份等本地文件，不决定数据库连接。

```text
src/server.cjs         正式与演示入口分流
src/application.cjs    独立实例、接口、事务及实时推送
src/db/                PostgreSQL 连接池、初始化 SQL、备份
src/lib/               目标领域与虚构演示数据
web/js/                React 视图、弹层、表单、状态与接口客户端
web/css/               原有样式与新增账户/管理界面样式
web/dist/              构建产物，不提交
assets/                品牌图片、字体及许可证
scripts/               数据库设置、临时演示、通讯录导入
infra/postgres/        本地开发库初始化
tests/                接口、数据库和浏览器回归
docs/                 产品、开发及交接文档
```

[开发与部署](docs/05_本地开发与数据续接.md) · [架构](docs/03_架构与代码地图.md) · [业务规则](docs/02_业务规则与权限.md) · [重构与验证](docs/13_PostgreSQL与React重构.md) · [正式模式与账号管理](docs/14_正式模式与账号管理.md)

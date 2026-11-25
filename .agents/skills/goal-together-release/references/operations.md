# 换机器、证书与故障处理

## 换机器执行

克隆 `https://github.com/wayyt-tian/tfd-goal-together.git`，进入克隆目录。`.agents/skills/goal-together-release` 跟随源码，不要求原开发者的文件或登录态；支持任意本地目录名和空格。若当前助手不自动发现项目 skill，直接让它读取该目录的 `SKILL.md`，或将目录复制到自己的 `${CODEX_HOME:-$HOME/.codex}/skills/`。

操作者须自行取得服务器 SSH 访问权限；使用自己的 SSH Agent 或 `--identity ~/.ssh/自己的私钥`。首次连接先通过管理员等可信渠道核对主机公钥指纹，并将核实后的公钥加入自己的 known_hosts。工具不自动信任未知指纹；连接强制公钥认证和严格校验，关闭密码、交互认证及转发。不要禁用主机密钥校验，也不要把旧开发机的私钥或 known_hosts 当交付依赖。密钥问题只阻塞执行，不通过复制凭据来解决。

本机依赖：Python 3.10+、Git、OpenSSH、Docker，以及 `node:24-alpine`、`postgres:16-alpine` 基础镜像缓存和依赖下载网络；没有缓存时先在本机拉取。当前服务器架构为 linux/amd64，本地应使用相同架构的 Docker。目标机为 Ubuntu，需 Docker daemon 权限、Compose（支持 `up --wait`）、Python 3.10+、Nginx、Certbot、systemd 以及当前账户非交互 sudo。应用测试和镜像构建全部在本机完成，镜像连同 SHA-256、镜像 ID、源码提交和测试日志上传；服务器不安装依赖或构建镜像，无需 GitHub 凭据。变更服务器时复制目标 JSON 后传 `--target`，只放地址、域名、端口和保留策略，不放密码。

发布前先提交本次代码；普通发布不改正式 Compose。如需变更数据库、数据卷、端口或域名，应先单独评审和实施环境变更，不能靠普通代码发布隐式重建数据库。已有目录、同名容器/卷归属不清时工具停止。

目标配置可选 `alpine_mirror`（HTTPS 软件镜像源，路径为 `/alpine`），通过构建参数同时用于本地校验和应用镜像，未指定时使用 Alpine 官方源。当前配置使用 `https://mirrors.aliyun.com/alpine`；不更改宿主机或其他项目的配置。构建失败先查看本机 `.data/releases/<发布号>/` 的日志；上传和切换失败查看服务器发布记录。镜像归档校验或架构不匹配时停止，不自动在服务器重新构建。

## 目标及持久资源

- SSH：`ubuntu@120.53.31.57:22`。
- 域名：`goal.tywldx.ltd`；A 记录为 `120.53.31.57`，签发前检查所有 DNS 地址。首次域名配置会创建专属 Nginx 站点；不修改其他域名配置。
- 根目录：`/srv/goal-together`；`owner.json` 标记归属，`release.lock` 只互斥本工具服务器阶段的发布和清理，不覆盖上传、TLS 或其他 Agent。开始操作前另行协调全机清理和其他发布。
- `shared/runtime.env`：服务器生成的随机数据库密码、正式地址、当前镜像与端口，权限 0600。不得输出 `docker compose config`、环境变量或数据库 URL。
- Compose 项目：`goal-together`。`postgres-data`、`app-data`、`backups` 都是本项目专用命名卷，数据库不发布宿主端口。不能复用资产平台、TFD 或 IEH5 的数据库。
- `backups/<发布号>.dump`：切换前的正式库备份。应用自身升级备份和报告仍保留于持久卷；正式应用的自动备份机制不被替代。
- `state.json`：成功版本、当前版和上一版的不可变标签及构建元数据。标签有记录不代表镜像仍在服务器，上一版可已清理。
- `releases/<发布号>/`：源码提交身份、隔离测试、构建日志、发布结果；不存镜像 tar、第二份 node_modules 或完整源码树。传输暂存目录正常退出会删除，异常中断遗留文件应先核对进程和归属再处理。

备份目前保存在服务器，属于发布回退材料，不等于异地灾难恢复。需要异地保存时使用授权的私有存储，核对 SHA-256 后再安排独立备份保留策略；镜像清理不会删除数据库备份。共享构建缓存和基础镜像不由本项目清理。数据库备份、日志的增长要单独盘点，不能通过镜像清理承诺磁盘永不耗尽。

## 容量与站外回滚制品

服务器按 50GB 预算管理。发布前核对根目录、Docker 数据目录和传输临时目录所在分区的可用量，以及数据库/备份体积；只输出这些选定字段，不导出完整 Docker 信息或容器环境。估算压缩包解包、镜像新增层、备份及服务运行的空间峰值。`minimum_free_gib=4` 只检查静态可用量，脚本没有自动计算这个峰值；不足时先停止准备，按授权范围另做维护，不能删除仍需恢复的镜像冒险切换。

本地 `.data/releases/<发布号>/` 保留 `image.tar`（应用及 PostgreSQL 基础镜像）、`source.json`、`verification.log`、`build.log`。镜像归档和元数据权限 0600，目录 0700，已被 Git 忽略。`source.json` 的 `recovery_archive` 是相对项目根目录的路径，`image_archive_sha256` 是 tar 的 SHA-256；另有提交、镜像 ID、平台和标签。保存此目录不依赖本地 Docker 缓存；传输临时目录删除后仍可恢复。不要仅因本机镜像标签仍在就声称已有回滚归档。

独立清理或换机器前，读取所需本地 `source.json`，流式计算 tar 的 SHA-256 与记录比较；需要验证可加载性时在有空间的开发机 `docker image load -i <已核验的归档>`，只投影检查镜像 ID、平台和归属标签。归档在开发机不是异地灾备承诺；长期保存在授权私有存储时，同样保留哈希、元数据和访问办法。没有授权不上传到公共仓库或第三方服务。

`keep_images=1` 仅保留当前成功版本；所有现存容器引用仍受保护。工具不验证旧归档当前是否仍在另一台开发机，助手须完成上述核验。旧版无 `recovery_archive` 记录时，上一版进入 `recovery_archive_pending`：

1. 无并发发布时核对上一版的标签、镜像 ID 和提交，通过严格校验的 SSH 将该**精确镜像** `docker image save` 的输出直接流式保存到开发机私有目录，避免服务器再落一份 tar。
2. 确认传输退出码为零、归档可读取，在开发机加载并核对原镜像 ID，计算 SHA-256，保留对应 `source.json`。失败或中断的文件不能登记为有效制品。
3. 在本项目发布锁内备份 `state.json`，只更新对应成功记录的 `recovery_archive` 和 `image_archive_sha256` 为实际保存位置与实测哈希，保留其他记录；再复核服务、引用和状态并重试项目清理。不能为了消除待办凭空填写字段。

独立清理会拒绝应用未运行、实际镜像标签与成功状态不符、正式/演示接口或 HTTPS 不通过的情况。本清理器不删除停止容器，也不处理无仓库标签镜像。需要执行用户选择的“只保留运行容器引用”的整机清理时，交由服务器维护流程单独盘点：运行、暂停、重启、状态未知的容器与发布候选/恢复镜像均保护，停止容器先核对可写层及业务归属，不强删、不带卷删除。

## HTTPS 和续期

`tls --execute --renewal-test`：创建/更新带归属标记的 `/etc/nginx/sites-available/goal-together` 和对应启用链接，HTTP-01 使用 `/var/lib/goal-together-acme`；证书名称为 `goal.tywldx.ltd`。复用服务器既有 ACME 账户；新服务器若尚无账户，由管理员配置联系邮箱并注册后重试。

证书目录 `/etc/letsencrypt/live/goal.tywldx.ltd/` 由 Certbot 管理，私钥不进入源码包。`certbot.timer` 自动检查续期；`/etc/letsencrypt/renewal-hooks/deploy/goal-together-reload` 仅在 `RENEWED_DOMAINS` 包含本域名时运行 `nginx -t` 和重载。兼容服务器 Certbot 1.21：演练使用 `renew --cert-name goal.tywldx.ltd --dry-run`，再单独验证本域名钩子。

只读检查：

```sh
ssh -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ClearAllForwardings=yes ubuntu@120.53.31.57 'systemctl list-timers certbot.timer --no-pager'
curl -I https://goal.tywldx.ltd/
```

未发布应用时 HTTPS 返回 503“工作台尚未发布”是预期状态；证书有效不代表应用已经发布。应用验证通过后发布工具才启用反向代理。完整应用发布后再验证 HTTPS 的正式/演示接口。

## 失败与回退

先读本项目发布目录内日志和 `state.json`，不要输出私有配置。发布失败时旧镜像尚未被成功清理，自动回退仅针对存在上一版且迁移版本没有改变的情况。恢复旧镜像后还需检查正式 HTTPS；失败发布不会触发镜像清理。

人工回退没有一键子命令。先协调其他发布/全机清理，取得项目发布锁；记录回退前的提交、运行镜像和数据库迁移版本。核对新旧版本所需 schema，不能因为有备份就认定旧程序兼容当前库。

若上一版已从服务器清理，先在开发机核验其归档 SHA-256 和镜像 ID，通过严格 SSH 将归档流式传给服务器 `docker image load`，不在服务器重新构建；导入后只投影核对标签、ID、架构、归属和提交。恢复过程中显式协调保护该镜像，禁止同时执行全机清理。所需归档缺失时停止回退准备并报告，不能把状态里的标签当作现成镜像。

确认兼容且镜像就绪后，可将 `shared/runtime.env` 的 `APP_IMAGE` 改为 `state.json` 中记录的上一不可变标签，再只更新应用服务：

```sh
cd /srv/goal-together
docker compose --project-name goal-together --env-file shared/runtime.env -f compose.yaml up -d --no-deps app
```

随后检查本机与正式 HTTPS 两个模式、首页、关键静态资源和实际镜像 ID，检查本轮相关业务入口；在锁内更新 `state.json` 的 current/previous 并保存独立回退回执，保留原发布历史。失败时报告实际运行状态，不宣告回退成功。不要 `compose down -v`。schema 不兼容时不要直接启动旧版；先用项目 `scripts/restore-backup.cjs` 在独立空库验证备份，再由用户明确批准正式数据库切换。恢复数据库可能丢失备份之后的写入，不能作为普通失败重试自动执行。

## 校验本 skill

在项目根目录运行 `python3 tests/test-release.py` 和 `npm test`。技能元数据可用 skill-creator 的 `quick_validate.py` 检查，该校验器仅供制作时使用，不是发布依赖。测试归档转移与本机持久保存、不安全路径拒绝、小盘保留策略、删除前容器引用重查和迁移兼容的失败回退；未实际发布时不能声称线上应用已验收。

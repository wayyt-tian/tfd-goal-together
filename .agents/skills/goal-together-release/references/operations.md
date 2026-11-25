# 换机器、证书与故障处理

## 换机器执行

克隆 `https://github.com/wayyt-tian/tfd-goal-together.git`，进入克隆目录。`.agents/skills/goal-together-release` 跟随源码，不要求原开发者的文件或登录态；支持任意本地目录名和空格。若当前助手不自动发现项目 skill，直接让它读取该目录的 `SKILL.md`，或将目录复制到自己的 `${CODEX_HOME:-$HOME/.codex}/skills/`。

操作者须自行取得服务器 SSH 访问权限；使用自己的 SSH Agent 或 `--identity ~/.ssh/自己的私钥`。第一次连接先向服务器管理员核对主机公钥指纹，然后正常运行 `ssh ubuntu@120.53.31.57` 接受匹配的主机密钥。不要禁用主机密钥校验，也不要把旧开发机的私钥或 known_hosts 当交付依赖。密钥问题只阻塞执行，不通过复制凭据来解决。

本机依赖：Python 3.10+、Git、OpenSSH。目标机为 Ubuntu，需 Docker daemon 权限、Compose（支持 `up --wait`）、Python 3.10+、Nginx、Certbot、systemd 以及当前账户非交互 sudo。目标机需能拉取 `node:24-alpine`、`postgres:16-alpine` 和 npm 包；不需要 GitHub 凭据。变更服务器时复制目标 JSON 后传 `--target`，只放地址、域名、端口和保留策略，不放密码。

发布前先提交本次代码；普通发布不改正式 Compose。如需变更数据库、数据卷、端口或域名，应先单独评审和实施环境变更，不能靠普通代码发布隐式重建数据库。已有目录、同名容器/卷归属不清时工具停止。

## 目标及持久资源

- SSH：`ubuntu@120.53.31.57:22`。
- 域名：`goal.tywldx.ltd`；A 记录为 `120.53.31.57`，签发前检查所有 DNS 地址。首次域名配置会创建专属 Nginx 站点；不修改其他域名配置。
- 根目录：`/srv/goal-together`；`owner.json` 标记归属，`release.lock` 防止并发发布和清理。
- `shared/runtime.env`：服务器生成的随机数据库密码、正式地址、当前镜像与端口，权限 0600。不得输出 `docker compose config`、环境变量或数据库 URL。
- Compose 项目：`goal-together`。`postgres-data`、`app-data`、`backups` 都是本项目专用命名卷，数据库不发布宿主端口。不能复用资产平台、TFD 或 IEH5 的数据库。
- `backups/<发布号>.dump`：切换前的正式库备份。应用自身升级备份和报告仍保留于持久卷；正式应用的自动备份机制不被替代。
- `state.json`：最近成功版本、当前版和上一版的不可变标签。
- `releases/<发布号>/`：源码提交身份、隔离测试、构建日志、发布结果，不存第二份 node_modules 或完整源码树。

备份目前保存在服务器，属于发布回退材料，不等于异地灾难恢复。需要异地保存时使用授权的私有存储，核对 SHA-256 后再安排独立备份保留策略；镜像清理不会删除数据库备份。共享构建缓存和基础镜像不做全局清理。

## HTTPS 和续期

`tls --execute --renewal-test`：创建/更新带归属标记的 `/etc/nginx/sites-available/goal-together` 和对应启用链接，HTTP-01 使用 `/var/lib/goal-together-acme`；证书名称为 `goal.tywldx.ltd`。复用服务器既有 ACME 账户；新服务器若尚无账户，由管理员配置联系邮箱并注册后重试。

证书目录 `/etc/letsencrypt/live/goal.tywldx.ltd/` 由 Certbot 管理，私钥不进入源码包。`certbot.timer` 自动检查续期；`/etc/letsencrypt/renewal-hooks/deploy/goal-together-reload` 仅在 `RENEWED_DOMAINS` 包含本域名时运行 `nginx -t` 和重载。兼容服务器 Certbot 1.21：演练使用 `renew --cert-name goal.tywldx.ltd --dry-run`，再单独验证本域名钩子。

只读检查：

```sh
ssh ubuntu@120.53.31.57 'systemctl is-enabled certbot.timer; systemctl is-active certbot.timer; systemctl list-timers certbot.timer --no-pager'
curl -I https://goal.tywldx.ltd/
```

未发布应用时 HTTPS 返回 503“工作台尚未发布”是预期状态；证书有效不代表应用已经发布。应用验证通过后发布工具才启用反向代理。完整应用发布后再验证 HTTPS 的正式/演示接口。

## 失败与回退

先读本项目发布目录内日志和 `state.json`，不要输出私有配置。自动回退仅针对已保存上一版且迁移版本没有改变的情况。恢复旧镜像后还需检查正式 HTTPS；失败发布不会触发镜像清理。

人工回退前核对新旧版本所需 schema。若兼容，可将 `shared/runtime.env` 的 `APP_IMAGE` 改为 `state.json` 中保留的上一不可变标签，再只更新应用服务：

```sh
cd /srv/goal-together
docker compose --project-name goal-together --env-file shared/runtime.env -f compose.yaml up -d --no-deps app
```

随后检查两个模式和实际镜像，并更新发布记录。不要 `compose down -v`。schema 不兼容时不要直接启动旧版；先用项目 `scripts/restore-backup.cjs` 在独立空库验证备份，再由用户明确批准正式数据库切换。恢复数据库可能丢失备份之后的写入，不能作为普通失败重试自动执行。

## 校验本 skill

在项目根目录运行 `python3 tests/test-release.py` 和 `npm test`。技能元数据可用 skill-creator 的 `quick_validate.py` 检查，该校验器仅供制作时使用，不是发布依赖。测试归档转移、不安全路径拒绝、镜像引用保留和失败回退；未实际发布时不能声称线上应用已验收。

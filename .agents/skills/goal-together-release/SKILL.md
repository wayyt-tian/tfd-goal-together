---
name: goal-together-release
description: 发布、检查或回退目标共创台（tfd-goal-together）的服务器版本，管理 goal.tywldx.ltd 的 HTTPS 自动续期，并清理本项目历史镜像。适用于该项目的正式发布和发布运维，不用于其他服务或本机演示。
---

# 目标共创台发布

仓库自带此 skill；换电脑后从新克隆目录运行。先读项目 `AGENTS.md`。目标配置为 `deploy/production.json`：`ubuntu@120.53.31.57`，`https://goal.tywldx.ltd`，服务器独立目录 `/srv/goal-together`，应用仅绑定 `127.0.0.1:4182`。不要使用曾误写的 `goal.twldx.ltd`。

本机需要 Python 3.10+、Git、OpenSSH、Docker 和操作者自己的 SSH 权限。在本机临时容器及数据库中测试、构建镜像，再上传服务器；服务器只校验、导入镜像、备份和切换服务，禁止在服务器构建或安装应用依赖。服务器使用现有 Docker、Compose、Python、Nginx、Certbot 和 `sudo -n`；不依赖开发数据库、SSH 别名、绝对开发路径或另一个 skill。凭据准备和故障处理见 [运维说明](references/operations.md)。

## 操作入口

在项目根目录，以下命令中的路径相对于该目录：

```sh
python3 .agents/skills/goal-together-release/scripts/release.py plan
python3 .agents/skills/goal-together-release/scripts/release.py check
python3 .agents/skills/goal-together-release/scripts/release.py deploy --execute
```

工具支持 `--project-dir`、`--target`、`--ref`、`--identity`、`--known-hosts`；可用 `GOAL_RELEASE_IDENTITY` 指向当前操作者的私钥，不把私钥写进仓库。`plan/check/status` 只读；`deploy/tls/cleanup` 没有 `--execute` 时只展示计划。用户已明确要求本次发布、证书配置或清理时直接执行对应操作，不重复索要同一授权；只要求创建 skill 时不发布应用。

## 发布契约

1. 核对 Git 提交与工作区；发布必须是干净、已提交的源码。工具只归档所选提交在本机构建，并拒绝凭据、数据、构建缓存及符号链接，不上传当前目录的 `.env`。目标机无需 GitHub 登录态，不接收完整源码或安装依赖。
2. 执行 `check`，确认 SSH 主机身份、磁盘和本项目资源归属。共享服务器上的其他应用、数据库、端口和代理站点不在范围内。空间不足时停止，不能为腾空间先删除回滚镜像。
3. `deploy --execute` 在本机的独立容器、临时网络、临时 PostgreSQL 中执行完整 `npm test`，通过后在本机构建唯一提交标识的应用镜像。导出应用和数据库基础镜像，通过 SSH 上传；服务器校验归档 SHA-256、平台架构、镜像 ID、归属与源码提交，再导入和部署，绝不执行构建。正式、演示数据使用本项目专用持久卷，测试不接触正式库。首次发布生成服务器私有配置；不会接管同名的未知数据库或容器。
4. 切换前做 PostgreSQL 自定义格式备份并用 `pg_restore --list` 检查。单实例 Compose 更新会有短暂中断。验证本机和正式 HTTPS 的 `/formal/api/session`、`/demo/api/session`，以及实际运行镜像身份。初始化凭证仍只在服务器私有卷内，不输出内容。
5. 失败时不清理恢复资源。只在数据库迁移版本未变化时自动恢复上一镜像；迁移已变化时停止新应用并保留备份，按运维说明评估，不能自动覆盖恢复数据库。
6. 成功后自动清理本项目旧镜像：默认保留最近三个成功版本，至少当前版和上一版；任何运行中或停止容器引用的镜像 ID 均保留。只逐个删除带本项目归属标签、精确仓库名 `goal-together-app` 的旧标签，不用 force，不执行全局 prune，不删数据库、卷、备份或其他项目镜像。报告删除列表和剩余磁盘；共享构建缓存不属于此清理范围。

## 证书、检查和独立清理

```sh
python3 .agents/skills/goal-together-release/scripts/release.py tls --execute --renewal-test
python3 .agents/skills/goal-together-release/scripts/release.py status
python3 .agents/skills/goal-together-release/scripts/release.py cleanup --execute
```

HTTPS 使用 Let's Encrypt 公共可信证书；`certbot.timer` 定期检查并续期，域名限定的钩子在该证书更新后校验并重载 Nginx。不生成浏览器不信任的自签证书。证书命令只管理本项目站点；未发布应用时显示明确的 503 提示，不把证书就绪宣称为应用已上线。

发布结果说明：提交、本地构建及镜像传输校验、新旧镜像、测试/备份/HTTPS 验证、自动回退情况、清理结果与未验证项。本地构建记录位于 `.data/releases/<发布号>/`，服务器记录位于 `/srv/goal-together/releases/<发布号>/`；配置和备份含敏感数据，不能提交或发到聊天。

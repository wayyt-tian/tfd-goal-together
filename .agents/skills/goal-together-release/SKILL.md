---
name: goal-together-release
description: 发布、检查或回退目标共创台（tfd-goal-together）到 ubuntu@120.53.31.57，维护 goal.tywldx.ltd 的 HTTPS，并在验收后回收本项目旧镜像。用于目标共创台发布运维；全机空间维护另按服务器运维流程处理。
---

# 目标共创台发布

先读项目 `AGENTS.md`，核对 `deploy/production.json`。当前目标为 `ubuntu@120.53.31.57:22`、`https://goal.tywldx.ltd`、`/srv/goal-together`，应用仅监听 `127.0.0.1:4182`。旧拼写 `goal.twldx.ltd` 不可使用。创建或改写本 skill 只修改本地文件；用户明确要求发布、回退、证书配置或清理时，在对应范围内完成准备、执行和验收，不重复请求同一授权。

本 skill 随仓库交付，可从任意克隆目录运行，不依赖原开发机、SSH 别名、其他仓库或另一个 skill。换机器、TLS、站外制品和故障恢复时读取 [运维说明](references/operations.md)。

## 命令与真实能力

从项目根目录运行：

```sh
python3 .agents/skills/goal-together-release/scripts/release.py plan
python3 .agents/skills/goal-together-release/scripts/release.py check
python3 .agents/skills/goal-together-release/scripts/release.py deploy --execute
python3 .agents/skills/goal-together-release/scripts/release.py status
```

支持 `--project-dir`、`--target`、`--ref`、`--identity`、`--known-hosts`，也支持 `GOAL_RELEASE_IDENTITY`。`plan` 只检查本地配置和 Git；`check/status` 不改变业务服务，但会在远端创建并自动删除控制脚本临时目录。`status` 展示资源预检和已记录的版本，不能代替实时入口验收。`deploy/tls/cleanup` 不带 `--execute` 时只展示计划。没有一键 `rollback` 子命令，回退按运维说明操作。

## 共享服务器边界

- 按 **50GB 小盘预算**维护，以现场磁盘可用量为准；不把线上主机当长期镜像仓库。默认 `keep_images=1`，验收后仅保留当前成功版本及容器引用，回滚归档留在站外。不能自行增加保留数量。
- 应用隔离测试、依赖安装和镜像构建全部在开发机完成；服务器只校验、导入、备份和切换。复用现有 Docker、Compose、唯一 NGINX 和 Certbot，不在服务器构建、不部署第二套入口代理、不升级共享组件。
- 只管理本项目 Compose、带归属标记的根目录、专用卷及目标虚拟主机。不借用其他应用数据库、凭据、端口或卷；不重启其他服务。NGINX 变更先保全目标配置，`nginx -t` 通过后 reload，失败恢复目标配置。
- SSH 只用公钥，启用批处理和严格主机密钥校验，关闭密码、交互认证和转发。指纹不匹配或认证失败时停止连接，不自动接受指纹、不复制私钥。
- 不输出真实 `.env`、数据库 URL、初始化凭证、会话、私钥或完整容器环境。必要检查仅投影非敏感字段；日志限量并脱敏。正式与演示库、会话和持久数据保持隔离。

## 发布流程与完成条件

1. 核对目标、Git 提交和工作区。实际发布只接受干净且已提交的源码；不替用户提交或丢弃已有修改。选定提交在本机归档，拒绝私有配置、缓存、数据和符号链接；服务器不接收完整源码树。
2. 执行 `check`，另核实当前应用、其他服务入口、磁盘分区、备份规模与并发操作。`minimum_free_gib=4` 只是最低门槛，还要为上传解包、镜像导入、数据库备份及运行增长留足空间；不能将通过固定门槛视为容量证明。确认其他 Agent 没有发布、上传、导入或全机清理。项目 `release.lock` 只保护服务器侧本工具的发布/清理，不能协调其他工具或上传阶段。
3. `deploy --execute` 在本机临时容器、网络及 PostgreSQL 中执行完整 `npm test`，再构建提交唯一标签的镜像。开发机持久保留 `.data/releases/<发布号>/image.tar` 与 `source.json`，其中记录归档 SHA-256、镜像 ID、架构和提交；它们是站外回滚材料，不随传输临时目录删除。发布机必须保全这些文件，换机器先转移并核验所需归档。
4. 上传应用与 PostgreSQL 基础镜像、测试和构建记录。服务器核验归档哈希、架构、镜像 ID、归属及提交，完成导入后才切换。准备期间保持旧应用运行；不预先 `stop/down`。先做正式库自定义格式备份并以 `pg_restore --list` 检查，再仅更新应用服务。单实例切换可能短暂中断。
5. 验证本机和正式 HTTPS 的 `/formal/api/session`、`/demo/api/session`，以及实际运行标签和镜像 ID。助手另外验证首页、关键静态资源与正式/演示入口；涉及业务流程时按本轮变更验收，不能用容器健康冒充业务验收，不向正式库创建测试数据。首次初始化凭证只保存在服务器私有文件，不打印。
6. 工具的接口和镜像验证通过后写入成功状态及回执，再清理旧镜像。额外验收尚未完成时，明确报告“工具验证通过，业务验收待完成”。失败时不清理恢复资源；迁移版本未改变才自动恢复上一镜像，并复验本机和 HTTPS。迁移变化或缺少上一版时保留备份与镜像，报告真实运行状态，不自动恢复数据库。

## 小盘清理

```sh
python3 .agents/skills/goal-together-release/scripts/release.py cleanup --execute
```

发布成功自动执行同一清理逻辑。默认不常驻保留三个历史镜像，也不永久保护已具备站外归档的上一版。旧工具没有站外归档记录时，上一版暂时保留并列入 `recovery_archive_pending`；先补齐可验证的站外回滚材料，再处理该缺项，不能直接伪造状态字段绕过保护。服务器临时上传包正常结束时删除，服务器发布目录不保存第二份镜像 tar。

本工具只逐个删除带项目归属标签、精确仓库名 `goal-together-app` 的旧标签；当前版本和任何现存容器引用的整个镜像 ID 都受保护，每次删除前重查引用与标签对应 ID，不使用 force。项目发布不会删除停止容器。用户已选择整机回收仅保留运行容器引用的口径；停止容器需另按整机维护流程检查可写层和发布活动，再单独清理并释放对应镜像，不能据此扩大本项目发布范围。

禁止 `docker system/volume/builder prune`、全局 `image prune -a`、`compose down -v`、通配符清理和删除数据库、卷、备份、未知文件。无标签镜像、基础镜像、共享缓存和其他仓库不属于本清理器范围；需要整机回收时转服务器维护流程，不能宣称本命令清完全部无用镜像。独立清理会先检查应用正在运行、标签与当前成功记录一致，并验证本机及 HTTPS 两个模式；失败时拒绝清理。助手还须确认无其他发布活动，所需站外归档仍可读取且哈希一致。

清理失败不回退已经健康的应用。分别报告 `removed_images`、`skipped_images`、`recovery_archive_pending`、`cleanup_error` 和剩余空间；有缺项时说明维护未完成。最终给出目标、源码/实际镜像身份、测试、备份、入口证据、清理结果和未验证项。开发机记录位于 `.data/releases/<发布号>/`，服务器记录位于 `/srv/goal-together/releases/<发布号>/`，不得提交私有记录或大文件。

## HTTPS

```sh
python3 .agents/skills/goal-together-release/scripts/release.py tls --execute --renewal-test
```

使用 Let's Encrypt 公共可信证书和现有 `certbot.timer`；续期钩子仅在本域名证书更新时校验并 reload NGINX。执行前协调其他 NGINX/证书变更，TLS 命令没有项目发布锁。未发布应用时 503 占位页是预期行为，证书就绪不能宣称应用上线。证书配置、续期演练及恢复细节见运维说明。

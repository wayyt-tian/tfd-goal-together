#!/usr/bin/env python3
"""服务器侧发布；仅操作 goal-together 的 Compose、镜像及专用目录。"""
import argparse
import fcntl
import hashlib
import json
import os
import platform
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import tls

OWNER = 'goal-together-release'
LABEL = 'ltd.tywldx.goal-together.owner'
REPOSITORY = 'goal-together-app'
ASSETS = HERE.parent / 'assets'


def run(args, capture=True, env=None, stdout=None):
    result = subprocess.run(args, text=True, env=env, stdout=stdout or (subprocess.PIPE if capture else None), stderr=subprocess.STDOUT if stdout is not None else (subprocess.PIPE if capture else None))
    if result.returncode:
        # Do not include command arguments, environment, or raw database diagnostics.
        raise RuntimeError('命令执行失败：' + args[0])
    return result.stdout or ''


def write_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def owned_root(root, create=False):
    if root.is_symlink():
        raise RuntimeError('发布目录不能是符号链接。')
    marker = root / 'owner.json'
    if root.exists() and not marker.exists() and any(root.iterdir()):
        raise RuntimeError('目录已有其他内容，缺少本项目标记，拒绝接管。')
    if marker.exists() and json.loads(marker.read_text()).get('owner') != OWNER:
        raise RuntimeError('发布目录不属于本项目。')
    if create:
        if not root.exists():
            run(['sudo', '-n', 'install', '-d', '-m', '750', '-o', str(os.getuid()), '-g', str(os.getgid()), str(root)])
        if not marker.exists():
            write_json(marker, {'owner': OWNER})
        for name in ['shared', 'releases', 'backups']:
            (root / name).mkdir(mode=0o700, exist_ok=True)


def compose(root, *args):
    return run(['docker', 'compose', '--project-name', 'goal-together', '--env-file', str(root / 'shared/runtime.env'), '-f', str(root / 'compose.yaml'), *args])


def image_env(root, image):
    file = root / 'shared/runtime.env'
    values = dict(line.split('=', 1) for line in file.read_text().splitlines() if line and not line.startswith('#'))
    values['APP_IMAGE'] = image
    temporary = file.with_suffix('.tmp')
    temporary.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
    temporary.chmod(0o600)
    temporary.replace(file)


def initialize(root, config, source):
    owned_root(root, create=True)
    runtime = root / 'shared/runtime.env'
    if not runtime.exists():
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', config['app_port']))
            except OSError:
                raise RuntimeError('应用端口已占用，拒绝首次发布。') from None
        # Reject existing Compose resources instead of adopting a developer/other app's database.
        if run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=goal-together']).strip():
            raise RuntimeError('服务器已有同名 Compose 容器，不能自动接管。')
        if run(['docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=goal-together']).strip():
            raise RuntimeError('服务器已有同名数据卷，不能自动接管。')
        runtime.write_text(f'POSTGRES_PASSWORD={secrets.token_hex(32)}\nPUBLIC_ORIGIN=https://{config["domain"]}\nAPP_PORT={config["app_port"]}\nAPP_IMAGE={REPOSITORY}:unreleased\n')
        runtime.chmod(0o600)
    else:
        values = dict(line.split('=', 1) for line in runtime.read_text().splitlines() if line and not line.startswith('#'))
        if values.get('PUBLIC_ORIGIN') != 'https://' + config['domain'] or values.get('APP_PORT') != str(config['app_port']):
            raise RuntimeError('服务器域名/端口与目标配置不同；请先评审服务器配置变更。')
    target_compose = root / 'compose.yaml'
    if target_compose.exists() and target_compose.read_bytes() != (ASSETS / 'compose.yaml').read_bytes():
        raise RuntimeError('正式 Compose 已变化；拒绝在普通发布中隐式修改数据库或卷配置。')
    if not target_compose.exists():
        shutil.copy2(ASSETS / 'compose.yaml', target_compose)
    if not (root / 'postgres-init.sql').exists():
        shutil.copy2(source / 'infra/postgres/init.sql', root / 'postgres-init.sql')


def verify_source(source, tag, log, build_args=()):
    """独立容器、网络、数据库、随机密码；绝不读取正式 runtime.env。"""
    suffix = secrets.token_hex(5)
    network, pg = 'goal-verify-' + suffix, 'goal-verify-pg-' + suffix
    image = 'goal-together-verify:' + tag
    password = secrets.token_hex(24)
    env = dict(os.environ, POSTGRES_PASSWORD=password)
    try:
        with log.open('w') as output:
            run(['docker', 'build', *build_args, '--label', LABEL + '=' + OWNER, '-f', str(ASSETS / 'verify.Dockerfile'), '-t', image, str(source)], stdout=output)
        run(['docker', 'network', 'create', '--label', LABEL + '=' + OWNER, network])
        run(['docker', 'run', '-d', '--name', pg, '--label', LABEL + '=' + OWNER, '--network', network, '--network-alias', 'postgres', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=goal_together', '-e', 'POSTGRES_DB=goal_together_test', 'postgres:16-alpine'], env=env)
        for _ in range(60):
            if subprocess.run(['docker', 'exec', pg, 'pg_isready', '-U', 'goal_together', '-d', 'goal_together_test'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('隔离测试数据库未就绪。')
        run(['docker', 'exec', pg, 'psql', '-U', 'goal_together', '-d', 'goal_together_test', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE goal_together_demo'])
        test_env = dict(os.environ, TEST_DATABASE_URL=f'postgres://goal_together:{password}@postgres:5432/goal_together_test', DEMO_DATABASE_URL=f'postgres://goal_together:{password}@postgres:5432/goal_together_demo')
        with log.open('a') as output:
            run(['docker', 'run', '--rm', '--name', 'goal-verify-app-' + suffix, '--network', network, '-e', 'TEST_DATABASE_URL', '-e', 'DEMO_DATABASE_URL', image], env=test_env, stdout=output)
    finally:
        # These unique names were generated by this invocation, not discovered globally.
        subprocess.run(['docker', 'rm', '-f', 'goal-verify-app-' + suffix, pg], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['docker', 'image', 'rm', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def check_session(origin, mode):
    with urllib.request.urlopen(origin.rstrip('/') + '/' + mode + '/api/session', timeout=8) as response:
        value = json.load(response)
        if response.status != 200 or value.get('mode') != mode or value.get('demo') != (mode == 'demo') or value.get('authenticated'):
            raise RuntimeError('正式/演示模式检查失败。')


def wait_app(config, public=False):
    origin = 'https://' + config['domain'] if public else f'http://127.0.0.1:{config["app_port"]}'
    last = None
    for _ in range(40):
        try:
            for mode in ['formal', 'demo']:
                check_session(origin, mode)
            return
        except Exception as error:
            last = error
            time.sleep(2)
    raise RuntimeError('服务验证未通过：' + type(last).__name__)


def schema_versions(root):
    return compose(root, 'exec', '-T', 'postgres', 'psql', '-U', 'goal_together', '-d', 'goal_together', '-At', '-c', "SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'empty' ELSE 'present' END").strip()


def migration_state(root):
    if schema_versions(root) == 'empty':
        return []
    return compose(root, 'exec', '-T', 'postgres', 'psql', '-U', 'goal_together', '-d', 'goal_together', '-At', '-c', 'SELECT version FROM public.schema_migrations ORDER BY version').splitlines()


def backup(root, tag):
    target = root / 'backups' / (tag + '.dump')
    with target.open('xb') as output:
        target.chmod(0o600)
        command = ['docker', 'compose', '--project-name', 'goal-together', '--env-file', str(root / 'shared/runtime.env'), '-f', str(root / 'compose.yaml'), 'exec', '-T', 'postgres', 'pg_dump', '-U', 'goal_together', '-d', 'goal_together', '--format=custom', '--no-owner', '--no-acl']
        run(command, stdout=output)
    # pg_restore reads the copied dump through stdin; no database is restored.
    with target.open('rb') as file:
        result = subprocess.run(['docker', 'run', '--rm', '-i', 'postgres:16-alpine', 'pg_restore', '--list'], stdin=file, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode or target.stat().st_size == 0:
        raise RuntimeError('发布前备份校验失败。')
    return target.name


def cleanup_plan(images, container_image_ids, keep_refs):
    remove = []
    for image in images:
        if (image.get('Config', {}).get('Labels') or {}).get(LABEL) != OWNER:
            continue
        if image['Id'] in container_image_ids:
            continue
        for tag in image.get('RepoTags') or []:
            if tag.startswith(REPOSITORY + ':') and tag not in keep_refs:
                remove.append(tag)
    return sorted(set(remove))


def cleanup(root, keep):
    if keep < 2:
        raise RuntimeError('至少保留当前和上一成功版本。')
    state = json.loads((root / 'state.json').read_text())
    keep_refs = {item['image'] for item in state.get('successful', [])[-keep:]}
    keep_refs.update(filter(None, [state.get('current'), state.get('previous')]))
    ids = run(['docker', 'ps', '-aq']).split()
    used = set(run(['docker', 'inspect', '--format', '{{.Image}}', *ids]).splitlines()) if ids else set()
    image_ids = run(['docker', 'image', 'ls', '-q', '--filter', 'label=' + LABEL + '=' + OWNER]).split()
    images = json.loads(run(['docker', 'image', 'inspect', *sorted(set(image_ids))])) if image_ids else []
    removed, skipped = [], []
    for tag in cleanup_plan(images, used, keep_refs):
        # No force: a container created after inventory still prevents image removal.
        result = subprocess.run(['docker', 'image', 'rm', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (removed if result.returncode == 0 else skipped).append(tag)
    return {'removed_images': removed, 'skipped_images': skipped, 'free_gib': round(shutil.disk_usage(root).free / 1024**3, 2)}


def load_artifact(metadata, artifacts, release):
    if metadata.get('build_location') != 'local' or artifacts is None:
        raise RuntimeError('只接受本地完成构建和验证的镜像产物。')
    image = REPOSITORY + ':' + metadata['release']
    if metadata.get('image') != image:
        raise RuntimeError('镜像标签与发布号不一致。')
    image_tar = artifacts / 'image.tar'
    digest = hashlib.sha256()
    with image_tar.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != metadata.get('image_archive_sha256'):
        raise RuntimeError('镜像归档校验失败，未导入或切换应用。')
    architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine(), platform.machine())
    if metadata.get('platform') != 'linux/' + architecture:
        raise RuntimeError('本地镜像架构与服务器不一致。')
    run(['docker', 'image', 'load', '-i', str(image_tar)])
    info = json.loads(run(['docker', 'image', 'inspect', image]))[0]
    labels = info.get('Config', {}).get('Labels') or {}
    if info['Id'] != metadata.get('image_id') or info['Os'] + '/' + info['Architecture'] != metadata['platform'] or labels.get(LABEL) != OWNER or labels.get('org.opencontainers.image.revision') != metadata['commit']:
        raise RuntimeError('导入镜像的身份、归属或源码提交校验失败。')
    for name in ['verification.log', 'build.log']:
        shutil.copy2(artifacts / name, release / name)


def deploy(config, source, metadata, artifacts=None):
    root = Path(config['root'])
    initialize(root, config, source)
    tag = metadata['release']
    release = root / 'releases' / tag
    release.mkdir(mode=0o700, exist_ok=False)
    image = REPOSITORY + ':' + tag
    state_file = root / 'state.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {'successful': []}
    prior = state.get('current')
    print('开始校验和导入本地构建镜像，服务器不执行构建。', flush=True)
    load_artifact(metadata, artifacts, release)
    # Retain only executable release control, not another entire copy of source/dependencies.
    write_json(release / 'source.json', metadata)
    if not compose(root, 'ps', '-aq', 'postgres').strip():
        compose(root, 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres')
    else:
        compose(root, 'start', 'postgres')
        for _ in range(60):
            if subprocess.run(['docker', 'compose', '--project-name', 'goal-together', '--env-file', str(root / 'shared/runtime.env'), '-f', str(root / 'compose.yaml'), 'exec', '-T', 'postgres', 'pg_isready', '-U', 'goal_together'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('正式数据库未就绪。')
    before = migration_state(root)
    backup_name = backup(root, tag)
    image_env(root, image)
    try:
        compose(root, 'up', '-d', '--no-deps', 'app')
        wait_app(config)
        tls.configure(config['domain'], config['app_port'], config['host'], activate=True)
        wait_app(config, public=True)
        actual = compose(root, 'ps', '-q', 'app').strip()
        actual_image = run(['docker', 'inspect', '--format', '{{.Config.Image}}', actual]).strip()
        if actual_image != image:
            raise RuntimeError('运行镜像与发布版本不一致。')
        if run(['docker', 'inspect', '--format', '{{.Image}}', actual]).strip() != metadata['image_id']:
            raise RuntimeError('运行镜像 ID 与本地构建产物不一致。')
    except Exception:
        compose(root, 'stop', 'app')
        after = migration_state(root)
        if prior and before == after:
            image_env(root, prior)
            compose(root, 'up', '-d', '--no-deps', 'app')
            wait_app(config)
            print('发布失败，数据库迁移版本未变，已恢复上一镜像。', file=sys.stderr)
        else:
            print('发布失败；缺少上一版本或数据库迁移已变化，未自动回退数据库。保留镜像和备份：' + backup_name, file=sys.stderr)
        raise
    entry = dict(metadata, image=image, backup=backup_name, migrations=migration_state(root))
    state['previous'], state['current'] = prior, image
    state['successful'].append(entry)
    write_json(state_file, state)
    receipt = dict(entry, origin='https://' + config['domain'], previous=prior, status='published')
    # Persist the healthy release before optional disk housekeeping.
    write_json(release / 'receipt.json', receipt)
    try:
        receipt.update(cleanup(root, config['keep_images']))
    except Exception as error:
        receipt['cleanup_error'] = type(error).__name__
        print('应用发布成功，但镜像清理失败；可单独重试 cleanup。', file=sys.stderr)
    write_json(release / 'receipt.json', receipt)
    print(json.dumps(receipt, ensure_ascii=False))


def preflight(config, require_space=False):
    for command in [['docker', 'version', '--format', '{{.Server.Version}}'], ['docker', 'compose', 'version'], ['sudo', '-n', 'true']]:
        run(command)
    root = Path(config['root'])
    owned_root(root)
    available = shutil.disk_usage(root if root.exists() else root.parent).free / 1024**3
    if require_space and available < config['minimum_free_gib']:
        raise RuntimeError('磁盘空间不足，拒绝在验证成功前自动清理历史镜像。')
    return {'host': config['host'], 'domain': config['domain'], 'root': str(root), 'free_gib': round(available, 2), 'initialized': (root / 'owner.json').exists()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'status', 'tls', 'deploy', 'cleanup'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--source')
    parser.add_argument('--metadata')
    parser.add_argument('--artifacts')
    parser.add_argument('--renewal-test', action='store_true')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    if args.action == 'tls':
        tls.configure(config['domain'], config['app_port'], config['host'], renewal_test=args.renewal_test)
        return
    inventory = preflight(config, require_space=args.action == 'deploy')
    if args.action in ['check', 'status']:
        state = Path(config['root']) / 'state.json'
        if state.exists():
            inventory['state'] = json.loads(state.read_text())
        print(json.dumps(inventory, ensure_ascii=False))
        return
    owned_root(Path(config['root']), create=args.action == 'deploy')
    with (Path(config['root']) / 'release.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('另一个发布或清理正在执行。')
        if args.action == 'cleanup':
            print(json.dumps(cleanup(Path(config['root']), config['keep_images']), ensure_ascii=False))
        else:
            deploy(config, Path(args.source), json.loads(Path(args.metadata).read_text()), Path(args.artifacts))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('发布工具已停止：' + str(error), file=sys.stderr)
        sys.exit(1)

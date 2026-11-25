#!/usr/bin/env python3
"""从任意机器通过 SSH 发布已提交的目标共创台代码；本机只需 Python 3、Git 和 OpenSSH。"""
import argparse
from datetime import datetime, timezone
import io
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(HERE))
from tls import validate_domain

BOOTSTRAP = '''import pathlib,subprocess,sys,tarfile,tempfile
with tempfile.TemporaryDirectory(prefix="goal-release-") as temporary:
 root=pathlib.Path(temporary)
 with tarfile.open(fileobj=sys.stdin.buffer,mode="r|gz") as archive:
  for member in archive:
   path=pathlib.PurePosixPath(member.name)
   if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
    raise SystemExit("拒绝不安全的发布归档路径")
   archive.extract(member,root)
 command=[sys.executable,str(root/"control/scripts/server.py"),sys.argv[1],"--config",str(root/"control/target.json")]
 if sys.argv[1]=="deploy":command += ["--source",str(root/"source"),"--metadata",str(root/"control/source.json")]
 if "--renewal-test" in sys.argv[2:]:command += ["--renewal-test"]
 raise SystemExit(subprocess.call(command))
'''


def git(project, *args):
    result = subprocess.run(['git', '-C', str(project), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Git 检查失败，请确认项目目录和提交引用。')
    return result.stdout


def find_project(start):
    for directory in [start, *start.parents]:
        package = directory / 'package.json'
        if package.exists() and json.loads(package.read_text()).get('name') == 'goal-together':
            return directory
    raise RuntimeError('找不到目标共创台仓库；请使用 --project-dir 指定克隆后的项目目录。')


def validate_config(config):
    ipaddress.ip_address(config['host'])
    validate_domain(config['domain'])
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*', config['user']):
        raise ValueError('SSH 用户名不正确。')
    if not 1 <= config['ssh_port'] <= 65535 or not 1024 <= config['app_port'] <= 65535:
        raise ValueError('端口范围不正确。')
    root = PurePosixPath(config['root'])
    if not root.is_absolute() or '..' in root.parts or len(root.parts) < 3:
        raise ValueError('发布目录必须是独立的绝对目录，例如 /srv/goal-together。')
    if config['keep_images'] < 2 or config['minimum_free_gib'] < 1:
        raise ValueError('至少保留两个发布镜像，并预留一 GiB 磁盘空间。')
    return config


def safe_source_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        return False
    forbidden = {'.git', '.data', 'node_modules', '__pycache__', 'test-results', 'playwright-report'}
    if forbidden.intersection(path.parts) or path.parts[:2] == ('web', 'dist'):
        return False
    if any(part.startswith('.env') and part != '.env.example' for part in path.parts):
        return False
    if path.suffix in {'.dump', '.sqlite', '.db', '.key', '.pem', '.p12'}:
        return False
    if path.name in {'setup-token.json', 'runtime.env', 'credentials.json', 'auth.json'}:
        return False
    return True


def add_bytes(archive, name, content):
    info = tarfile.TarInfo(name)
    info.size = len(content)
    info.mode = 0o600
    archive.addfile(info, io.BytesIO(content))


def make_bundle(project, commit, config, metadata, destination, source=False):
    with tarfile.open(destination, 'w:gz') as output:
        for name in ['server.py', 'tls.py']:
            add_bytes(output, 'control/scripts/' + name, (HERE / name).read_bytes())
        for name in ['compose.yaml', 'verify.Dockerfile']:
            add_bytes(output, 'control/assets/' + name, (SKILL / 'assets' / name).read_bytes())
        add_bytes(output, 'control/target.json', json.dumps(config).encode())
        add_bytes(output, 'control/source.json', json.dumps(metadata).encode())
        if source:
            raw = git(project, 'archive', '--format=tar', commit)
            with tarfile.open(fileobj=io.BytesIO(raw)) as incoming:
                for member in incoming:
                    if not safe_source_path(member.name) or not (member.isfile() or member.isdir()):
                        raise RuntimeError('提交包含不能交付的路径或链接：' + member.name)
                    contents = incoming.extractfile(member) if member.isfile() else None
                    member.name = 'source/' + member.name
                    output.addfile(member, contents)


def ssh_command(config, identity=None, known_hosts=None):
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-p', str(config['ssh_port'])]
    if identity:
        command += ['-i', str(Path(identity).expanduser())]
    if known_hosts:
        command += ['-o', 'UserKnownHostsFile=' + str(Path(known_hosts).expanduser())]
    command += [config['user'] + '@' + config['host']]
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'check', 'status', 'tls', 'deploy', 'cleanup'])
    parser.add_argument('--project-dir', type=Path)
    parser.add_argument('--target', type=Path, help='公开目标配置；默认项目 deploy/production.json')
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--identity', default=os.environ.get('GOAL_RELEASE_IDENTITY'))
    parser.add_argument('--known-hosts')
    parser.add_argument('--execute', action='store_true', help='执行已获用户授权的服务器写操作；省略时仅展示计划')
    parser.add_argument('--renewal-test', action='store_true')
    args = parser.parse_args()
    project = find_project((args.project_dir or Path.cwd()).resolve())
    target = args.target or project / 'deploy/production.json'
    config = validate_config(json.loads(target.read_text()))
    commit = git(project, 'rev-parse', '--verify', args.ref + '^{commit}').decode().strip()
    dirty = bool(git(project, 'status', '--porcelain').strip())
    metadata = {'commit': commit, 'release': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + commit[:12]}
    plan = dict(config, **metadata, working_tree_has_changes=dirty, action=args.action)
    mutate = args.action in ['deploy', 'tls', 'cleanup']
    if args.action == 'plan' or (mutate and not args.execute):
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        if mutate:
            print('仅显示计划。实际执行请在获得用户发布/证书/清理授权后增加 --execute。')
        return
    if args.action == 'deploy' and dirty:
        raise RuntimeError('发布仅接受干净、已提交的 Git 源码；请先审查并提交本次发布内容。')
    with tempfile.TemporaryDirectory(prefix='goal-release-client-') as temporary:
        bundle = Path(temporary) / 'release.tar.gz'
        make_bundle(project, commit, config, metadata, bundle, source=args.action == 'deploy')
        command = ssh_command(config, args.identity, args.known_hosts)
        remote = ['python3', '-c', BOOTSTRAP, args.action]
        if args.renewal_test:
            remote.append('--renewal-test')
        command.append(' '.join(shlex.quote(part) for part in remote))
        with bundle.open('rb') as data:
            result = subprocess.run(command, stdin=data)
        if result.returncode:
            raise RuntimeError('远程操作失败；未宣告发布成功。请检查 SSH 或服务器发布记录。')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print('发布工具已停止：' + str(error), file=sys.stderr)
        sys.exit(1)

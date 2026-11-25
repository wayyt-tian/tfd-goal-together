#!/usr/bin/env python3
"""只管理目标共创台的 Nginx 站点、证书和域名限定的续期钩子。"""
import argparse
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile

MARKER = '# Managed by goal-together-release'


def run(args, capture=False):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        raise RuntimeError('命令失败：' + args[0])
    return result.stdout if capture else ''


def validate_domain(domain):
    if not re.fullmatch(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', domain) or '..' in domain or '.' not in domain:
        raise ValueError('域名格式不正确。')
    return domain


def render_site(domain, port, tls=False, activate=False):
    validate_domain(domain)
    if not 1024 <= port <= 65535:
        raise ValueError('应用端口必须位于 1024–65535。')
    challenge = 'location ^~ /.well-known/acme-challenge/ { root /var/lib/goal-together-acme; }'
    redirect = 'return 301 https://$host$request_uri;' if tls else 'default_type text/plain; return 503 "工作台尚未发布。\\n";'
    content = f'''{MARKER}
server {{
    listen 80;
    server_name {domain};
    {challenge}
    location / {{ {redirect} }}
}}
'''
    if tls:
        upstream = f'''proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;''' if activate else 'default_type text/plain; return 503 "工作台尚未发布。\\n";'
        content += f'''server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 10m;
    location / {{
        {upstream}
    }}
}}
'''
    return content


def deploy_hook(domain):
    validate_domain(domain)
    return f'''#!/bin/sh
# Managed by goal-together-release; only reload after this domain renews.
case " ${{RENEWED_DOMAINS:-}} " in
  *" {domain} "*) /usr/sbin/nginx -t && /bin/systemctl reload nginx ;;
esac
'''


def install(content, destination, mode='644'):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8') as file:
        file.write(content)
        file.flush()
        run(['sudo', '-n', 'install', '-m', mode, file.name, str(destination)])


def configure(domain, port, expected_ip, activate=False, renewal_test=False):
    validate_domain(domain)
    addresses = {entry[4][0] for entry in socket.getaddrinfo(domain, 80)}
    if expected_ip not in addresses:
        raise RuntimeError('域名尚未解析到目标服务器；没有修改 Nginx。')
    if any(address != expected_ip for address in addresses):
        raise RuntimeError('域名同时解析到其他地址，请先确认全部地址均能提供本项目的证书挑战。')
    site = Path('/etc/nginx/sites-available/goal-together')
    enabled = Path('/etc/nginx/sites-enabled/goal-together')
    hook = Path('/etc/letsencrypt/renewal-hooks/deploy/goal-together-reload')
    if hook.exists() and MARKER not in hook.read_text():
        raise RuntimeError('同名证书续期钩子不属于此 skill。')
    previous = site.read_text() if site.exists() else None
    if previous is not None and MARKER not in previous:
        raise RuntimeError('同名 Nginx 配置不属于此 skill，拒绝覆盖。')
    if enabled.exists() or enabled.is_symlink():
        if not enabled.is_symlink() or enabled.resolve() != site:
            raise RuntimeError('同名 Nginx 启用项不属于此 skill。')
    # Read only server_name directives, never export another site's configuration.
    for directory in ['/etc/nginx/sites-enabled', '/etc/nginx/conf.d']:
        for other in Path(directory).glob('*'):
            if other.resolve() == site or not other.is_file():
                continue
            contents = run(['sudo', '-n', 'cat', str(other)], capture=True)
            names = re.findall(r'^\s*server_name\s+([^;]+);', contents, re.M)
            if any(domain in nameset.split() for nameset in names):
                raise RuntimeError('该域名已由其他 Nginx 文件管理，拒绝创建重复站点。')
    activate = activate or bool(previous and 'proxy_pass ' in previous)
    run(['sudo', '-n', 'nginx', '-t'])
    run(['sudo', '-n', 'install', '-d', '-m', '755', '/var/lib/goal-together-acme'])
    if previous is None:
        install(render_site(domain, port), site)
    if not enabled.is_symlink():
        run(['sudo', '-n', 'ln', '-s', str(site), str(enabled)])
    try:
        run(['sudo', '-n', 'nginx', '-t'])
        run(['sudo', '-n', 'systemctl', 'reload', 'nginx'])
        run(['sudo', '-n', 'certbot', 'certonly', '--webroot', '-w', '/var/lib/goal-together-acme', '--cert-name', domain, '-d', domain, '--non-interactive', '--agree-tos', '--keep-until-expiring'])
        install(render_site(domain, port, tls=True, activate=activate), site)
        run(['sudo', '-n', 'nginx', '-t'])
        run(['sudo', '-n', 'systemctl', 'reload', 'nginx'])
    except Exception:
        if previous is not None:
            install(previous, site)
        else:
            run(['sudo', '-n', 'rm', '-f', str(enabled), str(site)])
        run(['sudo', '-n', 'nginx', '-t'])
        run(['sudo', '-n', 'systemctl', 'reload', 'nginx'])
        raise
    install(deploy_hook(domain), hook, '755')
    run(['sudo', '-n', 'systemctl', 'enable', '--now', 'certbot.timer'])
    if renewal_test:
        run(['sudo', '-n', 'certbot', 'renew', '--cert-name', domain, '--dry-run'])
        # Certbot 1.21 has no --run-deploy-hooks; exercise this domain's hook separately.
        run(['sudo', '-n', 'env', 'RENEWED_DOMAINS=' + domain, str(hook)])
    print('HTTPS 已配置，续期由 certbot.timer 执行；站点状态：' + ('反向代理' if activate else '等待应用发布'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', required=True)
    parser.add_argument('--port', type=int, default=4182)
    parser.add_argument('--expected-ip', required=True)
    parser.add_argument('--activate', action='store_true')
    parser.add_argument('--renewal-test', action='store_true')
    args = parser.parse_args()
    configure(args.domain, args.port, args.expected_ip, args.activate, args.renewal_test)

#!/usr/bin/env python3
"""发布工具的行为验证；临时 Git 仓库及模拟容器，绝不操作正式服务。"""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / '.agents/skills/goal-together-release/scripts'
sys.path.insert(0, str(SCRIPTS))
import release
import server
import tls

CONFIG = json.loads((ROOT / 'deploy/production.json').read_text())


class ReleaseTests(unittest.TestCase):
    def test_portable_archive_uses_commit_not_private_or_uncommitted_files(self):
        with tempfile.TemporaryDirectory(prefix='换机器 发布 ') as temporary:
            project = Path(temporary)
            subprocess.run(['git', 'init', '-q', str(project)], check=True)
            (project / 'package.json').write_text('{"name":"goal-together"}')
            (project / 'app.txt').write_text('committed')
            subprocess.run(['git', '-C', str(project), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(project), '-c', 'user.name=测试', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            commit = release.git(project, 'rev-parse', 'HEAD').decode().strip()
            (project / '.env').write_text('DO_NOT_SHIP=private')
            (project / 'app.txt').write_text('uncommitted')
            destination = project / 'bundle.tar.gz'
            release.make_bundle(project, commit, CONFIG, {'commit': commit, 'release': 'fixture'}, destination, source=True)
            with tarfile.open(destination) as archive:
                self.assertNotIn('source/.env', archive.getnames())
                self.assertEqual(archive.extractfile('source/app.txt').read(), b'committed')
                self.assertIn('control/scripts/server.py', archive.getnames())
                self.assertIn('control/scripts/tls.py', archive.getnames())
                self.assertIn('control/assets/compose.yaml', archive.getnames())
                payload = archive.extractfile('control/target.json').read()
                self.assertNotIn(b'/home/tian', payload)
            self.assertEqual(release.find_project(project), project)

    def test_unsafe_or_private_source_paths_are_rejected(self):
        for name in ['../escape', '/tmp/escape', '.env', '.env.production', '.data/secret', 'x/runtime.env', 'x/private.pem', 'x/backup.dump', 'node_modules/x', 'web/dist/a.js']:
            self.assertFalse(release.safe_source_path(name), name)
        for name in ['.env.example', '.agents/skills/goal-together-release/SKILL.md', 'src/server.cjs']:
            self.assertTrue(release.safe_source_path(name), name)

    def test_receiver_rejects_symlinks_and_traversal_before_running_server(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('source/link', tarfile.SYMTYPE)]:
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w:gz') as archive:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/tmp/unowned'
                archive.addfile(member)
            result = subprocess.run([sys.executable, '-c', release.BOOTSTRAP, 'check'], input=data.getvalue(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('拒绝不安全', result.stderr.decode())

    def test_ssh_has_no_developer_identity_or_disabled_host_verification(self):
        args = release.ssh_command(CONFIG)
        self.assertIn('StrictHostKeyChecking=yes', args)
        self.assertNotIn('-i', args)
        self.assertNotIn('/home/tian', ' '.join(args))

    def test_bad_targets_are_rejected(self):
        for changes in [{'domain': 'goal.test; touch /tmp/pwn'}, {'user': 'ubuntu\nroot'}, {'root': '/srv'}, {'root': '/srv/../etc'}, {'keep_images': 1}]:
            with self.assertRaises((ValueError, KeyError)):
                release.validate_config(dict(CONFIG, **changes))

    def test_image_cleanup_keeps_current_previous_and_all_container_references(self):
        def image(identifier, tags, owner=server.OWNER):
            return {'Id': identifier, 'RepoTags': tags, 'Config': {'Labels': {server.LABEL: owner}}}
        images = [
            image('active', ['goal-together-app:current', 'goal-together-app:alias']),
            image('old', ['goal-together-app:previous']),
            image('stopped-container', ['goal-together-app:ancient']),
            image('unused', ['goal-together-app:expired', 'unrelated-app:same-id']),
            image('foreign', ['goal-together-app:foreign'], owner='someone-else'),
            {'Id': 'null-labels', 'RepoTags': ['goal-together-app:null'], 'Config': {'Labels': None}},
            image('similar-prefix', ['goal-together-app-other:old'])]
        plan = server.cleanup_plan(images, {'active', 'stopped-container'}, {'goal-together-app:current', 'goal-together-app:previous'})
        self.assertEqual(plan, ['goal-together-app:expired'])

    def test_cleanup_uses_individual_non_force_removals(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'state.json').write_text(json.dumps({'current': 'goal-together-app:new', 'previous': 'goal-together-app:old', 'successful': [{'image': 'goal-together-app:old'}, {'image': 'goal-together-app:new'}]}))
            def fake_run(args, **kwargs):
                if args[1:3] == ['ps', '-aq']: return 'stopped\n'
                if args[1] == 'inspect': return 'in-use-id\n'
                if args[1:3] == ['image', 'ls']: return 'expired-id\nin-use-id\n'
                return json.dumps([{'Id': 'expired-id', 'RepoTags': ['goal-together-app:expired'], 'Config': {'Labels': {server.LABEL: server.OWNER}}}, {'Id': 'in-use-id', 'RepoTags': ['goal-together-app:in-use'], 'Config': {'Labels': {server.LABEL: server.OWNER}}}])
            with patch.object(server, 'run', side_effect=fake_run), patch.object(server.subprocess, 'run', return_value=Mock(returncode=0)) as mutate:
                result = server.cleanup(root, 3)
                self.assertEqual(result['removed_images'], ['goal-together-app:expired'])
                self.assertEqual(mutate.call_args.args[0], ['docker', 'image', 'rm', 'goal-together-app:expired'])
            with self.assertRaises(RuntimeError): server.cleanup(root, 1)

    def test_nginx_holding_page_and_scoped_renewal_hook(self):
        content = tls.render_site(CONFIG['domain'], CONFIG['app_port'], tls=True)
        self.assertIn('return 503', content)
        self.assertNotIn('proxy_pass', content)
        active = tls.render_site(CONFIG['domain'], CONFIG['app_port'], tls=True, activate=True)
        self.assertIn('proxy_pass http://127.0.0.1:4182;', active)
        self.assertIn('proxy_buffering off;', active)
        hook = tls.deploy_hook(CONFIG['domain'])
        result = subprocess.run(['sh', '-c', hook], env={'RENEWED_DOMAINS': 'unrelated.example'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'')

    def check_failure_rollback(self, changed):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'releases').mkdir()
            old = {'current': 'goal-together-app:old', 'successful': [{'image': 'goal-together-app:old'}]}
            (root / 'state.json').write_text(json.dumps(old))
            config = dict(CONFIG, root=str(root))
            metadata = {'commit': 'a' * 40, 'release': 'fixture'}
            with patch.object(server, 'initialize'), patch.object(server, 'verify_source'), patch.object(server, 'run'), patch.object(server, 'compose', return_value=''), patch.object(server, 'migration_state', side_effect=[['001'], ['001', '002'] if changed else ['001']]), patch.object(server, 'backup', return_value='fixture.dump'), patch.object(server, 'image_env') as select_image, patch.object(server, 'wait_app', side_effect=[None, RuntimeError('HTTPS check failed'), None]), patch.object(server.tls, 'configure'), patch.object(server, 'cleanup') as cleanup:
                with self.assertRaises(RuntimeError): server.deploy(config, root, metadata)
                images = [call.args[1] for call in select_image.call_args_list]
                self.assertEqual(images, ['goal-together-app:fixture'] if changed else ['goal-together-app:fixture', 'goal-together-app:old'])
                cleanup.assert_not_called()
                self.assertEqual(json.loads((root / 'state.json').read_text()), old)

    def test_failed_release_rolls_back_only_with_unchanged_migrations(self):
        self.check_failure_rollback(False)

    def test_failed_migration_release_keeps_backup_and_does_not_rollback_database(self):
        self.check_failure_rollback(True)

    def test_success_is_recorded_before_cleanup_and_survives_cleanup_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'releases').mkdir()
            config = dict(CONFIG, root=str(root))
            metadata = {'commit': 'a' * 40, 'release': 'fixture'}
            def failed_cleanup(*args):
                state = json.loads((root / 'state.json').read_text())
                receipt = json.loads((root / 'releases/fixture/receipt.json').read_text())
                self.assertEqual(state['current'], 'goal-together-app:fixture')
                self.assertEqual(receipt['status'], 'published')
                raise OSError('docker unavailable during cleanup')
            with patch.object(server, 'initialize'), patch.object(server, 'verify_source'), patch.object(server, 'run', return_value='goal-together-app:fixture'), patch.object(server, 'compose', return_value=''), patch.object(server, 'migration_state', return_value=['001']), patch.object(server, 'backup', return_value='fixture.dump'), patch.object(server, 'image_env'), patch.object(server, 'wait_app'), patch.object(server.tls, 'configure'), patch.object(server, 'cleanup', side_effect=failed_cleanup):
                server.deploy(config, root, metadata)
            receipt = json.loads((root / 'releases/fixture/receipt.json').read_text())
            self.assertEqual(receipt['status'], 'published')
            self.assertEqual(receipt['cleanup_error'], 'OSError')


if __name__ == '__main__':
    unittest.main(verbosity=2)

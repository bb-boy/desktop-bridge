"""Native package/extraction tests. Fixture installers never install an agent."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
import zipfile

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/package-downloads.py'
spec = importlib.util.spec_from_file_location('downloads', SCRIPT)
downloads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloads)


class StandaloneTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bridge-setup 'quoted-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        helper = pathlib.Path(__file__).resolve().parents[1] / 'client' / 'choose-install-mode.sh'
        (self.source / 'assets/client').mkdir(parents=True)
        shutil.copyfile(helper, self.source / 'assets/client/choose-install-mode.sh')
        (self.root / 'home').mkdir()
        self.env_home = str(self.root / 'home')
        (self.source / 'Install.sh').write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_RESULT"\nexit "${FIXTURE_EXIT:-0}"\n')
        self.result = self.root / 'result'
        self.env = dict(os.environ, FIXTURE_RESULT=str(self.result),
                        HOME=self.env_home, XDG_DATA_HOME=str(self.root / 'user-data'))
        self.env.pop('DESKTOP_BRIDGE_INSTALL_MODE', None)

    def linux_fixture(self):
        binary = self.root / 'bin'
        binary.mkdir()
        (binary / 'uname').write_text('#!/bin/sh\nprintf "Linux\\n"\n')
        (binary / 'uname').chmod(0o755)
        self.env['PATH'] = str(binary) + os.pathsep + os.environ.get('PATH', '/usr/bin:/bin')
        self.env['TMPDIR'] = str(self.root)
        installer = self.root / 'download.sh'
        installer.write_text(downloads.render('linux.sh.in', downloads.linux_payload(self.source)))
        return installer

    @unittest.skipIf(os.name == 'nt', 'POSIX shell required')
    def test_self_extracts_with_selected_manual_mode_and_cleans_up(self):
        installer = self.linux_fixture()
        self.env['DESKTOP_BRIDGE_INSTALL_MODE'] = 'manual'
        p = subprocess.run(['/bin/sh', str(installer)], env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.result.read_text().splitlines(), ['--mode', 'manual'])
        self.assertEqual(list(self.root.glob('desktop-bridge-setup.*')), [])

    @unittest.skipIf(os.name == 'nt', 'POSIX shell required')
    def test_linux_refuses_unselected_noninteractive_install(self):
        installer = self.linux_fixture()
        p = subprocess.run(['/bin/sh', str(installer)], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('DESKTOP_BRIDGE_INSTALL_MODE', p.stderr)
        self.assertFalse(self.result.exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX shell required')
    def test_linux_respects_explicit_background_mode_and_prior_choice(self):
        installer = self.linux_fixture()
        self.env['DESKTOP_BRIDGE_INSTALL_MODE'] = 'background'
        p = subprocess.run(['/bin/sh', str(installer)], env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.result.read_text().splitlines(), ['--mode', 'background'])
        self.env.pop('DESKTOP_BRIDGE_INSTALL_MODE')
        settings = pathlib.Path(self.env['XDG_DATA_HOME']) / 'desktop-bridge/client-settings.json'
        settings.parent.mkdir(parents=True)
        settings.write_text('{"mode":"background"}')
        p = subprocess.run(['/bin/sh', str(installer)], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0, 'saved background mode must not auto-select for a reinstall')
        self.assertIn('DESKTOP_BRIDGE_INSTALL_MODE', p.stderr)

    @unittest.skipIf(os.name == 'nt', 'POSIX shell required')
    def test_posix_mode_selector_supports_both_platforms_and_rejects_bad_override(self):
        selector = self.source / 'assets/client/choose-install-mode.sh'
        for platform in ('darwin', 'linux'):
            p = subprocess.run(['/bin/sh', str(selector), platform], env=self.env,
                               input='', capture_output=True, text=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('DESKTOP_BRIDGE_INSTALL_MODE', p.stderr)
            settings = (pathlib.Path(self.env['HOME']) / 'Library/Application Support/DesktopBridge/client-settings.json'
                        if platform == 'darwin'
                        else pathlib.Path(self.env['XDG_DATA_HOME']) / 'desktop-bridge/client-settings.json')
            settings.parent.mkdir(parents=True, exist_ok=True)
            settings.write_text('{"mode":"background","version":"0.2.6"}')
            p = subprocess.run(['/bin/sh', str(selector), platform], env=self.env,
                               input='', capture_output=True, text=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('DESKTOP_BRIDGE_INSTALL_MODE', p.stderr)
            env = dict(self.env, DESKTOP_BRIDGE_INSTALL_MODE='manual')
            p = subprocess.run(['/bin/sh', str(selector), platform], env=env,
                               input='', capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(p.stdout.strip(), 'manual')
            env['DESKTOP_BRIDGE_INSTALL_MODE'] = 'administrator'
            p = subprocess.run(['/bin/sh', str(selector), platform], env=env,
                               input='', capture_output=True, text=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('manual or background', p.stderr)

    @unittest.skipIf(os.name == 'nt', 'POSIX PTY required')
    def test_interactive_mode_requires_number_after_blank_answer(self):
        import pty
        selector = self.source / 'assets/client/choose-install-mode.sh'
        for platform in ('darwin', 'linux'):
            with self.subTest(platform=platform):
                master, slave = pty.openpty()
                try:
                    p = subprocess.Popen(['/bin/sh', str(selector), platform], stdin=slave,
                                         stdout=subprocess.PIPE, stderr=slave, env=self.env)
                    os.close(slave)
                    slave = -1
                    os.write(master, b'\n2\n')
                    selected, _ = p.communicate(timeout=10)
                    self.assertEqual(p.returncode, 0)
                    self.assertEqual(selected.decode().strip(), 'background',
                                     'blank Enter must not silently select manual')
                finally:
                    if slave >= 0:
                        os.close(slave)
                    os.close(master)

    @unittest.skipIf(os.name == 'nt', 'POSIX shell required')
    def test_corrupted_payload_never_executes(self):
        installer = self.linux_fixture()
        text = installer.read_text()
        before, payload = text.split('\n__DESKTOP_BRIDGE_PAYLOAD__\n', 1)
        data = bytearray(base64.b64decode(payload));data[-1] ^= 1
        installer.write_text(before + '\n__DESKTOP_BRIDGE_PAYLOAD__\n' + base64.encodebytes(data).decode())
        p = subprocess.run(['/bin/sh', str(installer)], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('校验失败', p.stderr)
        self.assertFalse(self.result.exists())
        self.assertEqual(list(self.root.glob('desktop-bridge-setup.*')), [])

    @unittest.skipIf(os.name == 'nt', 'POSIX shell required')
    def test_install_failure_is_reported_and_preserved(self):
        installer = self.linux_fixture()
        self.env['FIXTURE_EXIT'] = '17'
        self.env['DESKTOP_BRIDGE_INSTALL_MODE'] = 'manual'
        p = subprocess.run(['/bin/sh', str(installer)], env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 17)
        self.assertIn('安装未完成', p.stderr)
        self.assertEqual(list(self.root.glob('desktop-bridge-setup.*')), [])

    @unittest.skipUnless(sys.platform == 'darwin', 'Mac app staging test')
    def test_macos_app_runs_fixture_without_chmod_or_node(self):
        root, scripts = downloads.stage_macos(self.source, self.root / 'stage', '0.2.6')
        app = root / 'Applications/Desktop Bridge Setup.app/Contents'
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        self.assertEqual(info['CFBundleExecutable'], 'DesktopBridgeSetup')
        self.assertTrue(os.access(app / 'MacOS/DesktopBridgeSetup', os.X_OK))
        self.assertTrue(os.access(scripts / 'postinstall', os.X_OK))
        p = subprocess.run(['/bin/sh', str(app / 'Resources/Install.command')], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0, 'Mac must ask users to select a mode')
        self.assertFalse(self.result.exists())
        self.env['DESKTOP_BRIDGE_INSTALL_MODE'] = 'manual'
        p = subprocess.run(['/bin/sh', str(app / 'Resources/Install.command')], env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.result.read_text().splitlines(), ['--mode', 'manual'])
        text = (scripts / 'postinstall').read_text()
        self.assertIn('/usr/bin/sudo -H -u "$USER_NAME"', text)
        self.assertNotIn('Install.sh', text, 'root postinstall must not execute the actual installer')
        self.env['DESKTOP_BRIDGE_INSTALL_MODE'] = 'background'
        p = subprocess.run(['/bin/sh', str(app / 'Resources/Install.command')], env=self.env,
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.result.read_text().splitlines(), ['--mode', 'background'])

    @unittest.skipUnless(os.name == 'nt', 'Windows native execution test')
    def test_windows_executes_fixture_and_cleans_up(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('fixture/assets/client/install.ps1', "param([string]$Mode)\n[IO.File]::WriteAllText($env:FIXTURE_RESULT,$Mode)\nexit 0\n")
        installer = self.root / 'download.cmd'
        installer.write_bytes(downloads.render('windows.cmd.in', output.getvalue()).replace('\n', '\r\n').encode())
        self.env['TEMP'] = str(self.root)
        self.env['TMP'] = str(self.root)
        for mode in ('manual', 'background'):
            with self.subTest(mode=mode):
                self.env['DESKTOP_BRIDGE_INSTALL_MODE'] = mode
                p = subprocess.run([os.environ.get('ComSpec', 'cmd.exe'), '/d', '/c', str(installer)],
                                   env=self.env, input='', capture_output=True, text=True, timeout=30)
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertEqual(self.result.read_text(), mode)
                self.assertIn('Common commands (Windows CMD):', p.stdout)
                self.assertIn('Start.cmd', p.stdout)
                self.assertIn('Stop.cmd', p.stdout)
                self.assertIn('control.ps1', p.stdout)
                self.assertEqual(list(self.root.glob('desktop-bridge-setup-*')), [])

    @unittest.skipUnless(os.name == 'nt', 'Windows native execution test')
    def test_windows_noninteractive_requires_explicit_mode(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('fixture/assets/client/install.ps1', 'exit 0\n')
        installer = self.root / 'no-default.cmd'
        installer.write_bytes(downloads.render('windows.cmd.in', output.getvalue()).replace('\n', '\r\n').encode())
        self.env['TEMP'] = str(self.root)
        self.env['TMP'] = str(self.root)
        self.env.pop('DESKTOP_BRIDGE_INSTALL_MODE', None)
        p = subprocess.run([os.environ.get('ComSpec', 'cmd.exe'), '/d', '/c', str(installer)],
                           env=self.env, input='', capture_output=True, text=True, timeout=30)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('DESKTOP_BRIDGE_INSTALL_MODE', p.stdout + p.stderr)

    def test_windows_payload_is_complete_and_checked(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('desktop-bridge-p111/assets/client/install.ps1', 'exit 0\n')
        payload = output.getvalue()
        text = downloads.render('windows.cmd.in', payload)
        content = text.split("$payload = @'\n", 1)[1].split("\n'@", 1)[0]
        self.assertEqual(base64.b64decode(content), payload)
        self.assertIn(hashlib.sha256(payload).hexdigest(), text)
        self.assertLess(text.index('Get-FileHash'), text.index('Expand-Archive'))
        self.assertIn('Read-Host', text)
        self.assertIn('selection required', text)
        self.assertNotIn('defaultChoice', text)
        self.assertNotIn('if (!$choice) { $mode = $defaultMode }', text)
        self.assertIn('DESKTOP_BRIDGE_INSTALL_MODE', text)
        self.assertIn('-Mode $mode', text)
        self.assertIn('if not defined DESKTOP_BRIDGE_INSTALL_MODE pause', text)
        self.assertIn('START-HERE.txt', text)
        self.assertIn('Common commands (Windows CMD):', text)
        self.assertIn('Remove-Item -LiteralPath $temp -Recurse', text)


if __name__ == '__main__':
    unittest.main()

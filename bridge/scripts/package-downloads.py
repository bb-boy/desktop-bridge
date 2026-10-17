#!/usr/bin/env python3
"""Build the universal GPT ZIP and standalone native setup downloads."""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

REPO = pathlib.Path(__file__).resolve().parents[2]
TEMPLATES = REPO / 'bridge/installers'
spec = importlib.util.spec_from_file_location('package_plugin', REPO / 'bridge/scripts/package-plugin.py')
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def render(template, payload):
    text = (TEMPLATES / template).read_text()
    return text.replace('@@SHA256@@', hashlib.sha256(payload).hexdigest()).replace('@@PAYLOAD@@', base64.encodebytes(payload).decode().strip())


def linux_payload(source):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for file in sorted(source.rglob('*')):
            if not file.is_file():
                continue
            assert not file.is_symlink()
            info = archive.gettarinfo(str(file), 'payload/' + file.relative_to(source).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mtime = 0
            info.mode = 0o755 if file.suffix in ['.sh', '.command'] else 0o644
            with file.open('rb') as data:
                archive.addfile(info, data)
    return output.getvalue()


def stage_macos(source, staging, version):
    root = staging / 'root'
    app = root / 'Applications/Desktop Bridge Setup.app'
    contents = app / 'Contents'
    resources = contents / 'Resources'
    (contents / 'MacOS').mkdir(parents=True)
    resources.mkdir()
    plist = {'CFBundleIdentifier': 'de.desktopbridge.setup', 'CFBundleName': 'Desktop Bridge Setup',
             'CFBundleExecutable': 'DesktopBridgeSetup', 'CFBundlePackageType': 'APPL',
             'CFBundleVersion': version, 'CFBundleShortVersionString': version,
             'LSMinimumSystemVersion': '13.5', 'LSUIElement': True}
    (contents / 'Info.plist').write_bytes(plistlib.dumps(plist))
    shutil.copytree(source, resources / 'payload')
    shutil.copyfile(TEMPLATES / 'macos-launcher.sh', contents / 'MacOS/DesktopBridgeSetup')
    shutil.copyfile(TEMPLATES / 'macos-install.command', resources / 'Install.command')
    for file in app.rglob('*'):
        file.chmod(0o755 if file.is_dir() or file.suffix in ['.sh', '.command'] or file.name == 'DesktopBridgeSetup' else 0o644)
    scripts = staging / 'scripts'
    scripts.mkdir()
    shutil.copyfile(TEMPLATES / 'macos-postinstall.sh', scripts / 'postinstall')
    (scripts / 'postinstall').chmod(0o755)
    return root, scripts


def build(output, skip_macos=False):
    output = output.resolve()
    if sys.platform != 'darwin' and not skip_macos:
        raise RuntimeError('Build the macOS PKG on a Mac, or explicitly use --skip-macos for the other downloads.')
    output.mkdir(parents=True, exist_ok=True)
    archive = output / 'desktop-bridge-plugin.zip'
    plugin.build(archive)
    version = json.loads((REPO / 'plugin/plugin.json').read_text())['version']
    with tempfile.TemporaryDirectory(prefix='desktop-bridge-downloads-') as temporary:
        stage = pathlib.Path(temporary)
        with zipfile.ZipFile(archive) as package:
            package.extractall(stage / 'unpacked')
        source = stage / 'unpacked' / plugin.NAME
        # ZIP extraction does not restore POSIX executable bits; no user chmod is needed.
        for file in source.rglob('*'):
            if file.is_file() and file.suffix in ['.command', '.sh']:
                file.chmod(0o755)
        windows = output / 'DesktopBridge-Windows.cmd'
        windows.write_bytes(render('windows.cmd.in', archive.read_bytes()).replace('\n', '\r\n').encode('utf8'))
        linux = output / 'DesktopBridge-Linux.sh'
        linux.write_text(render('linux.sh.in', linux_payload(source)))
        linux.chmod(0o755)
        if not skip_macos:
            root, scripts = stage_macos(source, stage / 'macos', version)
            components = stage / 'components.plist'
            components.write_bytes(plistlib.dumps([{'RootRelativeBundlePath': 'Applications/Desktop Bridge Setup.app',
                                                   'BundleIsRelocatable': False, 'BundleIsVersionChecked': True,
                                                   'BundleOverwriteAction': 'upgrade'}]))
            subprocess.run(['pkgbuild', '--root', str(root), '--identifier', 'de.desktopbridge.setup',
                            '--version', version, '--install-location', '/', '--ownership', 'recommended',
                            '--component-plist', str(components), '--scripts', str(scripts),
                            str(output / 'DesktopBridge-macOS.pkg')], check=True)
    names = ['desktop-bridge-plugin.zip', 'DesktopBridge-Windows.cmd', 'DesktopBridge-Linux.sh']
    if not skip_macos:
        names.append('DesktopBridge-macOS.pkg')
    artifacts = {name: {'sha256': hashlib.sha256((output / name).read_bytes()).hexdigest(),
                        'bytes': (output / name).stat().st_size} for name in names}
    manifest = {'version': version, 'macosSigned': False, 'macosNotarized': False, 'artifacts': artifacts}
    (output / 'downloads.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(info['sha256'] + '  ' + name + '\n' for name, info in artifacts.items()))
    print(json.dumps(manifest))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--skip-macos', action='store_true')
    args = parser.parse_args()
    build(args.output, args.skip_macos)

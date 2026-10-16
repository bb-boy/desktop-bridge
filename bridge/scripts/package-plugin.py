#!/usr/bin/env python3
"""Build the single universal portable plugin ZIP from the integrated repository."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import tempfile
import zipfile

REPO = pathlib.Path(__file__).resolve().parents[2]
NAME = 'desktop-bridge-p111'
IGNORED = {'node_modules', '.git', '__pycache__'}
PRIVATE = {'agent-config.json','server-config.json','owner-password.txt','journal.json','heartbeat.json','launch.json','maintenance.flag','agent.lock','runner.pid'}


def manifest(root):
    m = json.loads((root / 'plugin.json').read_text())
    assert m['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    assert m['name'] == NAME
    assert re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', m['version'])
    interface = m['extensions']['com.openai']['interface']
    assert len(interface['shortDescription']) <= 30
    assert isinstance(interface['capabilities'], list)
    for field in ['logo','composerIcon']:
        p = (root / interface[field]).resolve()
        assert p.is_relative_to(root.resolve()) and p.is_file()
    servers = json.loads((root / 'mcp.json').read_text())
    assert servers['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
    assert servers['mcpServers']['desktop_bridge']['url'] == 'https://mcp.ilovestudy.de/mcp'
    assert servers['mcpServers']['desktop_bridge']['extensions']['com.openai']['auth']['type'] == 'oauth'
    return m


def build(output):
    output = output.resolve()
    assert not output.is_relative_to((REPO / 'plugin').resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='desktop-bridge-package-') as temp:
        root = pathlib.Path(temp) / NAME
        shutil.copytree(REPO / 'plugin', root, ignore=shutil.ignore_patterns(*IGNORED, 'client'))
        client = root / 'assets' / 'client'
        shutil.copytree(REPO / 'bridge' / 'client', client, ignore=shutil.ignore_patterns(*IGNORED, '*.log', '*.zip'))
        shutil.copytree(REPO / 'bridge' / 'agent', client / 'agent')
        shutil.copy2(REPO / 'bridge' / 'THIRD_PARTY_NOTICES.md', root / 'THIRD_PARTY_NOTICES.md')
        m = manifest(root)
        for filename in ['Install.cmd','Install.command','Install.sh']:
            assert (root / filename).is_file()
            assert (client / filename).is_file(), 'Missing platform bootstrap: ' + filename
        for filename in ['install.mjs','runner.mjs','package.json','package-lock.json','connection.json']:
            assert (client / filename).is_file(), filename
        for p in root.rglob('*'):
            assert not p.is_symlink(), 'Symlinks must not enter plugin packages'
            assert p.name not in PRIVATE and not any(x in IGNORED for x in p.parts), str(p)
            if p.is_file():
                assert p.suffix not in ['.db','.sqlite','.log'], str(p)
                if p.suffix == '.json':
                    data=json.loads(p.read_text())
                    assert not (isinstance(data,dict) and any(x in data for x in ['deviceToken','ownerPasswordHash','access_token','refresh_token'])), str(p)
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for p in sorted(root.rglob('*')):
                if not p.is_file():
                    continue
                item = zipfile.ZipInfo(str(p.relative_to(root.parent)), (2026,10,17,0,0,0))
                item.create_system = 3
                mode = 0o100755 if p.suffix in ['.sh','.command'] else 0o100644
                item.external_attr = mode << 16
                item.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(item, p.read_bytes())
        with zipfile.ZipFile(output) as archive:
            assert archive.testzip() is None
            assert len({n.split('/')[0] for n in archive.namelist()}) == 1
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        output.with_suffix('.zip.sha256').write_text(digest + '  ' + output.name + '\n')
        print(json.dumps({'archive':str(output),'version':m['version'],'sha256':digest,'bytes':output.stat().st_size}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=pathlib.Path,required=True)
    build(parser.parse_args().output)

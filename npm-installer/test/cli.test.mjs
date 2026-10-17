import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse,clientDataRoot} from '../bin/desktop-bridge.mjs';

const bin=fileURLToPath(new URL('../bin/desktop-bridge.mjs',import.meta.url));

test('parses explicit service management commands',()=>{
  assert.equal(parse(['mode','background','--root','test-data']).command,'mode');
  assert.equal(parse(['mode','background','--root','test-data']).args[0],'background');
  assert.equal(parse(['pair','--root','test-data']).command,'pair');
  assert.equal(parse(['setup','--mode','manual']).command,'setup');
});

test('rejects unrecognized, extra or duplicate arguments',()=>{
  for(const args of [
    ['foo'], ['status','--repair'], ['pair','--no-browser'],
    ['mode','whatever'], ['setup','--mode','invalid'],
    ['stop','--root'], ['uninstall','--administrator'],
    ['status','--root','a','--root','b']
  ])assert.throws(()=>parse(args));
});

test('keeps per-platform data directories compatible with existing client',()=>{
  assert.equal(clientDataRoot('win32',{LOCALAPPDATA:'C:\\Users\\Test\\AppData\\Local'},'/home/user'),
    'C:\\Users\\Test\\AppData\\Local\\DesktopBridgeClient');
  assert.equal(clientDataRoot('linux',{},'/home/user'),'/home/user/.local/share/desktop-bridge');
});

test('npm package installation has no service-start lifecycle hooks',()=>{
  const manifest=JSON.parse(requireManifest());
  assert.equal(manifest.scripts?.postinstall,undefined);
  assert.equal(manifest.scripts?.install,undefined);
});

function requireManifest(){return readFileSync(fileURLToPath(new URL('../package.json',import.meta.url)),'utf8');}

test('help and version do not install or start an agent',()=>{
  const help=spawnSync(process.execPath,[bin,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0);
  assert.match(help.stdout,/setup \[/);
  const version=spawnSync(process.execPath,[bin,'--version'],{encoding:'utf8'});
  assert.equal(version.status,0);
  assert.match(version.stdout,/^0\.2\.6/);
});

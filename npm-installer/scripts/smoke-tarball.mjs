#!/usr/bin/env node
/** Test packed npm CLI without executing setup, pairing or starting a service. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const tarballs=fs.readdirSync(root).filter(name=>name.endsWith('.tgz')&&name.includes('desktop-bridge'));
assert.equal(tarballs.length,1,'Expected exactly one npm tarball');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-bridge-npm-smoke-'));
try{
  const unpack=spawnSync('tar',['-xzf',path.join(root,tarballs[0]),'-C',temporary],{encoding:'utf8'});
  assert.equal(unpack.status,0,unpack.stderr);
  const entry=path.join(temporary,'package','bin','desktop-bridge.mjs');
  assert.ok(fs.existsSync(entry),'Missing npm CLI bin entry');
  const help=spawnSync(process.execPath,[entry,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/Desktop Bridge/);
  const version=spawnSync(process.execPath,[entry,'--version'],{encoding:'utf8'});
  assert.equal(version.status,0,version.stderr);
  assert.match(version.stdout,/^0\.2\.5/);
  const invalid=spawnSync(process.execPath,[entry,'not-a-command'],{encoding:'utf8'});
  assert.equal(invalid.status,1,'Invalid command must fail before side effects');

  // Never run the real service in CI. Replace extracted install/control
  // modules with a harmless invocation recorder and verify dispatch.
  const client=path.join(temporary,'package','dist','client');
  const capture=path.join(temporary,'calls.jsonl');
  const stub=[
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "fs.appendFileSync(process.env.DESKTOP_BRIDGE_TEST_CAPTURE, JSON.stringify({",
    "  script:path.basename(process.argv[1]), args:process.argv.slice(2)",
    "})+'\\n');"
  ].join('\\n');
  for(const script of ['install.mjs','control.mjs'])fs.writeFileSync(path.join(client,script),stub);
  const data=path.join(temporary,'data with spaces');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data,'launch.json'),'{}');
  function check(args,expected){
    fs.rmSync(capture,{force:true});
    const result=spawnSync(process.execPath,[entry,...args,'--root',data],{
      encoding:'utf8',env:{...process.env,DESKTOP_BRIDGE_TEST_CAPTURE:capture}
    });
    assert.equal(result.status,0,(result.stdout||'')+'\\n'+(result.stderr||''));
    const actual=fs.readFileSync(capture,'utf8').trim().split('\\n').map(line=>JSON.parse(line));
    assert.deepEqual(actual,expected);
  }
  const at=(script,args)=>({script,args:[...args,'--root',data]});
  check(['setup','--mode','manual'],[at('install.mjs',['--mode','manual'])]);
  for(const action of ['start','stop','status','pair'])check([action],[at('control.mjs',[action])]);
  check(['mode','background'],[at('control.mjs',['mode','background'])]);
  check(['restart'],[at('control.mjs',['stop']),at('control.mjs',['start'])]);
  check(['repair'],[at('install.mjs',['--repair'])]);
  check(['uninstall'],[at('install.mjs',['--uninstall'])]);
  check(['uninstall','--purge'],[at('install.mjs',['--uninstall','--purge'])]);
  console.log('Tarball CLI smoke tests passed: help/version/invalid and 10 safe command dispatch scenarios.');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}

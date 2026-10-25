import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ensureCuaDriver,acceptableVersion,installedDriverPath,CUA_VERSION} from '../../bridge/client/cua-driver.mjs';
import {parse} from '../bin/desktop-bridge.mjs';
import {parseInstallerOptions} from '../../bridge/client/install-options.mjs';

test('version policy accepts the pinned version or newer without downgrading',()=>{
  assert.equal(acceptableVersion('cua-driver '+CUA_VERSION),true);
  assert.equal(acceptableVersion('cua-driver 0.37.9'),false);
  assert.equal(acceptableVersion('garbled output'),false);
  assert.equal(acceptableVersion('cua-driver 0.39.0'),true);
});
test('user explicitly enables CUA in one update command',()=>{
  assert.deepEqual(parse(['update','--with-cua']),{command:'update',args:['--with-cua'],root:undefined});
  assert.equal(parseInstallerOptions(['--mode','background','--with-cua']).withCua,true);
  assert.throws(()=>parse(['update','--arbitrary']),/Usage:/);
});
test('valid existing driver is re-used and its MCP catalog checked',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cua-ready-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const executable=path.join(root,'fake-cua-driver'+(process.platform==='win32'?'.exe':''));
  fs.writeFileSync(executable,'fixture');
  const calls=[];
  const result=await ensureCuaDriver({
    root,existingCommand:executable,
    captureImpl:async (cmd,args)=>{calls.push(args[0]);return args[0]==='--version'?'cua-driver 0.38.0':'get_desktop_state\nlist_windows';},
    runImpl:async()=>{throw new Error('Unexpected installer execution');},
    fetchImpl:async()=>{throw new Error('Unexpected download');}
  });
  assert.equal(result.command,executable);
  assert.deepEqual(result.args,['mcp']);
  assert.deepEqual(calls,['--version','list-tools']);
});
test('download fails closed on wrong SHA256 without running scripts',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cua-bad-digest-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let executed=false;
  await assert.rejects(ensureCuaDriver({
    root,platform:'darwin',home:root,
    fetchImpl:async()=>({ok:true,arrayBuffer:async()=>Buffer.alloc(4096,65)}),
    captureImpl:async()=>{throw new Error('missing executable');},
    runImpl:async()=>{executed=true;}
  }),/SHA-256 verification failed/);
  assert.equal(executed,false);
  assert.equal(fs.readdirSync(root).filter(x=>x.startsWith('.cua-install-')).length,0);
});
test('recognizes CUA default target paths',()=>{
  assert.match(installedDriverPath('darwin',{},'/tmp/example'),/\.local\/bin\/cua-driver$/);
  assert.match(installedDriverPath('win32',{LOCALAPPDATA:'C:\\Users\\Test\\AppData\\Local'},'/unused'),/cua-driver\.exe$/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../bin/desktop-bridge.mjs',import.meta.url));
test('remote MCP terminal cannot uninstall or upgrade its own Agent',()=>{
  for(const action of ['setup','update','repair','uninstall']){
    const result=spawnSync(process.execPath,[cli,action],{
      encoding:'utf8',timeout:6000,env:{...process.env,DESKTOP_BRIDGE_REMOTE_AGENT:'1'}
    });
    assert.equal(result.status,1,action);
    assert.match(result.stderr,/Self-maintenance would disconnect this remote MCP terminal/,action);
  }
});

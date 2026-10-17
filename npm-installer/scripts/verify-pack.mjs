#!/usr/bin/env node
/** Verify the exact npm pack file list before any publication. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const manifestPath=process.argv[2];
if(!manifestPath)throw new Error('Usage: verify-pack.mjs npm-pack.json');
const packs=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
assert.ok(Array.isArray(packs)&&packs.length===1,'Expected one npm tarball');
const pkg=packs[0];
assert.equal(pkg.name,'@justlovepl/desktop-bridge');
const paths=new Set(pkg.files.map(file=>file.path));
for(const required of [
  'package.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md',
  'bin/desktop-bridge.mjs','dist/client/install.mjs',
  'dist/client/control.mjs','dist/client/startup.mjs','dist/client/windows-background.mjs',
  'dist/client/package.json','dist/client/package-lock.json',
  'dist/client/node-runtime.json','dist/client/environment.mjs',
  'dist/client/agent/agent.mjs','dist/client/agent/pair.mjs',
  'dist/client/Install.cmd','dist/client/Install.sh'
]){
  assert.ok(paths.has(required),'Missing required file: '+required);
}
for(const file of paths){
  assert.ok(/^(?:package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|bin\/|dist\/client\/)/.test(file),'Unexpected public file: '+file);
  assert.ok(!/(?:^|\/)(?:node_modules|\.git|\.env|agent-config\.json|server-config\.json|journal\.json|heartbeat\.json|launch\.json|client-settings\.json|auth-status\.json|device-token|owner-password)(?:\/|$)/i.test(file),'Potential private file: '+file);
}
assert.ok(pkg.size>0,'Empty tarball');
console.log('Verified npm package:',pkg.name,pkg.version,'('+paths.size+' files)');

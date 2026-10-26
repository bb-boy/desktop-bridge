#!/usr/bin/env node
/** Isolated offline npm v1 -> v2 package replacement. No real Agent runs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const source=path.resolve(import.meta.dirname,'..');
const first=fs.readdirSync(source).filter(n=>n.endsWith('.tgz')&&n.includes('desktop-bridge'));
assert.equal(first.length,1,'Expected one source tarball');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-bridge-upgrade-'));
const env={...process.env,NPM_CONFIG_CACHE:path.join(tmp,'npm-cache'),NPM_CONFIG_UPDATE_NOTIFIER:'false'};
const candidates=[
  process.env.npm_execpath,
  path.resolve(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')
].filter(Boolean);
const npmCli=candidates.find(p=>fs.existsSync(p));
assert.ok(npmCli,'npm CLI not found');
function run(command,args,{cwd}={}){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',env,timeout:90000,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,command+' '+args.join(' ')+': '+(result.error?.message??'')+'\n'+result.stdout+'\n'+result.stderr);
  return result.stdout.trim();
}
const npm=(args,opts)=>run(process.execPath,[npmCli,...args],opts);
const jwrite=(p,obj)=>fs.writeFileSync(p,JSON.stringify(obj,null,2));
try{
  const prefix=path.join(tmp,'global-prefix');
  const data=path.join(tmp,'user-data');
  fs.mkdirSync(data,{recursive:true});
  const creds={serverUrl:'https://example.invalid',deviceId:'ci-device-1',deviceToken:'ci-only-dummy-token',runtimeDir:'old-runtime',mcpEntry:'old-entry'};
  const settings={mode:'manual',privilege:'standard',version:'old-release'};
  const journal={'ci-task-1':{status:'completed',result:'kept'}};
  jwrite(path.join(data,'agent-config.json'),creds);
  jwrite(path.join(data,'client-settings.json'),settings);
  jwrite(path.join(data,'journal.json'),journal);
  fs.writeFileSync(path.join(data,'.desktop-bridge-client'),'desktop-bridge-client\n');
  const frozen=['agent-config.json','client-settings.json','journal.json','.desktop-bridge-client'].map(n=>[n,fs.readFileSync(path.join(data,n))]);

  // Simulate the previous 0.2.6 npm release from this package's staged files.
  // The second installation uses the ACTUAL new 0.2.8 tarball.
  const currentTarball=path.join(source,first[0]);
  const unpack=path.join(tmp,'previous');
  fs.mkdirSync(unpack);
  run('tar',['-xzf',currentTarball,'-C',unpack]);
  const previousPackage=path.join(unpack,'package');
  const previousManifest=path.join(previousPackage,'package.json');
  const metadata=JSON.parse(fs.readFileSync(previousManifest,'utf8'));
  assert.equal(metadata.version,'0.2.8','Expected the real 0.2.8 npm release under test');
  metadata.version='0.2.6';
  jwrite(previousManifest,metadata);
  const previousTarballs=path.join(tmp,'previous-tarball');
  fs.mkdirSync(previousTarballs);
  npm(['pack',previousPackage,'--ignore-scripts','--pack-destination',previousTarballs]);
  const oldArchive=fs.readdirSync(previousTarballs).filter(n=>n.endsWith('.tgz'));
  assert.equal(oldArchive.length,1);

  npm(['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','--no-save',path.join(previousTarballs,oldArchive[0])]);
  const installed=path.join(prefix,'node_modules','@justlovepl','desktop-bridge');
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'package.json'))).version,'0.2.6');
  const cli=path.join(installed,'bin','desktop-bridge.mjs');
  assert.equal(run(process.execPath,[cli,'--version']),'0.2.6');
  for(const [n,bytes] of frozen)assert.deepEqual(fs.readFileSync(path.join(data,n)),bytes,'npm install modified '+n);

  npm(['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','--no-save',currentTarball]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'package.json'))).version,'0.2.8');
  assert.equal(run(process.execPath,[cli,'--version']),'0.2.8');
  for(const [n,bytes] of frozen)assert.deepEqual(fs.readFileSync(path.join(data,n)),bytes,'npm replacement modified '+n);
  assert.ok(!fs.existsSync(path.join(data,'maintenance.flag')),'npm update unexpectedly stopped agent');
  console.log('Offline npm v0.2.6 -> actual v0.2.8 package replacement passed; token, device ID, mode and journal unchanged.');
}finally{
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}

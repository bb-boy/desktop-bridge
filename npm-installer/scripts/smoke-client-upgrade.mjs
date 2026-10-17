#!/usr/bin/env node
/**
 * Sandbox-reinstall the REAL install.mjs from the packed npm artifact, while
 * replacing network / OS-service integrations with strict local test doubles.
 * Nothing is written to the runner's actual Desktop Bridge data directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const pkg=path.resolve(import.meta.dirname,'..');
const archives=fs.readdirSync(pkg).filter(n=>n.endsWith('.tgz')&&n.includes('desktop-bridge'));
assert.equal(archives.length,1);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-bridge-reinstall-'));
function run(command,args,env=process.env){
 const result=spawnSync(command,args,{encoding:'utf8',env,timeout:35000,maxBuffer:1024*1024});
 assert.equal(result.status,0,(result.error?.message??'')+'\n'+result.stdout+'\n'+result.stderr);
}
function put(location,content){fs.writeFileSync(location,content);}
try{
  const archive=path.join(pkg,archives[0]);
  const unpack=path.join(tmp,'unpacked');
  fs.mkdirSync(unpack);
  run('tar',['-xzf',archive,'-C',unpack]);
  const packaged=path.join(unpack,'package','dist','client');
  for(const mode of ['manual','background']){
    const work=path.join(tmp,'fixture-'+mode);
    const source=path.join(work,'source');
    const data=path.join(work,'device-data');
    fs.mkdirSync(work,{recursive:true});
    fs.cpSync(packaged,source,{recursive:true});
    fs.mkdirSync(data);
    const credentials={serverUrl:'https://example.invalid',deviceToken:'CI-DUMMY-NOT-A-REAL-TOKEN',deviceId:'CI-DEVICE-ID',
      accountHint:'ci-user',runtimeDir:'previous-runtime',mcpEntry:'previous-entry'};
    const journal={task1:{status:'completed',result:{output:'preserve me'}}};
    const settings={mode,privilege:'standard',version:'old-client'};
    for(const [file,value] of [['agent-config.json',credentials],['client-settings.json',settings],['journal.json',journal],['auth-status.json',{authStatus:'ok'}]])
      put(path.join(data,file),JSON.stringify(value));
    put(path.join(data,'.desktop-bridge-client'),'desktop-bridge-client\n');
    const beforeJournal=fs.readFileSync(path.join(data,'journal.json'));
    const beforeAuth=fs.readFileSync(path.join(data,'auth-status.json'));

    // Replace outbound I/O, network downloads and OS startup registration.
    // Real install.mjs and real option parsing are exercised unchanged.
    put(path.join(source,'environment.mjs'),
      "export async function ensureRuntime(){return {node:process.execPath,npm:'mock-npm'};}\n"+
      "export async function prepareDependencies(){return {installed:false};}\n"+
      "export async function verifyLocalTools(){return 31;}\n");
    put(path.join(source,'lifecycle.mjs'),
      "import fs from 'node:fs';import path from 'node:path';\n"+
      "export function dataRoot(){throw new Error('test must pass --root');}\n"+
      "export function startupFile(root){return path.join(root,'mock-startup');}\n"+
      "export async function run(command,args){\n"+
      " if(args[0]?.endsWith('agent.mjs')){\n"+
      "  const cfg=JSON.parse(fs.readFileSync(args[1],'utf8'));\n"+
      "  if(!cfg.deviceToken||!cfg.deviceId||args.includes('--pair'))throw new Error('unexpected loss of device authorization');\n"+
      "  fs.writeFileSync(path.join(path.dirname(args[1]),'agent-call.json'),JSON.stringify({args,deviceId:cfg.deviceId}));\n"+
      " }\n"+
      "}\n"+
      "export function acquireLock(dir){fs.mkdirSync(dir);return true;}\n"+
      "export function releaseLock(dir){fs.rmSync(dir,{recursive:true,force:true});}\n"+
      "export async function stopClient(root){fs.writeFileSync(path.join(root,'maintenance.flag'),'stopped');}\n"+
      "export async function removeStartup(){}\n");
    put(path.join(source,'startup.mjs'),
      "import fs from 'node:fs';import path from 'node:path';\n"+
      "export async function setMode(root,node,mode){\n"+
      " const old=JSON.parse(fs.readFileSync(path.join(root,'client-settings.json'),'utf8'));\n"+
      " fs.writeFileSync(path.join(root,'client-settings.json'),JSON.stringify({...old,mode}));\n"+
      " fs.writeFileSync(path.join(root,'mode-set.json'),JSON.stringify({mode,node}));\n"+
      "}\n"+
      "export function commandFor(){return 'stub';}\n"+
      "export function writeInstructions(){}\n");
    put(path.join(source,'admin-elevate.mjs'),"export function elevationRequest(){throw new Error('admin unsupported in sandbox');}\n");

    // A re-install with no explicit selection must fail before stopping the existing Agent.
    const untouchedConfig=fs.readFileSync(path.join(data,'agent-config.json'));
    const unattended=spawnSync(process.execPath,[path.join(source,'install.mjs'),'--root',data],{
      encoding:'utf8',timeout:20000,env:{...process.env,DESKTOP_BRIDGE_TEST_ONLY:'1'}
    });
    assert.notEqual(unattended.status,0,'Unselected reinstall unexpectedly succeeded');
    assert.match((unattended.stdout??'')+(unattended.stderr??''),/--mode manual|--mode background/);
    assert.deepEqual(fs.readFileSync(path.join(data,'agent-config.json')),untouchedConfig,'Rejected setup modified credentials');
    assert.ok(!fs.existsSync(path.join(data,'maintenance.flag')),'Rejected setup stopped the Agent');
    assert.ok(!fs.existsSync(path.join(data,'agent-call.json')),'Rejected setup attempted pairing');

    run(process.execPath,[path.join(source,'install.mjs'),'--mode',mode,'--root',data],{
      ...process.env,DESKTOP_BRIDGE_TEST_ONLY:'1'
    });
    const after=JSON.parse(fs.readFileSync(path.join(data,'agent-config.json'),'utf8'));
    assert.equal(after.deviceToken,credentials.deviceToken,'Token replaced during reinstall');
    assert.equal(after.deviceId,credentials.deviceId,'Device ID replaced during reinstall');
    assert.equal(after.accountHint,credentials.accountHint,'Local account metadata lost');
    assert.equal(after.serverUrl,credentials.serverUrl,'Relay URL changed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(data,'client-settings.json'),'utf8')).mode,mode,'Mode changed');
    assert.deepEqual(fs.readFileSync(path.join(data,'journal.json')),beforeJournal,'Task journal changed');
    assert.deepEqual(fs.readFileSync(path.join(data,'auth-status.json')),beforeAuth,'Auth status changed');
    const call=JSON.parse(fs.readFileSync(path.join(data,'agent-call.json')));
    assert.equal(call.deviceId,credentials.deviceId);
    assert.ok(call.args.includes('--setup-only'));
    assert.ok(!call.args.includes('--pair'),'Re-pair requested without consent');
    assert.ok(fs.existsSync(path.join(data,'launch.json')),'Updated client launch file not written');
    assert.equal(JSON.parse(fs.readFileSync(path.join(data,'mode-set.json'))).mode,mode);
    console.log('Sandbox install.mjs reinstall preserved local credentials, journal and '+mode+' mode.');
  }
}finally{
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}

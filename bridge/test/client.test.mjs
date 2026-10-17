import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dataRoot,acquireLock,releaseLock,stopClient,livePid,sleep} from '../client/lifecycle.mjs';
import {startBackground} from '../client/startup.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'client');
const require=createRequire(path.join(runtime,'package.json'));
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-client-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=fn();if(value)return value;}catch{}await sleep(30);}throw new Error('Condition timed out');}
function child(command,args,options={}){const p=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});let output='';for(const stream of [p.stdout,p.stderr])stream.on('data',data=>output+=data);p.output=()=>output;return p;}
async function exited(p){const [code]=await once(p,'exit');assert.equal(code,0,p.output());}

test('all supported OS and architectures have pinned official runtime checksums',()=>{
 const metadata=JSON.parse(fs.readFileSync(path.join(runtime,'node-runtime.json')));
 assert.equal(metadata.version,'24.19.0');assert.match(metadata.source,/^https:\/\/nodejs.org\/dist\/v24.19.0\/SHASUMS256.txt$/);
 for(const platform of ['win','darwin','linux'])for(const arch of ['x64','arm64']){const target=metadata.platforms[platform+'-'+arch];assert.match(target.sha256,/^[a-f0-9]{64}$/);assert.equal(target.filename,`node-v24.19.0-${platform}-${arch}${platform==='win'?'.zip':'.tar.gz'}`);}
 assert.match(dataRoot('win32',{LOCALAPPDATA:'/windows-local'},'/home'),/windows-local.*DesktopBridgeClient/);
 assert.equal(dataRoot('darwin',{},'/home'),'/home/Library/Application Support/DesktopBridge');
 assert.equal(dataRoot('linux',{XDG_DATA_HOME:'/data'},'/home'),'/data/desktop-bridge');
 const shell=fs.readFileSync(path.join(runtime,'Install.sh'),'utf8');for(const [key,target] of Object.entries(metadata.platforms))if(!key.startsWith('win'))assert.ok(shell.includes(target.sha256));
});

test('client locks reject contention and recover abandoned PID locks',t=>{
 const dir=directory(t),lock=path.join(dir,'lock');assert.equal(acquireLock(lock),true);assert.equal(acquireLock(lock),false);releaseLock(lock);
 fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'pid'),'99999999');const old=new Date(Date.now()-60000);fs.utimesSync(lock,old,old);
 assert.equal(acquireLock(lock),true);releaseLock(lock);assert.equal(fs.existsSync(lock),false);
});

test('runner starts one agent, detects maintenance and releases both processes',async t=>{
 const dir=directory(t),agent=path.join(dir,'fake-agent.mjs');
 fs.writeFileSync(agent,`import fs from 'node:fs';fs.appendFileSync('starts.txt','start\\n');fs.writeFileSync('agent.lock',String(process.pid));const timer=setInterval(()=>fs.writeFileSync('heartbeat.json',JSON.stringify({pid:process.pid,time:Date.now()})),100);process.on('message',m=>{if(m.type==='stop'){clearInterval(timer);fs.rmSync('agent.lock',{force:true});process.exit(0);}});`);
 fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify({agent,config:'unused'}));
 const a=child(process.execPath,[path.join(runtime,'runner.mjs'),dir]);t.after(()=>a.kill('SIGKILL'));
 await until(()=>fs.existsSync(path.join(dir,'heartbeat.json')));
 const b=child(process.execPath,[path.join(runtime,'runner.mjs'),dir]);await exited(b);
 assert.equal(fs.readFileSync(path.join(dir,'starts.txt'),'utf8'),'start\n');
 const finished=exited(a);await stopClient(dir);await finished;
 assert.equal(fs.existsSync(path.join(dir,'runner-lock')),false);assert.equal(livePid(path.join(dir,'agent.lock')),false);
});

test('agent protocol v2 reports health, deduplicates calls, rotates tokens and recovers saved results',async t=>{
 let WebSocketServer;try{({WebSocketServer}=require('ws'));require.resolve('@modelcontextprotocol/sdk/client/index.js');}catch{return t.skip('Install bridge/client dependencies to run agent protocol integration.');}
 const dir=directory(t),httpServer=http.createServer();const wss=new WebSocketServer({server:httpServer});httpServer.listen(0,'127.0.0.1');await once(httpServer,'listening');
 t.after(()=>{for(const socket of wss.clients)socket.terminate();wss.close();httpServer.close();});
 const config=path.join(dir,'agent-config.json');fs.writeFileSync(config,JSON.stringify({serverUrl:'http://127.0.0.1:'+httpServer.address().port,deviceId:'fixture-device',deviceToken:'a'.repeat(43),runtimeDir:runtime,mcpEntry:path.join(root,'test/helpers/client-mcp.mjs'),workingDirectory:dir}));
 let processAgent;
 const start=()=>{processAgent=child(process.execPath,[path.join(root,'agent/agent.mjs'),config,'--no-browser']);return processAgent;};
 t.after(()=>processAgent?.kill('SIGKILL'));start();
 const [socket]=await once(wss,'connection');let messages=[];socket.on('message',data=>messages.push(JSON.parse(data)));
 await until(()=>messages.find(m=>m.type==='hello'));assert.equal(messages.find(m=>m.type==='hello').protocol,2);
 const send=m=>socket.send(JSON.stringify(m));send({type:'welcome',recover:[]});send({type:'health_check'});
 await until(()=>messages.find(m=>m.type==='health'&&m.ok));
 const id=randomUUID();send({type:'call',id,name:'increment',arguments:{}});
 await until(()=>messages.find(m=>m.type==='result'&&m.id===id));send({type:'call',id,name:'increment',arguments:{}});
 await until(()=>messages.filter(m=>m.type==='result'&&m.id===id).length===2);assert.equal(fs.readFileSync(path.join(dir,'counter.txt'),'utf8'),'1');
 const token='b'.repeat(43);send({type:'rotate',token});await until(()=>messages.find(m=>m.type==='rotate_ack'&&m.tokenHash===createHash('sha256').update(token).digest('hex')));
 assert.equal(JSON.parse(fs.readFileSync(config)).deviceToken,token);
 const completed=exited(processAgent);processAgent.kill('SIGTERM');await completed;
 const connected=once(wss,'connection');start();const [next]=await connected;messages=[];next.on('message',data=>messages.push(JSON.parse(data)));
 await until(()=>messages.find(m=>m.type==='hello'));next.send(JSON.stringify({type:'welcome',recover:[id]}));
 const recovered=await until(()=>messages.find(m=>m.type==='result'&&m.id===id));assert.equal(recovered.result.content[0].text,'1');assert.equal(fs.readFileSync(path.join(dir,'counter.txt'),'utf8'),'1');
 const finish=exited(processAgent);fs.writeFileSync(path.join(dir,'maintenance.flag'),'stop');await finish;
});

test('re-pair required state blocks start, persists in status, and clears after explicit pairing',async t=>{
 const dir=directory(t),configPath=path.join(dir,'agent-config.json');
 const agent=path.join(dir,'mock-pair-agent.mjs');
 fs.writeFileSync(agent,`import fs from 'node:fs';import path from 'node:path';
 const filename=process.argv[2]; const c=JSON.parse(fs.readFileSync(filename,'utf8'));
 if(!process.argv.includes('--pair')||!process.argv.includes('--setup-only'))process.exit(6);
 c.deviceId='new-paired-id';c.deviceToken='new-paired-token';
 fs.writeFileSync(filename,JSON.stringify(c));`);
 fs.writeFileSync(configPath,JSON.stringify({deviceId:'old-id',deviceToken:'old-token'}));
 fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify({node:process.execPath,agent,config:configPath}));
 fs.writeFileSync(path.join(dir,'client-settings.json'),JSON.stringify({mode:'manual'}));
 fs.writeFileSync(path.join(dir,'auth-status.json'),JSON.stringify({authStatus:'re_pair_required',reason:'device_revoked'}));
 fs.writeFileSync(path.join(dir,'maintenance.flag'),'device authorization revoked');
 const control=(action)=>child(process.execPath,[path.join(runtime,'control.mjs'),action,'--root',dir]);
 const initial=control('status');await exited(initial);assert.match(initial.output(),/re_pair_required/);assert.match(initial.output(),/RePair.cmd|control.mjs pair/);
 const blocked=control('start');const [blockedExit]=await once(blocked,'exit');assert.equal(blockedExit,2,blocked.output());assert.equal(fs.existsSync(path.join(dir,'runner-lock')),false);
 await assert.rejects(startBackground(dir,process.execPath),/重新配对/,'background mode must not bypass a revoked credential');
 const paired=control('pair');await exited(paired);
 assert.equal(JSON.parse(fs.readFileSync(configPath,'utf8')).deviceToken,'new-paired-token');
 assert.equal(fs.existsSync(path.join(dir,'auth-status.json')),false);
 assert.equal(fs.existsSync(path.join(dir,'maintenance.flag')),false);
 const status=control('status');await exited(status);assert.match(status.output(),/"authStatus": "ok"/);
 assert.ok(fs.existsSync(path.join(runtime,'RePair.cmd')),'installed Windows helper exists in package source');
 assert.match(fs.readFileSync(path.join(runtime,'RePair.cmd'),'utf8'),/-Action pair/);
});

test('uninstall preserves saved results unless purge is explicitly requested',async t=>{
 const dir=directory(t),data=path.join(dir,'data');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'.desktop-bridge-client'),'desktop-bridge-client');fs.mkdirSync(path.join(data,'releases'));fs.writeFileSync(path.join(data,'journal.json'),'{}');fs.writeFileSync(path.join(data,'agent-config.json'),'{}');
 const env={...process.env,USERDOMAIN:'WORKGROUP',HOME:dir,APPDATA:path.join(dir,'AppData'),LOCALAPPDATA:path.join(dir,'LocalAppData'),XDG_CONFIG_HOME:path.join(dir,'config')};
 await exited(child(process.execPath,[path.join(runtime,'install.mjs'),'--root',data,'--uninstall'],{env}));
 assert.equal(fs.existsSync(path.join(data,'releases')),false);assert.equal(fs.existsSync(path.join(data,'journal.json')),true);assert.equal(fs.existsSync(path.join(data,'agent-config.json')),true);
 assert.equal(fs.existsSync(path.join(data,'install-lock')),false,'Maintenance must release its readable, deletable PID lock');
 await exited(child(process.execPath,[path.join(runtime,'install.mjs'),'--root',data,'--uninstall','--purge'],{env}));assert.equal(fs.existsSync(data),false);
});

test('bootstrap rejects a damaged runtime archive before invoking the installer',{skip:process.platform==='win32'},async t=>{
 const dir=directory(t),bin=path.join(dir,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'curl'),`#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf tampered > "$1"; exit 0; fi; shift; done\n`,{mode:0o700});
 const p=child('/bin/sh',[path.join(runtime,'Install.sh'),'--root',path.join(dir,'data'),'--no-browser','--no-start'],{env:{...process.env,HOME:dir,TMPDIR:dir,PATH:bin+path.delimiter+process.env.PATH}});
 const [code]=await once(p,'exit');assert.notEqual(code,0);assert.match(p.output(),/checksum mismatch/);assert.equal(fs.existsSync(path.join(dir,'data')),false);
});

test('runner restarts its agent after a process crash',async t=>{
 const dir=directory(t),agent=path.join(dir,'crash-once.mjs');
 fs.writeFileSync(agent,`import fs from 'node:fs';let n=0;try{n=Number(fs.readFileSync('starts.txt','utf8'));}catch{}fs.writeFileSync('starts.txt',String(++n));if(n===1)setTimeout(()=>process.exit(1),100);else{const timer=setInterval(()=>{},1000);process.on('message',m=>{if(m.type==='stop'){clearInterval(timer);process.exit(0);}});}`);
 fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify({agent,config:'unused'}));
 const runner=child(process.execPath,[path.join(runtime,'runner.mjs'),dir]);t.after(()=>runner.kill('SIGKILL'));
 await until(()=>fs.readFileSync(path.join(dir,'starts.txt'),'utf8')==='2',20000);
 const finished=exited(runner);await stopClient(dir);await finished;
});

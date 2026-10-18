import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseInstallerOptions,chooseMode,savedMode} from '../client/install-options.mjs';
import {commandFor,startupContent,shellQuote,powershellQuote} from '../client/startup.mjs';
import {livePid,sleep} from '../client/lifecycle.mjs';
import {runtimeReady,ensureRuntime,capture} from '../client/environment.mjs';
const client=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../client');
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-mode-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function spawnClient(args,{env,...options}={}){const p=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,...env},...options});let output='';p.stdout.on('data',chunk=>output+=chunk);p.stderr.on('data',chunk=>output+=chunk);p.output=()=>output;return p;}
async function waitFor(condition,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{if(condition())return;}catch{}await sleep(25);}throw new Error('Timed out');}
async function success(p){const [code]=await once(p,'exit');assert.equal(code,0,p.output());return p.output();}
function pidAlive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-mode-')),root=path.join(dir,'client');fs.mkdirSync(root);
 for(const name of ['control.mjs','install-options.mjs','startup.mjs','windows-background.mjs','runner.mjs','lifecycle.mjs','admin-elevate.mjs','admin-runtime.mjs'])fs.copyFileSync(path.join(client,name),path.join(root,name));
 fs.writeFileSync(path.join(root,'.desktop-bridge-client'),'client');fs.writeFileSync(path.join(root,'client-settings.json'),JSON.stringify({mode:'manual',version:'0.2.1'}));
 fs.writeFileSync(path.join(root,'agent-config.json'),'{}');fs.writeFileSync(path.join(root,'journal.json'),'saved-results');
 fs.writeFileSync(path.join(root,'dependencies-sentinel'),'unchanged');
 const agent=path.join(root,'fixture-agent.mjs');
 fs.writeFileSync(agent,`import fs from 'node:fs';import{spawn}from'node:child_process';fs.appendFileSync('starts.txt','1');fs.writeFileSync('agent.lock',String(process.pid));const grandchild=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('grandchild.pid',String(grandchild.pid));const timer=setInterval(()=>fs.writeFileSync('heartbeat.json',JSON.stringify({pid:process.pid,time:Date.now(),connected:true,localToolsAvailable:true})),50);process.on('message',m=>{if(m.type==='stop'){clearInterval(timer);fs.rmSync('agent.lock',{force:true});process.exit(0);}});`);
 fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({node:process.execPath,agent,config:path.join(root,'agent-config.json')}));
 const bin=path.join(dir,'bin');fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'launchctl'),'#!/bin/sh\nexit 0\n',{mode:0o700});
 const env={HOME:path.join(dir,'home'),APPDATA:path.join(dir,'appdata'),LOCALAPPDATA:path.join(dir,'localdata'),XDG_CONFIG_HOME:path.join(dir,'config'),PATH:bin+path.delimiter+process.env.PATH};
 const invoke=(...args)=>spawnClient([path.join(root,'control.mjs'),...args],{env});
 // Stop the fixture before removing its PID files, including after an assertion fails.
 t.after(async()=>{try{if(livePid(path.join(root,'runner-lock','pid')))await success(invoke('stop'));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
 return {root,env,invoke};
}

test('mode options are explicit, retain prior choice and reject contradictory flags',async()=>{
 assert.equal(parseInstallerOptions(['--no-start']).mode,'manual');assert.equal(parseInstallerOptions(['--administrator','--mode','background']).administrator,true);
 assert.throws(()=>parseInstallerOptions(['--administrator','--uninstall']),/maintenance/);assert.equal(parseInstallerOptions(['--mode','background']).mode,'background');
 for(const flags of [['--mode','background','--no-start'],['--mode','manual','--mode','background'],['--mode','invalid'],['--mode'],['--stop','--mode','manual']])assert.throws(()=>parseInstallerOptions(flags));
 let prompts=0;
 assert.equal(await chooseMode({}, {interactive:true,ask:async()=>++prompts===1?'':'2'}),'background');
 assert.equal(prompts,2,'empty answer must not silently select manual mode');
 assert.equal(await chooseMode({}, {interactive:true,previous:'background',ask:async()=> '1'}),'manual');
 await assert.rejects(()=>chooseMode({}, {interactive:false,previous:'background'}),/--mode manual/);
 await assert.rejects(()=>chooseMode({}, {interactive:false}),/--mode manual/);
 assert.equal(await chooseMode({stop:true},{interactive:false}),undefined);
});

test('unselected and contradictory installations fail before changing the target directory',async t=>{
 const dir=directory(t),target=path.join(dir,'not-created');
 for(const args of [[],['--mode','background','--no-start']]){const p=spawnClient([path.join(client,'install.mjs'),'--root',target,...args]);const [code]=await once(p,'exit');assert.notEqual(code,0);assert.equal(fs.existsSync(target),false);}
});

test('manual start is foreground; stopping preserves credentials and results without installing anything',async t=>{
 const f=await fixture(t),foreground=f.invoke('start');const finished=success(foreground);
 await waitFor(()=>fs.existsSync(path.join(f.root,'heartbeat.json')));assert.equal(foreground.exitCode,null);assert.match(foreground.output(),/Ctrl\+C/);
 const grandchild=Number(fs.readFileSync(path.join(f.root,'grandchild.pid')));assert.ok(pidAlive(grandchild));
 const status=JSON.parse(await success(f.invoke('status')));assert.deepEqual(status,{mode:'manual',running:true,networkConnected:true,localToolsAvailable:true,authStatus:'ok'});
 await success(f.invoke('stop'));await finished;await waitFor(()=>!pidAlive(grandchild));
 assert.equal(fs.readFileSync(path.join(f.root,'agent-config.json'),'utf8'),'{}');assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),'saved-results');assert.equal(fs.readFileSync(path.join(f.root,'dependencies-sentinel'),'utf8'),'unchanged');
 assert.equal(fs.existsSync(path.join(f.root,'node_modules')),false);
});

for(const signal of ['SIGINT','SIGHUP','SIGKILL'])test('foreground '+signal+' stops runner and the complete local tool tree',{skip:process.platform==='win32'&&signal!=='SIGINT'},async t=>{
 const f=await fixture(t),foreground=f.invoke('start');const exited=once(foreground,'exit');
 await waitFor(()=>fs.existsSync(path.join(f.root,'heartbeat.json')));const grandchild=Number(fs.readFileSync(path.join(f.root,'grandchild.pid')));
 foreground.kill(signal);await exited;await waitFor(()=>!livePid(path.join(f.root,'runner-lock','pid'))&&!pidAlive(grandchild));
});

test('switching background/manual persists selection, removes login startup and resumes without npm',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);
 await success(f.invoke('mode','background'));await waitFor(()=>fs.existsSync(path.join(f.root,'heartbeat.json')));assert.equal(savedMode(f.root),'background');
 const file=process.platform==='darwin'?path.join(f.env.HOME,'Library','LaunchAgents','de.desktopbridge.agent.plist'):path.join(f.env.XDG_CONFIG_HOME,'autostart','desktop-bridge.desktop');assert.equal(fs.existsSync(file),true);
 await success(f.invoke('mode','manual'));assert.equal(savedMode(f.root),'manual');assert.equal(fs.existsSync(file),false);assert.equal(livePid(path.join(f.root,'runner-lock','pid')),false);
 const instructions=fs.readFileSync(path.join(f.root,'START-HERE.txt'),'utf8');assert.ok(instructions.includes(commandFor(process.execPath,fs.realpathSync(f.root),'start')));assert.match(instructions,/Ctrl\+C/);
 await success(f.invoke('mode','background'));await waitFor(()=>livePid(path.join(f.root,'runner-lock','pid')));assert.equal(savedMode(f.root),'background');await success(f.invoke('stop'));
 assert.equal(fs.readFileSync(path.join(f.root,'dependencies-sentinel'),'utf8'),'unchanged');assert.equal(fs.existsSync(path.join(f.root,'node_modules')),false);
});

test('generated commands preserve literal paths with spaces, apostrophes and shell metacharacters',async t=>{
 const dir=directory(t),root=path.join(dir,"client ' $(echo injected) $HOME `false` &");fs.mkdirSync(root);fs.writeFileSync(path.join(root,'control.mjs'),"console.log(JSON.stringify(process.argv.slice(2)));");
 const command=commandFor(process.execPath,root,'mode manual');assert.equal(await capture('/bin/sh',['-c',command]),'["mode","manual"]');
 assert.equal(shellQuote("a'b"),"'a'\\''b'");assert.equal(powershellQuote("a'b"),"'a''b'");
 const windows=commandFor('C:\\Program Files\\node.exe',"C:\\a'b\\%TEMP% & $x",'start','win32');assert.match(windows,/^& 'C:\\Program Files\\node.exe'/);assert.ok(windows.includes("a''b"));assert.ok(windows.includes('%TEMP% & $x'));
 const plist=startupContent('/node & <xml>',root,'darwin');assert.ok(plist.includes('/node &amp; &lt;xml&gt;'));assert.doesNotMatch(plist,/<string>\/node & <xml>/);
 const desktop=startupContent('/node',root+'%','linux');assert.ok(desktop.includes('%%'));
});

test('environment preflight repairs a missing private Node/npm using the verified bootstrap runtime',async t=>{
 const dir=directory(t),runtime=path.join(dir,'runtime',`node-v24.19.0-${process.platform}-${process.arch}`);fs.mkdirSync(runtime,{recursive:true});
 const node=path.join(runtime,process.platform==='win32'?'node.exe':'bin/node');assert.equal(await runtimeReady(node,path.join(runtime,'missing-npm')),false);
 // CI alone can serve the byte-for-byte official archive from the persistent
 // runner cache. The production downloader/extractor and its pinned SHA-256 check
 // still run unchanged; no installer accepts a cache override.
 const cachedArchive=process.env.DESKTOP_BRIDGE_CI_NODE_ARCHIVE;
 const originalFetch=globalThis.fetch;
 let cacheFetches=0;
 if(cachedArchive){
  const manifest=JSON.parse(fs.readFileSync(path.join(client,'node-runtime.json'),'utf8'));
  const platform=process.platform==='win32'?'win':process.platform;
  const entry=manifest.platforms[platform+'-'+process.arch];
  assert.ok(entry,'CI runtime cache requires pinned platform metadata');
  assert.equal(path.basename(cachedArchive),entry.filename);
  const contents=fs.readFileSync(cachedArchive);
  assert.equal(createHash('sha256').update(contents).digest('hex'),entry.sha256,'CI cache must contain the authentic official Node archive');
  const url='https://nodejs.org/dist/v'+manifest.version+'/'+entry.filename;
  globalThis.fetch=async requested=>{
   assert.equal(String(requested),url,'only the pinned official archive may use the CI fixture');
   cacheFetches++;
   return new Response(contents,{status:200,headers:{'content-type':'application/gzip'}});
  };
 }
 try{
  const result=await ensureRuntime(dir,client);
  assert.equal(await runtimeReady(result.node,result.npm),true);
  if(cachedArchive)assert.equal(cacheFetches,1,'test used the verified local Node archive exactly once');
 }finally{globalThis.fetch=originalFetch;}
});

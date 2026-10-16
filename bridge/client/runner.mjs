import fs from 'node:fs';
import path from 'node:path';
import {fork,spawn} from 'node:child_process';
import {acquireLock,releaseLock} from './lifecycle.mjs';
if(!process.argv[2])throw new Error('Usage: node runner.mjs client-data-directory');
const root=path.resolve(process.argv[2]),flag=path.join(root,'maintenance.flag'),lock=path.join(root,'runner-lock');
if(fs.existsSync(flag)||!acquireLock(lock))process.exit(0);
process.on('exit',()=>releaseLock(lock));
const launch=JSON.parse(fs.readFileSync(path.join(root,'launch.json'),'utf8').replace(/^\uFEFF/,''));
let child,stopping=false,restartTimer,forceTimer,childStarted=0,childStopping=false;
function killTree(processChild){
 if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(processChild.pid),'/T','/F'],{stdio:'ignore'});killer.on('error',()=>processChild.kill('SIGKILL'));}
 else try{process.kill(-processChild.pid,'SIGKILL');}catch{processChild.kill('SIGKILL');}
}
function stopChild(){
 if(!child||childStopping)return;childStopping=true;
 if(child.connected)try{child.send({type:'stop'},()=>{});}catch{}
 forceTimer=setTimeout(()=>{if(child)killTree(child);},10000);
}
function stop(){if(stopping)return;stopping=true;clearTimeout(restartTimer);if(child)stopChild();else process.exit(0);}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
const watch=setInterval(()=>{
 if(fs.existsSync(flag))return stop();
 if(!child||childStopping)return;
 let timestamp=childStarted;
 try{const heartbeat=JSON.parse(fs.readFileSync(path.join(root,'heartbeat.json'),'utf8'));if(heartbeat.pid===child.pid&&Number.isFinite(heartbeat.time))timestamp=heartbeat.time;}catch{}
 if(Date.now()-timestamp>90000)stopChild();
},1000);watch.unref();
function start(){
 if(stopping||fs.existsSync(flag))return stop();
 childStarted=Date.now();childStopping=false;
 child=fork(launch.agent,[launch.config],{execPath:process.execPath,cwd:root,detached:process.platform!=='win32',stdio:['ignore','ignore','ignore','ipc']});
 child.on('error',()=>{});
 child.once('exit',()=>{clearTimeout(forceTimer);if(process.platform!=='win32')try{process.kill(-child.pid,'SIGKILL');}catch{}child=null;if(stopping)process.exit(0);restartTimer=setTimeout(start,10000);});
}
start();

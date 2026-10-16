import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
const root=path.resolve(process.argv[2]);
const flag=path.join(root,'maintenance.flag'),lock=path.join(root,'runner-lock');
if(fs.existsSync(flag))process.exit(0);
try {fs.mkdirSync(lock,{mode:0o700});}catch(e){
  if(e.code!=='EEXIST')throw e;
  let alive=true;
  try{const pid=Number(fs.readFileSync(path.join(lock,'pid'),'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error('invalid');try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}catch{if(Date.now()-fs.statSync(lock).mtimeMs>30000)alive=false;}
  if(alive)process.exit(0);fs.rmSync(lock,{recursive:true});fs.mkdirSync(lock,{mode:0o700});
}
fs.writeFileSync(path.join(lock,'pid'),String(process.pid),{mode:0o600});
function unlock(){try{if(fs.readFileSync(path.join(lock,'pid'),'utf8')===String(process.pid))fs.rmSync(lock,{recursive:true});}catch{}}
process.on('exit',unlock);
const launch=JSON.parse(fs.readFileSync(path.join(root,'launch.json'),'utf8').replace(/^\uFEFF/,''));
let child,stopping=false,timer;
function stop(){if(stopping)return;stopping=true;clearTimeout(timer);if(child?.connected)child.send({type:'stop'});else process.exit(0);const t=setTimeout(()=>{if(child)child.kill();process.exit(0);},10000);t.unref();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
const watch=setInterval(()=>{
  if(fs.existsSync(flag))stop();
  else if(child){try{const h=JSON.parse(fs.readFileSync(path.join(root,'heartbeat.json'),'utf8'));if(h.pid===child.pid&&Date.now()-h.time>90000)child.send({type:'stop'});}catch{}}
},5000);watch.unref();
function start(){
  if(stopping||fs.existsSync(flag))return stop();
  child=fork(launch.agent,[launch.config],{execPath:process.execPath,cwd:root,stdio:['ignore','ignore','ignore','ipc']});
  child.on('error',()=>{});
  child.once('exit',()=>{child=null;if(stopping)process.exit(0);timer=setTimeout(start,10000);});
}
start();

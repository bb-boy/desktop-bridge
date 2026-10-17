import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function dataRoot(platform=process.platform,env=process.env,home=os.homedir()) {
  return platform==='win32'?path.join(env.LOCALAPPDATA??path.join(home,'AppData','Local'),'DesktopBridgeClient'):platform==='darwin'?path.join(home,'Library','Application Support','DesktopBridge'):path.join(env.XDG_DATA_HOME??path.join(home,'.local','share'),'desktop-bridge');
}
export function run(command,args,options={}) {
  return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',...options});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${path.basename(command)} failed (${signal??code})`)));});
}
export function livePid(file) {
  try {const pid=Number(fs.readFileSync(file,'utf8'));if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}catch{return false;}
}
export function acquireLock(directory) {
  try{fs.mkdirSync(directory,{mode:0o700});}catch(error){
    if(error.code!=='EEXIST')throw error;
    // A just-created lock may not have a PID yet. Never steal it during this window.
    if(livePid(path.join(directory,'pid'))||Date.now()-fs.statSync(directory).mtimeMs<30000)return false;
    try{fs.rmSync(directory,{recursive:true});fs.mkdirSync(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')return false;throw error;}
  }
  fs.writeFileSync(path.join(directory,'pid'),String(process.pid),{mode:0o600});return true;
}
export function releaseLock(directory) {try{if(fs.readFileSync(path.join(directory,'pid'),'utf8')===String(process.pid))fs.rmSync(directory,{recursive:true});}catch{}}
export async function stopClient(root,{timeout=20000}={}) {
  fs.writeFileSync(path.join(root,'maintenance.flag'),'stopped',{mode:0o600});
  const deadline=Date.now()+timeout;
  while(livePid(path.join(root,'runner-lock','pid'))||livePid(path.join(root,'agent.lock'))){
    if(Date.now()>deadline)throw new Error('Client is still stopping. Retry after it exits.');
    await sleep(200);
  }
  fs.rmSync(path.join(root,'runner-lock'),{recursive:true,force:true});
  fs.rmSync(path.join(root,'agent.lock'),{force:true});
}
export function startupFile(root,platform=process.platform,env=process.env,home=os.homedir()) {
  return platform==='win32'?path.join(env.APPDATA??path.join(home,'AppData','Roaming'),'Microsoft','Windows','Start Menu','Programs','Startup','Desktop Bridge.lnk'):platform==='darwin'?path.join(home,'Library','LaunchAgents','de.desktopbridge.agent.plist'):path.join(env.XDG_CONFIG_HOME??path.join(home,'.config'),'autostart','desktop-bridge.desktop');
}
export async function removeStartup(root) {
  if(process.platform==='win32'){
    const {windowsBackground}=await import('./windows-background.mjs');
    await windowsBackground('remove',root);
  }
  const file=startupFile(root);
  if(process.platform==='darwin'&&fs.existsSync(file))try{await run('launchctl',['bootout','gui/'+process.getuid(),file],{stdio:'ignore'});}catch{}
  fs.rmSync(file,{force:true});
}

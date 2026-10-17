// Privileged entry point. Never run automatically from a network request.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {protectedRoot,SERVICE_ID,WINDOWS_TASK,isAdministrator,assertProtectedParents,validateSource,copyTreeSafe,secureTree,rewritePaths,serviceSpec,writePrivateJson} from './admin-runtime.mjs';

const platform=process.platform;
const root=protectedRoot();
const serviceFile=platform==='darwin'?'/Library/LaunchDaemons/'+SERVICE_ID+'.plist':
  platform==='linux'?'/etc/systemd/system/desktop-bridge-administrator.service':null;

function cmd(program,args,optional=false) {
 const result=spawnSync(program,args,{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
 if(result.error||(!optional&&result.status!==0))throw new Error(program+' failed: '+(result.error?.message??result.status));
 return result.status===0;
}
function winPs(text,optional=false) {
 return cmd('powershell.exe',['-NoProfile','-NonInteractive','-Command',text],optional);
}
const ps=s=>"'"+String(s).replace(/'/g,"''")+"'";
const nodeIn=root=> {
 const runtime=path.join(root,'runtime');
 const entries=fs.readdirSync(runtime).filter(s=>s.startsWith('node-v24.')&&s.endsWith('-'+platform+'-'+process.arch));
 if(entries.length!==1)throw new Error('Expected exactly one verified private Node runtime.');
 const filename=path.join(runtime,entries[0],platform==='win32'?'node.exe':'bin/node');
 if(!fs.statSync(filename).isFile())throw new Error('Protected Node executable is not a file.');
 return filename;
};
function taskInstall(node) {
 const arg='"'+path.join(root,'runner.mjs')+'" "'+root+'"';
 const script="$ErrorActionPreference='Stop';"+
   "$a=New-ScheduledTaskAction -Execute "+ps(node)+" -Argument "+ps(arg)+" -WorkingDirectory "+ps(root)+";"+
   "$t=New-ScheduledTaskTrigger -AtStartup;"+
   "$p=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;"+
   "$s=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable;"+
   "Register-ScheduledTask -TaskName "+ps(WINDOWS_TASK)+" -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null;"+
   "Start-ScheduledTask -TaskName "+ps(WINDOWS_TASK);
 winPs(script);
}
function stopService() {
 if(platform==='win32'){
   winPs("$t=Get-ScheduledTask -TaskName "+ps(WINDOWS_TASK)+" -ErrorAction SilentlyContinue;if($t){Stop-ScheduledTask -TaskName "+ps(WINDOWS_TASK)+" -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName "+ps(WINDOWS_TASK)+" -Confirm:$false}",true);
 }else if(platform==='darwin'){
   if(fs.existsSync(serviceFile))cmd('launchctl',['bootout','system',serviceFile],true);
   fs.rmSync(serviceFile,{force:true});
 }else if(fs.existsSync(serviceFile)){
   cmd('systemctl',['disable','--now','desktop-bridge-administrator.service'],true);
   fs.rmSync(serviceFile,{force:true});
   cmd('systemctl',['daemon-reload']);
 }
}
function startService() {
 const node=nodeIn(root);
 if(platform==='win32')return taskInstall(node);
 fs.writeFileSync(serviceFile,serviceSpec(platform,root,node),{mode:0o644});
 fs.chownSync(serviceFile,0,0);fs.chmodSync(serviceFile,0o644);
 if(platform==='darwin')cmd('launchctl',['bootstrap','system',serviceFile]);
 else {cmd('systemctl',['daemon-reload']);cmd('systemctl',['enable','--now','desktop-bridge-administrator.service']);}
}
function flag(state) {
 fs.writeFileSync(path.join(root,'maintenance.flag'),state,{mode:0o600});
}
function settings(mode) {
 writePrivateJson(path.join(root,'client-settings.json'),{mode,privilege:'administrator',version:'0.2.2'});
}
function relocate(source,mode) {
 const {base}=validateSource(source);
 const parent=path.dirname(root);
 // Parent folders must be created by an explicitly authorized elevated installer.
 fs.mkdirSync(parent,{recursive:true,mode:0o700});
 if(platform!=='win32'){
   const info=fs.lstatSync(parent);
   if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe administrative parent directory.');
   fs.chownSync(parent,0,0);fs.chmodSync(parent,0o700);
 }else{
   const acl=spawnSync('icacls.exe',[parent,'/inheritance:r','/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F','/Q'],{encoding:'utf8'});
   if(acl.status!==0)throw new Error('Unable to protect administrative parent directory.');
 }
 if(fs.existsSync(root))assertProtectedParents(root);
 const stage=path.join(parent,'.desktop-bridge-admin-stage-'+process.pid);
 const backup=path.join(parent,'.desktop-bridge-admin-backup-'+process.pid);
 fs.mkdirSync(stage,{mode:0o700});
 const selected=['.desktop-bridge-client','agent-config.json','launch.json','runner.mjs','lifecycle.mjs','control.mjs','startup.mjs','install-options.mjs','admin-runtime.mjs','admin-service.mjs','admin-elevate.mjs','runtime','releases'];
 try{
   for(const entry of selected){const file=path.join(base,entry);if(fs.existsSync(file))copyTreeSafe(file,path.join(stage,entry));}
   const oldConfig=fs.existsSync(path.join(root,'agent-config.json'))?JSON.parse(fs.readFileSync(path.join(root,'agent-config.json'),'utf8')):null;
   const config=JSON.parse(fs.readFileSync(path.join(stage,'agent-config.json'),'utf8'));
   const merged=oldConfig?.deviceId&&oldConfig?.deviceToken?{...config,deviceId:oldConfig.deviceId,deviceToken:oldConfig.deviceToken}:config;
   writePrivateJson(path.join(stage,'agent-config.json'),rewritePaths(merged,base,root));
   const launch=JSON.parse(fs.readFileSync(path.join(stage,'launch.json'),'utf8'));
   writePrivateJson(path.join(stage,'launch.json'),rewritePaths(launch,base,root));
   for(const name of ['journal.json','agent.log','agent.log.1']){
     const previous=path.join(root,name);if(fs.existsSync(previous))copyTreeSafe(previous,path.join(stage,name));
     else if(fs.existsSync(path.join(base,name)))copyTreeSafe(path.join(base,name),path.join(stage,name));
   }
   writePrivateJson(path.join(stage,'client-settings.json'),{mode,privilege:'administrator',version:'0.2.2'});
   fs.writeFileSync(path.join(stage,'maintenance.flag'),'installing',{mode:0o600});
   secureTree(stage);
   if(fs.existsSync(root))fs.renameSync(root,backup);
   try{fs.renameSync(stage,root);}
   catch(e){if(fs.existsSync(backup))fs.renameSync(backup,root);throw e;}
   assertProtectedParents(root);
   fs.rmSync(backup,{recursive:true,force:true});
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
async function stopRunner() {
 flag('stopping');
 const {stopClient}=await import('./lifecycle.mjs');
 await stopClient(root);
}
const [action,value,...rest]=process.argv.slice(2);
if(!isAdministrator())throw new Error('Administrator authorization is required; use admin-elevate.mjs instead.');
if(!['install','start','stop','mode','uninstall','status'].includes(action)||(action==='install'?rest.length!==1:rest.length!==0))throw new Error('Usage: admin-service.mjs install <source> manual|background | start | stop | status | mode manual|background | uninstall');
if(action==='install'){
 // install receives two positional values.
 const source=value;const mode=rest[0];
 if(!source||!['manual','background'].includes(mode))throw new Error('install requires source and manual|background');
 if(fs.existsSync(root)){stopService();await stopRunner();}
 relocate(source,mode);
 fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
 if(mode==='background')startService();
 console.log('Administrator '+mode+' mode installed. System privacy controls and ChatGPT tool approvals remain in force.');
}else if(action==='status'){
 if(!fs.existsSync(root))throw new Error('Administrator client has not been installed.');
 const mode=JSON.parse(fs.readFileSync(path.join(root,'client-settings.json'),'utf8')).mode;
 console.log(JSON.stringify({root,mode,privilege:'administrator'}));
}else if(action==='start'){
 assertProtectedParents(root);
 const mode=JSON.parse(fs.readFileSync(path.join(root,'client-settings.json'),'utf8')).mode;
 if(mode==='background'){startService();}else{
   fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
   process.env.BRIDGE_ADMIN_CONTEXT='1';
   cmd(nodeIn(root),[path.join(root,'control.mjs'),'start','--root',root]);
 }
}else if(action==='stop'){
 assertProtectedParents(root);stopService();await stopRunner();console.log('Administrator client stopped.');
}else if(action==='mode'){
 if(!['manual','background'].includes(value))throw new Error('mode must be manual or background');
 assertProtectedParents(root);stopService();await stopRunner();settings(value);
 fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
 if(value==='background')startService();
 console.log('Administrator client mode changed: '+value);
}else if(action==='uninstall'){
 assertProtectedParents(root);stopService();await stopRunner();
 const purge=value==='--purge';
 if(value&&value!=='--purge')throw new Error('Only --purge is accepted for uninstall');
 if(purge)fs.rmSync(root,{recursive:true,force:true});
 else{
   for(const entry of ['runtime','releases','runner.mjs','lifecycle.mjs','control.mjs','startup.mjs','install-options.mjs','admin-runtime.mjs','admin-service.mjs','admin-elevate.mjs','launch.json'])fs.rmSync(path.join(root,entry),{recursive:true,force:true});
 }
 console.log('Administrator service uninstalled. Device revocation is separate.');
}

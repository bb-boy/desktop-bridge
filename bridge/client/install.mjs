import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {dataRoot,run,acquireLock,releaseLock,stopClient,startupFile,removeStartup} from './lifecycle.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const allowed=new Set(['--root','--repair','--no-browser','--no-start','--stop','--uninstall','--purge']);
let customRoot;
for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw new Error('Unknown option: '+args[i]);if(args[i]==='--root'){customRoot=args[++i];if(!customRoot||customRoot.startsWith('--'))throw new Error('--root requires a directory');}}
if(args.includes('--purge')&&!args.includes('--uninstall'))throw new Error('--purge requires --uninstall');
const root=path.resolve(customRoot??dataRoot());
if(root===path.parse(root).root||root===os.homedir()||root===source||source.startsWith(root+path.sep))throw new Error('Choose a dedicated client data directory.');
fs.mkdirSync(root,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(root,0o700);
const installLock=path.join(root,'install-lock');
if(!acquireLock(installLock))throw new Error('Another client maintenance operation is running.');
process.on('exit',()=>releaseLock(installLock));
if(process.platform==='win32'){
  const identity=process.env.USERDOMAIN?`${process.env.USERDOMAIN}\\${process.env.USERNAME}`:process.env.USERNAME;
  if(!identity)throw new Error('Cannot identify the signed-in Windows account.');
  await run('icacls.exe',[root,'/inheritance:r','/grant:r',identity+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F','/T','/Q']);
}
if(args.includes('--uninstall')&&!fs.existsSync(path.join(root,'.desktop-bridge-client'))){
 let legacy;try{legacy=JSON.parse(fs.readFileSync(path.join(root,'agent-config.json'),'utf8'));}catch{}
 if(!legacy?.mcpEntry||!legacy?.runtimeDir)throw new Error('This directory is not a recognized client installation.');
}
await stopClient(root);
if(args.includes('--stop')){console.log('Client stopped. Run the installer to resume.');process.exit(0);}
if(args.includes('--uninstall')){
  await removeStartup(root);
  // Keep credentials and result journal by default so a reinstall can recover them.
  for(const name of ['releases','runtime','runner.mjs','lifecycle.mjs','launch.json','run-client.cmd','heartbeat.json'])fs.rmSync(path.join(root,name),{recursive:true,force:true});
  if(args.includes('--purge')){releaseLock(installLock);fs.rmSync(root,{recursive:true,force:true});}
  console.log('Client uninstalled. Revoke the device in device management to unlink it.');process.exit(0);
}
fs.writeFileSync(path.join(root,'.desktop-bridge-client'),'desktop-bridge-client\n',{mode:0o600});
if(process.versions.node.split('.')[0]!=='24')throw new Error('Use Install.cmd, Install.command or Install.sh to prepare the supported Node 24 runtime.');
const runtime=path.join(root,'runtime','node-v24.19.0-'+process.platform+'-'+process.arch);
const originalRuntime=process.platform==='win32'?path.dirname(process.execPath):path.dirname(path.dirname(process.execPath));
const node=path.join(runtime,process.platform==='win32'?'node.exe':'bin/node');
if(!fs.existsSync(runtime)||fs.realpathSync(originalRuntime)!==fs.realpathSync(runtime)){
  fs.mkdirSync(path.dirname(runtime),{recursive:true,mode:0o700});
  fs.cpSync(originalRuntime,runtime,{recursive:true,force:true,verbatimSymlinks:true});
}
const npm=path.join(runtime,process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'lib/node_modules/npm/bin/npm-cli.js');
if(!fs.existsSync(npm))throw new Error('Official Node runtime must include npm. Run the platform installer.');
const release=path.join(root,'releases','0.2.0'),configPath=path.join(root,'agent-config.json');
fs.mkdirSync(release,{recursive:true,mode:0o700});
for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,file),path.join(release,file));
const agentSource=fs.existsSync(path.join(source,'agent'))?path.join(source,'agent'):path.join(source,'..','agent');
fs.cpSync(agentSource,path.join(release,'agent'),{recursive:true,force:true});
for(const file of ['runner.mjs','lifecycle.mjs'])fs.copyFileSync(path.join(source,file),path.join(root,file));
console.log('Preparing local tools. The first installation downloads dependencies…');
await run(node,[npm,'ci','--omit=dev','--ignore-scripts','--no-fund','--no-audit'],{cwd:release,env:{...process.env,PATH:path.dirname(node)+path.delimiter+(process.env.PATH??'')}});
let config=JSON.parse(fs.readFileSync(fs.existsSync(configPath)?configPath:path.join(source,'connection.json'),'utf8').replace(/^\uFEFF/,''));
config={...config,runtimeDir:release,mcpEntry:path.join(release,'node_modules','@wonderwhy-er','desktop-commander','dist','index.js'),defaultShell:process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'/bin/zsh':'/bin/bash'};
fs.writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});
fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
const pairArgs=[path.join(release,'agent','agent.mjs'),configPath,'--setup-only'];
if(args.includes('--repair'))pairArgs.push('--pair');if(args.includes('--no-browser'))pairArgs.push('--no-browser');
try{await run(node,pairArgs);}catch(error){fs.writeFileSync(path.join(root,'maintenance.flag'),'pairing failed',{mode:0o600});throw error;}
fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({agent:path.join(release,'agent','agent.mjs'),config:configPath}),{mode:0o600});
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ps=s=>"'"+String(s).replace(/'/g,"''")+"'";
const quote=s=>'"'+String(s).replace(/(["\\`$])/g,'\\$1')+'"';
if(args.includes('--no-start'))await removeStartup(root);
else {
 const file=startupFile(root);fs.mkdirSync(path.dirname(file),{recursive:true});
 if(process.platform==='win32'){
  const runnerCmd=path.join(root,'run-client.cmd');
  fs.writeFileSync(runnerCmd,'@echo off\r\n"'+node.replace(/%/g,'%%')+'" "'+path.join(root,'runner.mjs').replace(/%/g,'%%')+'" "'+root.replace(/%/g,'%%')+'"\r\n');
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${ps(file)});$s.TargetPath=${ps(process.env.WINDIR+'\\System32\\cmd.exe')};$s.Arguments=${ps('/c ""'+runnerCmd+'""')};$s.WorkingDirectory=${ps(root)};$s.WindowStyle=7;$s.Save()`]);
 }else if(process.platform==='darwin'){
  fs.writeFileSync(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>de.desktopbridge.agent</string><key>ProgramArguments</key><array>${[node,path.join(root,'runner.mjs'),root].map(s=>'<string>'+xml(s)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>WorkingDirectory</key><string>${xml(root)}</string></dict></plist>`);
  try{await run('launchctl',['bootout','gui/'+process.getuid(),file],{stdio:'ignore'});}catch{}
  try{await run('launchctl',['bootstrap','gui/'+process.getuid(),file],{stdio:'ignore'});}catch{console.log('Automatic startup saved; it takes effect at the next graphical login.');}
 }else{
  fs.writeFileSync(file,`[Desktop Entry]\nType=Application\nName=Desktop Bridge\nExec=${[node,path.join(root,'runner.mjs'),root].map(s=>quote(s).replace(/%/g,'%%')).join(' ')}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
 }
 const child=spawn(node,[path.join(root,'runner.mjs'),root],{detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
console.log(args.includes('--no-start')?'Installed and paired. Background startup disabled.':'Installed and paired. Client starts automatically when you sign in.');
console.log('Device management: '+config.serverUrl);

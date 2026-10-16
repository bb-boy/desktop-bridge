import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const source=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),opt=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const root=path.resolve(opt('--root')??(process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'DesktopBridgeClient'):process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','DesktopBridge'):path.join(process.env.XDG_DATA_HOME??path.join(os.homedir(),'.local','share'),'desktop-bridge')));
const release=path.join(root,'releases','0.2.0'),configPath=path.join(root,'agent-config.json');
fs.mkdirSync(root,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(root,0o700);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function run(command,argv,options={}){return new Promise((resolve,reject)=>{const p=spawn(command,argv,{stdio:'inherit',...options});p.on('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error('安装步骤失败 ('+path.basename(command)+', '+code+')')));});}
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ps=s=>"'"+String(s).replace(/'/g,"''")+"'";
const quote=s=>'"'+String(s).replace(/(["\\`$])/g,'\\$1')+'"';
fs.writeFileSync(path.join(root,'maintenance.flag'),'installing',{mode:0o600});
for(let i=0;fs.existsSync(path.join(root,'runner-lock'))&&i<30;i++)await sleep(500);
if(fs.existsSync(path.join(root,'runner-lock'))){const pidFile=path.join(root,'runner-lock','pid');let alive=false;try{process.kill(Number(fs.readFileSync(pidFile,'utf8')),0);alive=true;}catch{}if(alive)throw new Error('客户端仍在退出，请稍后重新运行安装器');fs.rmSync(path.join(root,'runner-lock'),{recursive:true});}
fs.mkdirSync(release,{recursive:true,mode:0o700});
for(const f of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,f),path.join(release,f));
fs.cpSync(path.join(source,'agent'),path.join(release,'agent'),{recursive:true});
fs.copyFileSync(path.join(source,'runner.mjs'),path.join(root,'runner.mjs'));
const nodeDir=path.dirname(process.execPath),npm=path.join(nodeDir,process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js');
console.log('正在自动准备本地工具，首次安装需要下载依赖……');
await run(process.execPath,[npm,'ci','--prefix',release,'--omit=dev','--ignore-scripts','--no-fund','--no-audit'],{env:{...process.env,PATH:nodeDir+path.delimiter+process.env.PATH}});
let config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')):JSON.parse(fs.readFileSync(path.join(source,'connection.json'),'utf8'));
config={...config,runtimeDir:release,mcpEntry:path.join(release,'node_modules','@wonderwhy-er','desktop-commander','dist','index.js'),defaultShell:process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'/bin/zsh':'/bin/bash'};
fs.writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});
fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
const pairArgs=[path.join(release,'agent','agent.mjs'),configPath,'--setup-only'];
if(args.includes('--repair'))pairArgs.push('--pair');if(args.includes('--no-browser'))pairArgs.push('--no-browser');
await run(process.execPath,pairArgs);
fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({agent:path.join(release,'agent','agent.mjs'),config:configPath}),{mode:0o600});
let startup=false;
if(!args.includes('--no-start')){
  if(process.platform==='win32'){
    const startupDir=path.join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs','Startup');
    const runnerCmd=path.join(root,'run-client.cmd');
    fs.writeFileSync(runnerCmd,'@echo off\r\n"'+process.execPath+'" "'+path.join(root,'runner.mjs')+'" "'+root+'"\r\n');
    const code=`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${ps(path.join(startupDir,'Desktop Bridge.lnk'))});$s.TargetPath=${ps(process.env.WINDIR+'\\System32\\cmd.exe')};$s.Arguments=${ps('/c ""'+runnerCmd+'""')};$s.WorkingDirectory=${ps(root)};$s.WindowStyle=7;$s.Save()`;
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',code]);startup=true;
  }else if(process.platform==='darwin'){
    const agents=path.join(os.homedir(),'Library','LaunchAgents');fs.mkdirSync(agents,{recursive:true});
    const plist=path.join(agents,'de.desktopbridge.agent.plist');
    fs.writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>de.desktopbridge.agent</string><key>ProgramArguments</key><array>${[process.execPath,path.join(root,'runner.mjs'),root].map(s=>'<string>'+xml(s)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>WorkingDirectory</key><string>${xml(root)}</string></dict></plist>`);
    try{await run('launchctl',['bootout','gui/'+process.getuid(),plist],{stdio:'ignore'});}catch{}
    try{await run('launchctl',['bootstrap','gui/'+process.getuid(),plist],{stdio:'ignore'});startup=true;}catch{console.log('自动启动配置已保存，下次图形界面登录后生效。');}
  }else if(process.platform==='linux'){
    const autostart=path.join(process.env.XDG_CONFIG_HOME??path.join(os.homedir(),'.config'),'autostart');fs.mkdirSync(autostart,{recursive:true});
    fs.writeFileSync(path.join(autostart,'desktop-bridge.desktop'),`[Desktop Entry]\nType=Application\nName=Desktop Bridge\nExec=${[process.execPath,path.join(root,'runner.mjs'),root].map(s=>quote(s).replace(/%/g,'%%')).join(' ')}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
    startup=true;
  }
  // The runner lock prevents a second process when launchd started it already.
  const p=spawn(process.execPath,[path.join(root,'runner.mjs'),root],{detached:true,stdio:'ignore'});p.unref();
}
console.log('安装和配对完成。'+(startup?'已配置登录后自动启动。':args.includes('--no-start')?'未启动后台客户端。':'客户端已启动。'));
console.log('设备管理：'+config.serverUrl);

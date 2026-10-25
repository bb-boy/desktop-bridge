import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {run,startupFile,removeStartup,stopClient,livePid,sleep,linuxSystemdUnitFile,startupRootId,ensureOwnedStartup} from './lifecycle.mjs';
export const shellQuote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
export const powershellQuote=value=>"'"+String(value).replace(/'/g,"''")+"'";
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const desktopQuote=s=>'"'+String(s).replace(/(["\\`$])/g,'\\$1').replace(/%/g,'%%')+'"';
// systemd's percent-specifiers remain active inside quotes; escape them even
// when paths are quoted. Shell expansion must not occur in a unit file.
const systemdQuote=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%')+'"';
// systemd 249 treats quotes on WorkingDirectory as part of its value.
// A directory property takes an unquoted absolute path with C-style escapes.
const systemdDirectory=value=>String(value).replace(/[\\ 	"%]/g,c=>({
 '\\':String.raw`\x5c`, ' ':String.raw`\x20`, '\t':String.raw`\x09`, '"':String.raw`\x22`, '%':'%%'
}[c]));
export function linuxSystemdUnitContent(node,root) {
 return `[Unit]\nDescription=Desktop Bridge (user session)\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\n# DesktopBridge-Root: ${startupRootId(root)}\nExecStart=${[node,path.join(root,'runner.mjs'),root].map(systemdQuote).join(' ')}\nWorkingDirectory=${systemdDirectory(root)}\nRestart=on-failure\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n`;
}
async function userSystemdAvailable(){
 try{await run('systemctl',['--user','show-environment'],{stdio:'ignore'});return true;}catch{return false;}
}
export function commandFor(node,root,action,platform=process.platform) {
 const argv=[node,path.join(root,'control.mjs'),...action.split(' ')];
 return platform==='win32'?'& '+argv.map(powershellQuote).join(' '):argv.map(shellQuote).join(' ');
}
export function startupContent(node,root,platform=process.platform) {
 if(platform==='darwin')return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>de.desktopbridge.agent</string><key>ProgramArguments</key><array>${[node,path.join(root,'runner.mjs'),root].map(s=>'<string>'+xml(s)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>WorkingDirectory</key><string>${xml(root)}</string></dict></plist>`;
 if(platform==='linux')return `[Desktop Entry]\nType=Application\nName=Desktop Bridge\nExec=${[node,path.join(root,'runner.mjs'),root].map(desktopQuote).join(' ')}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
 throw new Error('Use the Windows startup shortcut helper.');
}
export async function registerStartup(node,root,{start=true}={}) {
 const file=startupFile(root);
 if(process.platform==='win32'){
  const {windowsBackground}=await import('./windows-background.mjs');
  await windowsBackground('register',root,node);
  return;
 }
 ensureOwnedStartup(file,root,process.platform);
 if(process.platform==='linux'){
  const unit=linuxSystemdUnitFile();
  ensureOwnedStartup(unit,root,'systemd');
  if(await userSystemdAvailable()){
   fs.mkdirSync(path.dirname(unit),{recursive:true,mode:0o700});
   fs.writeFileSync(unit,linuxSystemdUnitContent(node,root),{mode:0o600});
   await run('systemctl',['--user','daemon-reload'],{stdio:'ignore'});
   await run('systemctl',['--user','enable',...(start?['--now']:[]),'desktop-bridge.service'],{stdio:'ignore'});
   // The old GUI autostart must not launch a second instance at login.
   fs.rmSync(file,{force:true});
   return;
  }
  if(fs.existsSync(unit))throw new Error('Existing systemd user service is unavailable; refusing to overwrite the selected startup backend.');
  console.log('用户级 systemd 不可用；使用图形桌面登录自启。纯终端 Linux 请启用 systemd --user。');
 }
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(file,startupContent(node,root),{mode:0o600});
 if(process.platform==='darwin'){
  try{await run('launchctl',['bootout','gui/'+process.getuid(),file],{stdio:'ignore'});}catch{}
  try{await run('launchctl',['bootstrap','gui/'+process.getuid(),file],{stdio:'ignore'});}catch{console.log('登录自启设置已保存，下次登录图形界面时生效。');}
 }
}
export function writeInstructions(root,node,mode,privilege='standard') {
 const contents=`Desktop Bridge 0.2.7 使用说明\n\n权限：${privilege==='administrator'?'管理员（操作将由系统提示授权；后台使用受保护系统服务）':'当前用户'}\n当前模式：${mode==='manual'?'手动 manual':'后台 background'}\n${mode==='manual'?'使用时运行启动命令，保持窗口，按 Ctrl+C 或关闭窗口结束。客户端与本地工具进程会一起停止。未设置登录自启。':'客户端现在后台运行，登录系统后自动启动。这是当前用户登录后自启，不是登录前的系统服务。'}\n\n${process.platform==='win32'?'请将以下命令复制到 PowerShell。':'请将以下命令复制到终端。'}\n\n启动：\n${commandFor(node,root,'start')}\n\n停止：\n${commandFor(node,root,'stop')}\n\n状态：\n${commandFor(node,root,'status')}\n\n切换为手动模式（停止后台实例，移除登录自启）：\n${commandFor(node,root,'mode manual')}\n\n切换为后台模式（现在启动，登录系统后自动启动）：\n${commandFor(node,root,'mode background')}\n\n本目录中的快捷入口：${process.platform==='win32'?'Start.cmd / Stop.cmd':process.platform==='darwin'?'Start.command / Stop.command':'start.sh / stop.sh'}。\n启动、停止和切换模式使用已安装的私有环境，不会重新安装依赖。\n\n重新配对（旧 Token 失效时）：\n${commandFor(node,root,'pair')}\n${process.platform==='win32'?'或双击 RePair.cmd。':'在终端执行上述命令。'}\n配对必须由用户在网页重新确认。\n如果出现 authStatus=re_pair_required，请先重新配对。\n\n请保留本目录，其中保存设备凭据、日志与可恢复的任务结果。停止不会删除这些数据。\n`;
 fs.writeFileSync(path.join(root,'START-HERE.txt'),contents+(privilege==='administrator'?'\n管理员模式下，普通用户不能修改后台程序文件。系统隐私、Google 登录与 ChatGPT 工具确认仍需分别授权。\n':''),{mode:0o600});
}
export async function startBackground(root,node) {
 let auth={};try{auth=JSON.parse(fs.readFileSync(path.join(root,'auth-status.json'),'utf8'));}catch{}
 if(auth.authStatus==='re_pair_required')throw new Error('设备需要重新配对。请先执行 RePair.cmd 或 control.mjs pair。');
 if(livePid(path.join(root,'runner-lock','pid'))){console.log('Client is already running.');return;}
 fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
 if(process.platform==='win32'){
  const {windowsBackground}=await import('./windows-background.mjs');
  await windowsBackground('start',root,node);
  for(let i=0;i<60;i++){
   if(livePid(path.join(root,'runner-lock','pid')))return;
   await sleep(250);
  }
  throw new Error('后台任务尚未启动。当前用户需已登录 Windows；请检查任务计划程序后重试。');
 }
 if(process.platform==='linux'&&fs.existsSync(linuxSystemdUnitFile())){
  const unit=linuxSystemdUnitFile();ensureOwnedStartup(unit,root,'systemd');
  await run('systemctl',['--user','start','desktop-bridge.service'],{stdio:'ignore'});
  for(let i=0;i<60;i++){
   if(livePid(path.join(root,'runner-lock','pid')))return;
   await sleep(250);
  }
  throw new Error('systemd --user 未能启动 Agent。请检查 systemctl --user status desktop-bridge.service。');
 }
 const child=spawn(node,[path.join(root,'runner.mjs'),root],{detached:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
export async function setMode(root,node,mode) {
 if(!['manual','background'].includes(mode))throw new Error('Mode must be manual or background');
 await stopClient(root);
 // Reinstalling an existing Windows background client must reuse its task.
 // Removing it first can fail with 0x80070005 under a limited user token.
 // Manual mode still removes login startup; other platforms retain their refresh.
 if(process.platform!=='win32'||mode==='manual')await removeStartup(root);
 const settings={mode,version:'0.2.7'};
 fs.writeFileSync(path.join(root,'client-settings.json.tmp'),JSON.stringify(settings,null,2),{mode:0o600});
 fs.renameSync(path.join(root,'client-settings.json.tmp'),path.join(root,'client-settings.json'));
 writeInstructions(root,node,mode);
 if(mode==='background'){
   let auth={};try{auth=JSON.parse(fs.readFileSync(path.join(root,'auth-status.json'),'utf8'));}catch{}
   const canStart=auth.authStatus!=='re_pair_required';
   // A LaunchAgent/systemd service starts during registration. Clear the
   // maintenance flag *before* that start, or it immediately exits and leaves
   // a detached (unmanaged) fallback runner until the next login.
   if(canStart)fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
   await registerStartup(node,root,{start:canStart});
   if(canStart)await startBackground(root,node);
   else console.log('启动模式已保存，但授权已撤销。请先运行 RePair.cmd 重新配对。');
 }
}

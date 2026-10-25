import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ensureRuntime,prepareDependencies,verifyLocalTools} from './environment.mjs';
import {ensureCuaDriver} from './cua-driver.mjs';
import {parseInstallerOptions,chooseMode,savedMode} from './install-options.mjs';
import {setMode,commandFor,writeInstructions} from './startup.mjs';
import {elevationRequest} from './admin-elevate.mjs';
import {dataRoot,run,acquireLock,releaseLock,stopClient,removeStartup} from './lifecycle.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
const options=parseInstallerOptions(process.argv.slice(2));
// An in-band remote upgrade would terminate the same MCP process running it.
// Stop before any filesystem, service or account modifications.
if(process.env.DESKTOP_BRIDGE_REMOTE_AGENT==='1'&&!options.stop&&!options.uninstall)
  throw new Error('Cannot upgrade Desktop Bridge from its own remote MCP terminal. Run desktop-bridge update --with-cua in a local Mac/Windows/Linux terminal.');
const root=path.resolve(options.root??dataRoot());
const previousSettings=fs.existsSync(path.join(root,'client-settings.json'))?JSON.parse(fs.readFileSync(path.join(root,'client-settings.json'),'utf8')):{};
if(previousSettings.privilege==='administrator'&&(options.stop||options.uninstall))throw new Error('Administrator installation uses the installed control/administrator uninstall helper; user-mode cleanup would leave the protected service active.');
const adminRequested=!!(options.administrator||previousSettings.privilege==='administrator');
const mode=await chooseMode(options,{previous:options.stop||options.uninstall?undefined:savedMode(root)});
if(root===path.parse(root).root||root===os.homedir()||root===source||source.startsWith(root+path.sep))throw new Error('Choose a dedicated client data directory.');
fs.mkdirSync(root,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(root,0o700);
const installLock=path.join(root,'install-lock');
if(!acquireLock(installLock))throw new Error('Another client maintenance operation is running.');
process.on('exit',()=>releaseLock(installLock));
if(process.platform==='win32'){
  // SSH can set USERDOMAIN to WORKGROUP. Resolve the actual Windows token SID.
  const account=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=account.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
  if(!sid)throw new Error('Cannot identify the signed-in Windows account SID.');
  const identity='*'+sid;
  // Change only the root ACL. Recursive /inheritance:r clears file ACLs on Windows.
  await run('icacls.exe',[root,'/inheritance:r','/grant:r',identity+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F','/Q']);
}
if(options.uninstall&&!fs.existsSync(path.join(root,'.desktop-bridge-client'))){
 let legacy;try{legacy=JSON.parse(fs.readFileSync(path.join(root,'agent-config.json'),'utf8'));}catch{}
 if(!legacy?.mcpEntry||!legacy?.runtimeDir)throw new Error('This directory is not a recognized client installation.');
}
// Preflight Cua installation while the previous Agent is still running. An
// installer or permission failure must not strand a working Desktop Bridge.
const oldConfigFile=path.join(root,'agent-config.json');
const oldConfig=fs.existsSync(oldConfigFile)?JSON.parse(fs.readFileSync(oldConfigFile,'utf8')):{};
const needsCua=!options.uninstall&&!options.stop&&(options.withCua||oldConfig.cuaDriver?.enabled===true);
if(adminRequested&&options.withCua)throw new Error('Cua requires a standard desktop user session, not an administrator service.');
const cuaSettings=needsCua&&!adminRequested?await ensureCuaDriver({root,existingCommand:oldConfig.cuaDriver?.command}):null;
await stopClient(root);
if(options.stop){console.log('Client stopped. Use your installed Start shortcut or control.mjs start to resume.');process.exit(0);}
if(options.uninstall){
  await removeStartup(root);
  // Keep credentials and result journal by default so a reinstall can recover them.
  for(const name of ['releases','runtime','runner.mjs','lifecycle.mjs','control.mjs','startup.mjs','windows-background.mjs','install-options.mjs','admin-runtime.mjs','admin-service.mjs','admin-elevate.mjs','launch.json','run-client.cmd','heartbeat.json','START-HERE.txt','Start.cmd','Stop.cmd','RePair.cmd','Start.command','Stop.command','start.sh','stop.sh','launch.sh','control.ps1'])fs.rmSync(path.join(root,name),{recursive:true,force:true});
  if(options.purge){releaseLock(installLock);fs.rmSync(root,{recursive:true,force:true});}
  console.log('Client uninstalled. Revoke the device in device management to unlink it.');process.exit(0);
}
fs.writeFileSync(path.join(root,'.desktop-bridge-client'),'desktop-bridge-client\n',{mode:0o600});
if(process.versions.node.split('.')[0]!=='24')throw new Error('Use Install.cmd, Install.command or Install.sh to prepare the supported Node 24 runtime.');
const {node,npm}=await ensureRuntime(root,source);
const release=path.join(root,'releases','0.2.8'),configPath=path.join(root,'agent-config.json');
fs.mkdirSync(release,{recursive:true,mode:0o700});
for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,file),path.join(release,file));
const agentSource=fs.existsSync(path.join(source,'agent'))?path.join(source,'agent'):path.join(source,'..','agent');
fs.cpSync(agentSource,path.join(release,'agent'),{recursive:true,force:true});
for(const file of ['runner.mjs','lifecycle.mjs','control.mjs','startup.mjs','windows-background.mjs','install-options.mjs','admin-runtime.mjs','admin-service.mjs','admin-elevate.mjs','Start.cmd','Stop.cmd','RePair.cmd','Start.command','Stop.command','start.sh','stop.sh','launch.sh','control.ps1'])fs.copyFileSync(path.join(source,file),path.join(root,file));
await prepareDependencies({node,npm,release,force:!!options.repair});
try{await verifyLocalTools({node,release,workingDirectory:root});}
catch{
 console.log('本地工具验证未通过，正在自动重新安装依赖后重试一次……');
 await prepareDependencies({node,npm,release,force:true});
 try{await verifyLocalTools({node,release,workingDirectory:root});}
 catch{throw new Error('本地工具仍无法执行，安装尚未完成。请检查目录权限、安全软件或网络后重试；客户端保持停止状态。');}
}
let config=JSON.parse(fs.readFileSync(fs.existsSync(configPath)?configPath:path.join(source,'connection.json'),'utf8').replace(/^\uFEFF/,''));
config={...config,runtimeDir:release,mcpEntry:path.join(release,'node_modules','@wonderwhy-er','desktop-commander','dist','index.js'),defaultShell:process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'/bin/zsh':'/bin/bash'};
if(cuaSettings)config.cuaDriver=cuaSettings;
fs.writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});
fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
const pairArgs=[path.join(release,'agent','agent.mjs'),configPath,'--setup-only'];
if(options.repair)pairArgs.push('--pair');if(options.noBrowser)pairArgs.push('--no-browser');
try{await run(node,pairArgs);}catch(error){fs.writeFileSync(path.join(root,'maintenance.flag'),'pairing failed',{mode:0o600});throw error;}
fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({node,agent:path.join(release,'agent','agent.mjs'),config:configPath}),{mode:0o600});
await setMode(root,node,adminRequested?'manual':mode);
if(adminRequested){
  // Pair before privilege elevation. The protected service is never installed
  // until the OS shows a UAC/sudo prompt and the user explicitly approves it.
  const helper=path.join(root,'admin-elevate.mjs');
  const request=elevationRequest('install',{source:root,mode});
  await run(request.command,request.args);
  fs.writeFileSync(path.join(root,'client-settings.json'),JSON.stringify({mode,privilege:'administrator',version:'0.2.8'},null,2),{mode:0o600});
  writeInstructions(root,node,mode,'administrator');
}
console.log(adminRequested?'管理员运行已授权并配置：'+mode+'。':mode==='manual'?'安装和配对完成：手动模式。使用时运行启动命令，保持窗口，按 Ctrl+C 结束；没有后台实例或登录自启。':'安装和配对完成：后台模式。客户端现在后台运行，登录系统后自动启动。');
console.log('启动命令： '+commandFor(node,root,'start'));
console.log('停止命令： '+commandFor(node,root,'stop'));
console.log('使用说明： '+path.join(root,'START-HERE.txt'));
console.log('设备管理： '+config.serverUrl);

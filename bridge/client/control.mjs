import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {dataRoot,acquireLock,releaseLock,livePid,stopClient} from './lifecycle.mjs';
import {savedMode} from './install-options.mjs';
import {setMode,startBackground,writeInstructions} from './startup.mjs';
import {elevationRequest} from './admin-elevate.mjs';
import {run} from './lifecycle.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);let customRoot;
for(let index=0;index<args.length;index++)if(args[index]==='--root'){if(!args[index+1]||args[index+1].startsWith('--'))throw new Error('--root requires a directory');customRoot=args[index+1];args.splice(index,2);index--;}
const [action,value,...extra]=args;
if(!['start','stop','status','mode','pair'].includes(action)||extra.length||(action==='mode'?!['manual','background'].includes(value):value!==undefined))throw new Error('Usage: control.mjs start|stop|status|pair|mode manual|background [--root directory]');
const root=path.resolve(customRoot??(fs.existsSync(path.join(source,'.desktop-bridge-client'))?source:dataRoot()));
const launch=JSON.parse(fs.readFileSync(path.join(root,'launch.json'),'utf8'));
let settings={};try{settings=JSON.parse(fs.readFileSync(path.join(root,'client-settings.json'),'utf8'));}catch{}
const authStatusPath=path.join(root,'auth-status.json');
let authStatus={};try{authStatus=JSON.parse(fs.readFileSync(authStatusPath,'utf8'));}catch{}
const needsPair=authStatus.authStatus==='re_pair_required';
const pairHelp=process.platform==='win32'?path.join(root,'RePair.cmd'):'Run control.mjs pair locally';
if(!launch.node||!fs.existsSync(launch.node))throw new Error('私有运行环境缺失，请重新运行安装器自动修复。');
if(settings.privilege==='administrator'&&process.env.BRIDGE_ADMIN_CONTEXT!=='1'){
 if(action==='status'){console.log(JSON.stringify({mode:settings.mode,privilege:'administrator',authStatus:authStatus.authStatus??'unknown',note:'Administrator service status requires local system inspection.'},null,2));process.exit(0);}
 if(action==='pair')throw new Error('管理员服务配对需要在受保护的服务安装器中操作；不能用普通用户命令修改管理员凭据。');
 const request=elevationRequest(action,{mode:value});
 await run(request.command,request.args);
 if(action==='mode'){
   fs.writeFileSync(path.join(root,'client-settings.json'),JSON.stringify({mode:value,privilege:'administrator',version:'0.2.9'},null,2),{mode:0o600});
   writeInstructions(root,launch.node,value,'administrator');
 }
 process.exit(0);
}
if(action==='status'){
 let heartbeat;try{heartbeat=JSON.parse(fs.readFileSync(path.join(root,'heartbeat.json'),'utf8'));}catch{}
 const running=livePid(path.join(root,'runner-lock','pid'));
 let agentPid;try{agentPid=Number(fs.readFileSync(path.join(root,'agent.lock'),'utf8'));}catch{}
 const fresh=running&&heartbeat&&heartbeat.pid===agentPid&&Date.now()-heartbeat.time<90000&&livePid(path.join(root,'agent.lock'));
 let enabledCua=false;try{enabledCua=JSON.parse(fs.readFileSync(launch.config,'utf8')).cuaDriver?.enabled===true;}catch{}
 console.log(JSON.stringify({mode:savedMode(root),running,networkConnected:!!(fresh&&heartbeat.connected),localToolsAvailable:!!(fresh&&heartbeat.localToolsAvailable),cuaEnabled:enabledCua,cuaToolsAvailable:!!(fresh&&heartbeat.cuaToolsAvailable),authStatus:needsPair?'re_pair_required':'ok',...(needsPair?{message:'设备授权已撤销，必须重新配对。',rePairCommand:pairHelp}: {})},null,2));
 process.exit(0);
}
const lock=path.join(root,'install-lock');if(!acquireLock(lock))throw new Error('Another client maintenance operation is running.');
process.on('exit',()=>releaseLock(lock));
if(action==='stop'){await stopClient(root);console.log('客户端已停止。设备凭据、日志和任务结果已保留。');process.exit(0);}
if(action==='mode'){await setMode(root,launch.node,value);console.log(value==='manual'?'已保存手动模式，移除登录自启。使用时运行启动命令，保持窗口，按 Ctrl+C 结束。':'已保存后台模式：登录系统后自动启动。');process.exit(0);}
if(action==='pair') {
  await stopClient(root);
  fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
  try {
    // A new device token is only issued after the user approves in the browser.
    await run(launch.node,[launch.agent,launch.config,'--pair','--setup-only']);
    const fresh=JSON.parse(fs.readFileSync(launch.config,'utf8'));
    if(!fresh.deviceToken||!fresh.deviceId)throw new Error('配对尚未完成');
    fs.rmSync(authStatusPath,{force:true});
    if(savedMode(root)==='background')await startBackground(root,launch.node);
    console.log('重新配对成功。'+(savedMode(root)==='background'?'后台连接已恢复。':'手动模式：可运行 Start.cmd 启动。'));
  } catch(error) {
    fs.writeFileSync(authStatusPath,JSON.stringify({authStatus:'re_pair_required',reason:'pairing_incomplete',detectedAt:new Date().toISOString(),notificationShown:true}),{mode:0o600});
    fs.writeFileSync(path.join(root,'maintenance.flag'),'pairing incomplete',{mode:0o600});
    throw error;
  }
  process.exit(0);
}
if(needsPair&&action==='start'){console.error('设备 Token 已失效，请先运行 '+pairHelp+' 重新配对。');process.exit(2);}
if(livePid(path.join(root,'runner-lock','pid'))){console.log('客户端已在运行。若要重新以前台模式启动，请先运行停止命令。');process.exit(0);}
if(savedMode(root)==='background'){await startBackground(root,launch.node);console.log('客户端已在后台启动。');process.exit(0);}
fs.rmSync(path.join(root,'maintenance.flag'),{force:true});
const runner=fork(path.join(root,'runner.mjs'),[root,'--foreground'],{execPath:launch.node,cwd:root,stdio:['inherit','inherit','inherit','ipc']});
await new Promise((resolve,reject)=>{runner.once('spawn',resolve);runner.once('error',reject);});
releaseLock(lock);
console.log('Desktop Bridge 正在此窗口运行。请保持窗口，按 Ctrl+C 或关闭窗口结束。');
let stopping=false;
function stop(){if(stopping)return;stopping=true;if(runner.connected)try{runner.send({type:'stop'},()=>{});}catch{}}
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,stop);
runner.once('exit',code=>{process.exitCode=stopping?0:code??1;});

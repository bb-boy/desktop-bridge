import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pairDevice,saveConfig } from './pair.mjs';
import { McpToolManager } from './mcp-manager.mjs';

const configPath=process.env.BRIDGE_AGENT_CONFIG??process.argv[2];
if(!configPath) throw new Error('Usage: node agent.mjs path/to/agent-config.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));

const directory=path.dirname(path.resolve(configPath));
if(fs.existsSync(path.join(directory,'maintenance.flag'))) process.exit(0);

const lockPath=path.join(directory,'agent.lock');
try {
  const fd=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
} catch(e) {
  if(e.code!=='EEXIST') throw e;
  // A concurrent process can create the file before writing its PID.
  if(fs.statSync(lockPath).size===0 && Date.now()-fs.statSync(lockPath).mtimeMs<30000)process.exit(0);
  const old=Number(fs.readFileSync(lockPath,'utf8'));
  let alive=false;
  if(Number.isInteger(old) && old>0 && old!==process.pid) {try{process.kill(old,0);alive=true;}catch(err){if(err.code!=='ESRCH')alive=true;}}
  if(alive) process.exit(0);
  fs.unlinkSync(lockPath);
  const fd=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
}
const logPath=path.join(directory,'agent.log');
function log(event,fields={}) {
  try {
    if(fs.existsSync(logPath) && fs.statSync(logPath).size>1024*1024) fs.renameSync(logPath,logPath+'.1');
    fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),event,...fields})+'\n',{mode:0o600});
  } catch {}
}
function unlock(){try{if(fs.readFileSync(lockPath,'utf8')===String(process.pid))fs.unlinkSync(lockPath);}catch{}}
process.on('exit',unlock);

const authStatusPath=path.join(directory,'auth-status.json');
function saveAuthStatus(status) {
  const temporary=authStatusPath+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(status,null,2),{mode:0o600});
  fs.renameSync(temporary,authStatusPath);
}
function notifyRevokedWindows() {
  if(process.platform!=='win32'||process.env.DESKTOP_BRIDGE_SUPPRESS_NOTIFICATIONS==='1'||process.env.USERNAME?.toUpperCase()==='SYSTEM')return;
  let state;try{state=JSON.parse(fs.readFileSync(authStatusPath,'utf8'));}catch{return;}
  if(state.authStatus!=='re_pair_required'||state.notificationShown)return;
  // The warning is informative only. Re-pairing still requires an explicit local
  // click followed by a browser login and device approval.
  const rePair=path.join(directory,'RePair.cmd');
  const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
  const message='Desktop Bridge 的设备授权已撤销，旧凭据已失效。\n\n是否现在重新配对？（需要网页登录确认）';
  const script="Add-Type -AssemblyName System.Windows.Forms;"+
    "$answer=[System.Windows.Forms.MessageBox]::Show("+quote(message)+",'Desktop Bridge',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning);"+
    "if($answer -eq [System.Windows.Forms.DialogResult]::Yes){Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k',"+quote('"' + rePair + '"')+")}";
  try {
    const child=spawn('powershell.exe',['-NoProfile','-Sta','-WindowStyle','Hidden','-Command',script],
      {detached:true,stdio:'ignore',windowsHide:true});
    child.on('error',()=>{});child.unref();
    saveAuthStatus({...state,notificationShown:true});
  } catch { /* The next local status/start command still shows persistent notice. */ }
}
function clearRevokedCredentials(reason,{stop=true}={}) {
  delete config.deviceToken;delete config.deviceId;
  saveConfig(configPath,config);
  let previous={};try{previous=JSON.parse(fs.readFileSync(authStatusPath,'utf8'));}catch{}
  saveAuthStatus({authStatus:'re_pair_required',reason:'device_revoked',
    detectedAt:previous.authStatus==='re_pair_required'?previous.detectedAt??new Date().toISOString():new Date().toISOString(),
    notificationShown:previous.authStatus==='re_pair_required'&&previous.notificationShown===true});
  if(stop)fs.writeFileSync(path.join(directory,'maintenance.flag'),'device authorization revoked',{mode:0o600});
  log('device_authorization_revoked',{reason});
  console.error('设备授权已撤销，旧凭据已清除。请运行 RePair.cmd 重新配对。');
  if(stop)notifyRevokedWindows();
}
async function remoteRevoked() {
  if(!config.deviceId||!config.deviceToken)return false;
  const url=new URL('/api/agent/revocation-status',config.serverUrl);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))return false;
  try {
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({deviceId:config.deviceId}),signal:AbortSignal.timeout(5000)});
    return response.ok&&(await response.json()).revoked===true;
  } catch {return false;} // Never erase credentials on a timeout or ordinary network failure.
}
let revokedAtStartup=false;
if(process.argv.includes('--pair')){delete config.deviceToken;delete config.deviceId;saveConfig(configPath,config);}
else if(await remoteRevoked()) {
  const installing=process.argv.includes('--setup-only');
  clearRevokedCredentials('startup_preflight',{stop:!installing});
  if(!installing){revokedAtStartup=true;process.exitCode=78;}
}
if(!revokedAtStartup&&(!config.deviceToken||!config.deviceId)) {
  await pairDevice(config,configPath,{openBrowser:!process.argv.includes('--no-browser')});
  fs.rmSync(authStatusPath,{force:true}); // New server-approved credentials clear the notice.
}
if(revokedAtStartup){
  // An offline device's credentials were revoked. Let fetch handles close
  // normally on Windows; do not start tools or silently auto-pair.
} else if(process.argv.includes('--setup-only')) {
  // Let active fetch/undici handles close naturally on Windows.
  process.exitCode=0;
} else {
const requireRuntime=createRequire(path.join(config.runtimeDir,'package.json'));
const {Client}=await import(pathToFileURL(requireRuntime.resolve('@modelcontextprotocol/sdk/client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(requireRuntime.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const WebSocket=requireRuntime('ws');
const cuaConfig=config.cuaDriver??{};
const client=new McpToolManager({
  Client,StdioClientTransport,log,
  backends:[
    {id:'desktop',command:process.execPath,args:[config.mcpEntry],cwd:config.workingDirectory??directory,env:{...process.env,DESKTOP_BRIDGE_REMOTE_AGENT:'1'}},
    ...(cuaConfig.enabled===true?[{
      id:'cua',prefix:'cua_',command:cuaConfig.command||'cua-driver',
      args:Array.isArray(cuaConfig.args)?cuaConfig.args:['mcp'],
      cwd:config.workingDirectory??directory,env:{...process.env}
    }]:[])
  ]
});
let ws,retryTimer,stopping=false,attempt=0,localHealthy=false,checkingHealth=false,healthFailures=0,remoteStopping=false;
const heartbeatPath=path.join(directory,'heartbeat.json');
function writeHeartbeat(){try{fs.writeFileSync(heartbeatPath,JSON.stringify({pid:process.pid,time:Date.now(),connected:ws?.readyState===1,localToolsAvailable:localHealthy}),{mode:0o600});}catch{}}
writeHeartbeat();
const processHeartbeat=setInterval(writeHeartbeat,15000);processHeartbeat.unref();
const journalPath=path.join(directory,'journal.json');
let journal={};
try{journal=JSON.parse(fs.readFileSync(journalPath,'utf8'));}catch(e){if(e.code!=='ENOENT'){log('journal_corrupt');process.exit(78);}}
function persist() {
  const entries=Object.entries(journal).filter(([,v])=>v.status==='executing'||Date.now()-(v.time??0)<30*86400000).sort((a,b)=>(b[1].time??0)-(a[1].time??0));
  let bytes=0;
  journal=Object.fromEntries(entries.map(([id,value])=>{
    bytes+=JSON.stringify(value).length;
    return [id,bytes>12*1024*1024?{status:'unknown',time:value.time}:value];
  }));
  fs.writeFileSync(journalPath+'.tmp',JSON.stringify(journal),{mode:0o600});
  fs.renameSync(journalPath+'.tmp',journalPath);
}
for(const entry of Object.values(journal)) if(entry.status==='executing') entry.status='unknown';
persist();
const running=new Map();
async function execute(message,socket) {
  if(!/^[0-9a-f-]{36}$/.test(message.id) || typeof message.name!=='string' || !message.arguments || typeof message.arguments!=='object' || Array.isArray(message.arguments)) return socket.close(1008,'Invalid call');
  const cached=journal[message.id];
  if(cached) {
    if(cached.status==='completed') return send(socket,{type:'result',id:message.id,result:cached.result});
    if(cached.status==='executing') return; // Original execution will answer; never run a duplicate.
    return send(socket,{type:'result',id:message.id,status:'unknown',error:'An earlier execution has an unknown outcome. Inspect the computer before retrying.'});
  }
  if(remoteStopping||(message.name==='shutdown'&&running.size>0))return send(socket,{type:'result',id:message.id,error:'Agent is stopping or has an executing call; no shutdown was performed.'});
  if(running.size>=4) return send(socket,{type:'result',id:message.id,error:'Agent is busy; no command was executed.'});
  journal[message.id]={status:'executing',time:Date.now()};
  persist();
  running.set(message.id,true);
  log('call_started',{id:message.id,tool:message.name});
  try {
    if(message.name==='shutdown') {
      if(Object.keys(message.arguments).length)throw new Error('shutdown accepts no local arguments');
      remoteStopping=true;
      // Persist the stop intent so a runner/service restart cannot immediately reconnect.
      fs.writeFileSync(path.join(directory,'maintenance.flag'),'remote shutdown',{mode:0o600});
      const result={content:[{type:'text',text:JSON.stringify({status:'stopping',computerShutdown:false,restart:'Start Desktop Bridge locally to reconnect.'})}]};
      journal[message.id]={status:'completed',time:Date.now(),result};persist();
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,1000);
        if(socket.readyState!==WebSocket.OPEN){clearTimeout(timer);return resolve();}
        socket.send(JSON.stringify({type:'result',id:message.id,result}),()=>{clearTimeout(timer);resolve();});
      });
      await shutdown();return;
    }
    const args={...message.arguments};
    if(process.platform==='win32' && message.name==='start_process') {
      args.shell??=config.defaultShell;
      if(typeof args.command==='string' && /(?:^|[\\/])(powershell|pwsh)(?:\.exe)?$/i.test(args.shell??'')) {
        args.command='[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.UTF8Encoding]::new($false);'+args.command;
      }
    }
    let result=await client.callTool({name:message.name,arguments:args},undefined,{timeout:110000,maxTotalTimeout:110000});
    if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024) result={isError:true,content:[{type:'text',text:'Tool ran, but its result exceeded the transfer limit. Use smaller pages or save output to a file.'}]};
    journal[message.id]={status:'completed',time:Date.now(),result};persist();
    send(ws,{type:'result',id:message.id,result});
    log('call_finished',{id:message.id,isError:!!result.isError});
  } catch(e) {
    journal[message.id]={status:'unknown',time:Date.now()};persist();
    send(ws,{type:'result',id:message.id,status:'unknown',error:'Local tool request failed; its execution outcome may be unknown. '+String(e.message).slice(0,500)});
    log('call_failed',{id:message.id});
  } finally {running.delete(message.id);}
}
function send(socket,message) {if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
async function shutdown(code=0) {
  if(stopping)return;stopping=true;clearTimeout(retryTimer);
  clearInterval(processHeartbeat);clearInterval(maintenanceWatch);
  ws?.close();
  const timeout=setTimeout(()=>process.exit(code),8000);timeout.unref();
  try{await client.close();}catch{}
  process.exit(code);
}
process.on('message',message=>{if(message?.type==='stop')void shutdown();});
const maintenanceWatch=setInterval(()=>{if(fs.existsSync(path.join(directory,'maintenance.flag')))void shutdown();},1000);maintenanceWatch.unref();
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
process.on('uncaughtException',error=>{log('fatal',{type:error.name});void shutdown(1);});
process.on('unhandledRejection',error=>{log('fatal_rejection',{type:error?.name});void shutdown(1);});
client.onclose=()=>{if(!stopping){log('local_mcp_closed');void shutdown(1);}};
client.onerror=error=>log('local_mcp_error',{type:error.name});
try{await client.start();}catch(error){log('local_mcp_start_failed',{message:String(error.message).slice(0,300)});await shutdown(1);}
const tools=client.listTools().tools;
log('local_mcp_ready',{toolCount:tools.length,pid:process.pid,childPid:client.connections.get('desktop')?.transport.pid});
function recover(id,socket) {
  const entry=journal[id];
  if(entry?.status==='completed')send(socket,{type:'result',id,result:entry.result});
  else if(entry?.status==='executing')send(socket,{type:'result',id,status:'executing'});
  else send(socket,{type:'result',id,status:'unknown',error:'客户端未保留确定结果。请检查电脑上的实际状态；不会自动重试。'});
}
async function checkHealth(socket) {
  if(checkingHealth)return;
  checkingHealth=true;
  try{await client.ping({timeout:5000});const probe=tools.find(t=>['get_config','list_sessions'].includes(t.name));if(probe){const result=await client.callTool({name:probe.name,arguments:{}},undefined,{timeout:5000});if(result.isError)throw new Error('Probe failed');}else await client.listTools({}, {timeout:5000});localHealthy=true;healthFailures=0;}
  catch{localHealthy=false;if(++healthFailures>=3){log('local_health_failed');void shutdown(1);}}
  finally{checkingHealth=false;send(socket,{type:'health',ok:localHealthy});writeHeartbeat();}
}
function connect() {
  if(stopping)return;
  const url=new URL('/agent',config.serverUrl);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  if(url.protocol!=='wss:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Remote connection requires HTTPS');
  const socket=new WebSocket(url,{headers:{Authorization:'Bearer '+config.deviceToken},handshakeTimeout:15000,perMessageDeflate:false,maxPayload:10*1024*1024});
  ws=socket;
  let lastSeen=Date.now(),welcomed=false;
  const heartbeat=setInterval(()=>{if(Date.now()-lastSeen>65000)socket.terminate();},15000);
  socket.on('ping',()=>lastSeen=Date.now());
  socket.on('open',()=>{send(socket,{type:'hello',protocol:2,deviceId:config.deviceId,tools,capabilities:{shutdown:true},version:'0.2.8',platform:process.platform});});
  socket.on('message',data=>{
    lastSeen=Date.now();
    try {
      const message=JSON.parse(data.toString());
      if(message.type==='welcome'){welcomed=true;attempt=0;log('connected');for(const id of message.recover??[])recover(id,socket);}
      else if(message.type==='recover'&&welcomed){for(const id of message.ids??[])recover(id,socket);}
      else if(message.type==='health_check'&&welcomed)void checkHealth(socket);
      else if(message.type==='rotate'&&welcomed){if(!/^[A-Za-z0-9_-]{43}$/.test(message.token))throw new Error('Invalid token');config.deviceToken=message.token;saveConfig(configPath,config);send(socket,{type:'rotate_ack',tokenHash:createHash('sha256').update(message.token).digest('hex')});}
      else if(message.type==='revoked'&&welcomed) {
        clearRevokedCredentials('server_revocation');
        send(socket,{type:'revoked_ack'});
        void shutdown(78);
      }
      else if(message.type==='call' && welcomed) void execute(message,socket);
      else socket.close(1008,'Invalid server message');
    } catch {socket.close(1008,'Invalid server message');}
  });
  socket.on('unexpected-response',(_request,response)=>{
    const status=response.statusCode;response.resume();
    // ws delegates handshake failures to this listener: explicitly finish it
    // so the normal reconnect/stop lifecycle can proceed.
    socket.terminate();
    if(status!==403||stopping)return; // Pauses and other auth failures are not revocations.
    void remoteRevoked().then(revoked=>{
      if(!revoked||stopping)return;
      clearRevokedCredentials('reconnect_rejected');
      void shutdown(78);
    }).catch(()=>{}); // Preserve credentials if status cannot be verified.
  });
  socket.on('error',error=>log('connection_error',{message:String(error.message).slice(0,240)}));
  socket.on('close',(code)=>{
    clearInterval(heartbeat);
    if(stopping)return;
    const delay=Math.min(60000,1000*2**Math.min(attempt++,6))+Math.floor(Math.random()*1000);
    log('disconnected',{code,retryInMs:delay});
    retryTimer=setTimeout(connect,delay);
  });
}
connect();
}

/**
 * Windows-only integration check. Starts an isolated local broker with ephemeral
 * device credentials and a temporary Agent using the installed Cua Driver.
 * Never connects to the production Desktop Bridge endpoint.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server/index.mjs';
import {opaque,hash,passwordHash} from '../server/security.mjs';

const project=fileURLToPath(new URL('../',import.meta.url));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cua-agent-broker-'));
const driver=process.env.LOCALAPPDATA+'\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe';
const token=opaque();
const deviceId='p111-cua-e2e';
let server,agent,stdout='',stderr='';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,description,max=30000) {
 const end=Date.now()+max;
 while(Date.now()<end){
  if(predicate())return;
  if(agent?.exitCode!==null && agent?.exitCode!==undefined)throw new Error('Agent exited before '+description+': '+agent.exitCode);
  await sleep(90);
 }
 throw new Error('Timeout waiting for '+description);
}
try {
 const config={
  baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,
  ownerPasswordHash:await passwordHash('Temporary broker test secret '+randomUUID()),
  devices:[{id:deviceId,name:'Windows Cua test',tokenHash:hash(token)}]
 };
 server=await startServer(config);
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 const agentConfig=path.join(directory,'agent-config.json');
 fs.writeFileSync(agentConfig,JSON.stringify({
  serverUrl:origin,deviceId,deviceToken:token,runtimeDir:project,
  mcpEntry:fileURLToPath(new URL('./fixture-mcp.mjs',import.meta.url)),
  workingDirectory:directory,cuaDriver:{enabled:true,command:driver}
 }));
 agent=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),agentConfig],{
  cwd:project,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,DESKTOP_BRIDGE_SUPPRESS_NOTIFICATIONS:'1'}
 });
 agent.stdout.on('data',d=>{stdout+=d.toString().slice(0,1000);});
 agent.stderr.on('data',d=>{stderr+=d.toString().slice(0,1500);});
 await waitFor(()=>server.broker.connections.get(deviceId)?.ready,'WebSocket hello');
 console.log('BROKER_AGENT_CONNECTED=true');
 await waitFor(()=>server.broker.devices().some(d=>d.id===deviceId&&d.toolsAvailable),'healthy tool catalog');
 const connected=server.broker.connections.get(deviceId);
 const names=server.store.tools(deviceId,'owner').map(t=>t.name);
 console.log('BROKER_TOOL_COUNT='+names.length);
 console.log('HAS_CUA_LIST_WINDOWS='+names.includes('cua_list_windows'));
 console.log('HAS_DESKTOP_INCREMENT='+names.includes('increment'));
 assert.ok(names.includes('cua_list_windows')&&names.includes('increment'),'Both backends must be discoverable');
 const id=randomUUID();
 connected.ws.send(JSON.stringify({type:'call',id,name:'cua_list_windows',arguments:{}}));
 const journalFile=path.join(directory,'journal.json');
 const result=()=>{try{return JSON.parse(fs.readFileSync(journalFile,'utf8'))[id];}catch{return null;}};
 await waitFor(()=>['completed','unknown'].includes(result()?.status),'Cua tool result');
 const entry=result();
 assert.equal(entry.status,'completed',JSON.stringify(entry).slice(0,550));
 assert.match(entry.result?.content?.[0]?.text??'',/Found \d+ window/i);
 console.log('BROKER_RESULT_KEYS='+Object.keys(entry.result?.structuredContent??{}).join(','));
 console.log('BROKER_CUA_WINDOWS_CALL_PASS=true');
 async function remoteCall(name,args){
  const requestId=randomUUID();
  connected.ws.send(JSON.stringify({type:'call',id:requestId,name,arguments:args}));
  const get=()=>{try{return JSON.parse(fs.readFileSync(journalFile,'utf8'))[requestId];}catch{return null;}};
  await waitFor(()=>['completed','unknown'].includes(get()?.status),name+' response');
  const response=get();
  assert.equal(response.status,'completed',name+' failed: '+JSON.stringify(response).slice(0,500));
  assert.equal(!!response.result?.isError,false,name+' returned an MCP error');
  return response.result;
 }
 const calc=await remoteCall('cua_launch_app',{aumid:'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',session:'cua-bridge-image-test'});
 const {pid,windows}=calc.structuredContent??{};
 const window_id=windows?.[0]?.window_id;
 assert.ok(pid&&window_id,'Expected Calculator pid and window_id from broker');
 const imageResult=await remoteCall('cua_get_window_state',{
  pid,window_id,session:'cua-bridge-image-test',
  include_accessibility_tree:false,include_screenshot:true,
  max_image_dimension:800,display_only:true
 });
 const image=imageResult.content?.find(item=>item.type==='image');
 assert.ok(image?.data,'Window screenshot image must pass over WebSocket');
 const imageBytes=Math.ceil(image.data.length*3/4);
 assert.ok(imageBytes<8*1024*1024,'Window image exceeds transfer cap');
 console.log('BROKER_SCREENSHOT_BYTES='+imageBytes);
 console.log('BROKER_SCREENSHOT_PASS=true');
 console.log('END_TO_END_PASS=true');
} catch(error) {
 console.error('END_TO_END_FAIL='+String(error.stack??error).slice(0,1000));
 console.error('AGENT_LOG='+(()=>{try{return fs.readFileSync(path.join(directory,'agent.log'),'utf8').slice(-1400);}catch{return 'none';}})());
 if(stderr)console.error('AGENT_STDERR='+stderr.slice(-700));
 process.exitCode=1;
}finally{
 if(agent && agent.exitCode===null) {
  agent.send?.({type:'stop'});
  await Promise.race([once(agent,'exit').catch(()=>{}),sleep(5000)]);
  if(agent.exitCode===null) agent.kill();
 }
 if(server)await server.close().catch(()=>{});
 fs.rmSync(directory,{recursive:true,force:true});
}

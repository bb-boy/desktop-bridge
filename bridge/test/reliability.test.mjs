import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import bundledCatalog from '../server/desktop-commander-tools.json' with {type:'json'};
import { startServer } from '../server/index.mjs';
import { openStore } from '../server/store.mjs';
import { opaque, hash, passwordHash } from '../server/security.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate) {
  for(let n=0;n<667;n++){if(predicate())return;await sleep(15);}
  throw new Error('Condition timed out');
}
async function fixture(t,extra={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-reliability-')),token=opaque();
  const config={baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,ownerPasswordHash:await passwordHash(opaque()),devices:[{id:'p111',name:'Owner computer',tokenHash:hash(token)}],...extra};
  const f={directory,config,token,server:await startServer(config)};
  f.origin='http://127.0.0.1:'+f.server.httpServer.address().port;
  t.after(async()=>{await f.server.close();fs.rmSync(directory,{recursive:true,force:true});});
  return f;
}
async function device(f,{capabilities={},autoPong=true,id='p111',token=f.token,tools=[{name:'test_tool',description:'Owner tool',inputSchema:{type:'object',properties:{}}}],message=()=>{}}={}) {
  const ws=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{autoPong,headers:{authorization:'Bearer '+token}});
  ws.on('message',data=>{
    const m=JSON.parse(data);
    if(m.type==='health_check')ws.send(JSON.stringify({type:'health',ok:true}));
    message(m,ws);
  });
  await once(ws,'open');
  ws.send(JSON.stringify({type:'hello',protocol:2,deviceId:id,version:'test',platform:process.platform,tools,capabilities}));
  await until(()=>f.server.broker.connections.get(id)?.healthOk);
  return ws;
}
const result=(ws,id,text)=>ws.send(JSON.stringify({type:'result',id,result:{content:[{type:'text',text}]}}));
async function mcp(t,f,owner) {
  // Exercise the HTTP authentication and MCP routes with a real account-bound grant.
  const token=opaque(),clientId='test-'+owner;
  f.server.store.saveGrant(hash(token),'access',clientId,{clientId,ownerId:owner,family:opaque(),scopes:['desktop']},Date.now()+60000);
  const client=new Client({name:clientId,version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+token}}}));
  t.after(()=>client.close());
  return client;
}

test('first authenticated discovery has 31 tools before pairing and remains stable through device lifecycle',async t=>{
  const f=await fixture(t,{devices:[]}),store=f.server.store;
  const client=await mcp(t,f,'owner');
  const initial=(await client.listTools()).tools;
  assert.equal(initial.length,31);
  assert.equal(new Set(initial.map(tool=>tool.name)).size,31);
  for(const name of ['write_file','start_process','read_file','edit_block']) {
    const tool=initial.find(tool=>tool.name===name);
    assert.ok(tool?.inputSchema.properties.device_id);
    assert.ok(tool.inputSchema.required.length,'keep the real required arguments');
  }
  const write={name:'write_file',arguments:{path:'/fixture-only.txt',content:'fixture'}};
  const unpaired=await client.callTool(write);
  assert.equal(unpaired.isError,true);
  assert.equal(store.recentCalls('owner').length,0,'discovery never enables unpaired execution');

  store.db.prepare('INSERT INTO registry(id,owner,name,tokenHash) VALUES (?,?,?,?)').run('p111','owner','Test computer',hash(f.token));
  let sent=[];
  const ws=await device(f,{tools:bundledCatalog.tools,message:(m,socket)=>{
    if(m.type==='call'){sent.push(m);result(socket,m.id,'fixture completed');}
  }});
  assert.deepEqual((await client.listTools()).tools,initial,'pairing does not require rediscovery');
  const completed=await client.callTool({...write,arguments:{...write.arguments,device_id:'p111'}});
  assert.notEqual(completed.isError,true);
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].arguments,write.arguments,'routing field is not forwarded to the local tool');

  store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('alice','alice','unused',0,Date.now());
  const alice=await mcp(t,f,'alice');
  assert.deepEqual((await alice.listTools()).tools,initial);
  assert.equal((await alice.callTool({...write,arguments:{...write.arguments,device_id:'p111'}})).isError,true);
  store.db.prepare('UPDATE registry SET paused=1 WHERE id=?').run('p111');
  assert.equal((await client.callTool(write)).isError,true);
  store.db.prepare('UPDATE registry SET paused=0 WHERE id=?').run('p111');
  store.saveTools('p111',bundledCatalog.tools.filter(tool=>tool.name!=='write_file'),'owner');
  assert.equal((await client.callTool(write)).isError,true,'bundled visibility cannot enable an unsupported device tool');
  // Device definitions cannot override the public pinned schema or description.
  store.saveTools('p111',[{name:'write_file',description:'private device text',inputSchema:{type:'object',properties:{}}}],'owner');
  assert.deepEqual((await client.listTools()).tools,initial);
  assert.equal(sent.length,1,'rejected calls never reach the agent');
  ws.close();await until(()=>!f.server.broker.connections.has('p111'));
  assert.equal((await client.callTool(write)).isError,true);
  assert.deepEqual((await client.listTools()).tools,initial);
  store.db.prepare('UPDATE registry SET revoked=1 WHERE id=?').run('p111');
  assert.deepEqual((await client.listTools()).tools,initial);
  assert.equal((await client.callTool(write)).isError,true);
  await f.server.close();f.server=await startServer(f.config);
  f.origin='http://127.0.0.1:'+f.server.httpServer.address().port;
  assert.deepEqual((await (await mcp(t,f,'owner')).listTools()).tools,initial,'relay restart preserves discovery');
});

test('legacy storage migrates uncertain tasks without trusting unbound tool catalogs',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-migration-'));
  let store;
  t.after(()=>{store?.close();fs.rmSync(directory,{recursive:true,force:true});});
  const legacy=new DatabaseSync(path.join(directory,'bridge.db'));
  legacy.exec("CREATE TABLE devices(id TEXT PRIMARY KEY,tools TEXT NOT NULL,updated INTEGER NOT NULL); CREATE TABLE calls(id TEXT PRIMARY KEY,device TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER);");
  const tools=[{name:'old_private_tool',inputSchema:{type:'object'}}];
  legacy.prepare('INSERT INTO devices VALUES (?,?,?)').run('p111',JSON.stringify(tools),Date.now());
  legacy.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?)').run('old-task','p111','old_private_tool','executing',Date.now(),null);
  legacy.close();
  store=openStore(directory);
  assert.equal(store.call('old-task','owner').status,'unknown');
  assert.deepEqual(store.tools('p111','owner'),[]);
  assert.deepEqual(store.tools('p111','alice'),[]);
  store.saveTools('p111',tools,'owner');
  assert.deepEqual(store.tools('p111','owner'),tools);
  assert.deepEqual(store.tools('p111','alice'),[]);
});

test('late, duplicate and out-of-order deliveries preserve the first saved terminal result',async t=>{
  const f=await fixture(t,{callTimeoutMs:25});
  const ws=await device(f);
  const timed=await f.server.broker.call('test_tool',{}),id=timed._meta.desktopBridge.callId;
  assert.equal(f.server.store.call(id,'owner').status,'awaiting_result');
  result(ws,id,'durable result');
  await until(()=>f.server.store.call(id,'owner').status==='completed');
  const completed=f.server.store.call(id,'owner');
  result(ws,id,'conflicting duplicate');
  ws.send(JSON.stringify({type:'result',id,status:'executing'}));
  ws.send(JSON.stringify({type:'result',id,error:'late error'}));
  await sleep(40);
  assert.deepEqual(f.server.store.call(id,'owner'),completed);
  assert.equal(f.server.store.finishCall(id,'awaiting_result'),false,'a late deadline cannot overwrite a result');
  assert.throws(()=>f.server.store.beginCall(id,'p111','test_tool','owner'),/UNIQUE/,'a task ID can only be inserted once');
  assert.equal(f.server.store.call(id,'other-account'),undefined);
  await f.server.close();f.server=await startServer(f.config);
  assert.deepEqual(f.server.store.call(id,'owner'),completed,'result and task ID survive relay restart');
});

test('MCP catalogs, task queries and device result routing stay within the authenticated account',async t=>{
  const f=await fixture(t),otherToken=opaque(),store=f.server.store;
  store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('alice','alice','unused',0,Date.now());
  store.db.prepare('INSERT INTO registry(id,owner,name,tokenHash) VALUES (?,?,?,?)').run('alice-pc','alice','Alice computer',hash(otherToken));
  let ownerCalls=0,otherCalls=0;
  const ownerSocket=await device(f,{message:m=>{if(m.type==='call')ownerCalls++;}});
  const otherSocket=await device(f,{id:'alice-pc',token:otherToken,tools:[{name:'private_tool',description:'Private Alice catalog',inputSchema:{type:'object',properties:{}}}],message:m=>{if(m.type==='call')otherCalls++;}});
  store.beginCall('owner-task','p111','test_tool','owner');
  store.beginCall('alice-task','alice-pc','private_tool','alice');
  const owner=await mcp(t,f,'owner'),alice=await mcp(t,f,'alice');
  assert.deepEqual((await owner.listTools()).tools.map(x=>x.name),['list_devices','list_calls','get_call_result','who_am_i','ping','shutdown',...bundledCatalog.tools.map(t=>t.name),'test_tool']);
  assert.deepEqual((await alice.listTools()).tools.map(x=>x.name),['list_devices','list_calls','get_call_result','who_am_i','ping','shutdown',...bundledCatalog.tools.map(t=>t.name),'private_tool']);
  const ownDevices=JSON.parse((await owner.callTool({name:'list_devices',arguments:{}})).content[0].text);
  assert.deepEqual(ownDevices.map(x=>x.id),['p111']);
  const otherDevices=JSON.parse((await alice.callTool({name:'list_devices',arguments:{}})).content[0].text);
  assert.deepEqual(otherDevices.map(x=>x.id),['alice-pc']);
  const hidden=await alice.callTool({name:'get_call_result',arguments:{call_id:'owner-task'}});
  assert.equal(hidden.isError,true);assert.match(hidden.content[0].text,/Task not found/);
  const listed=JSON.parse((await alice.callTool({name:'list_calls',arguments:{}})).content[0].text);
  assert.deepEqual(listed.map(x=>x.id),['alice-task']);
  const denied=await alice.callTool({name:'test_tool',arguments:{device_id:'p111'}});
  assert.equal(denied.isError,true);assert.equal(ownerCalls+otherCalls,0);
  result(otherSocket,'owner-task','forged cross-account result');
  result(ownerSocket,'alice-task','forged cross-device result');
  await sleep(30);
  assert.equal(store.call('owner-task','owner').status,'executing');
  assert.equal(store.call('alice-task','alice').status,'executing');
  result(ownerSocket,'owner-task','owner secret');
  result(otherSocket,'alice-task','Alice secret');
  await until(()=>store.call('owner-task','owner').status==='completed'&&store.call('alice-task','alice').status==='completed');
  const saved=JSON.parse((await alice.callTool({name:'get_call_result',arguments:{call_id:'alice-task'}})).content[0].text);
  assert.equal(saved.result.content[0].text,'Alice secret');
  assert.equal(ownerCalls+otherCalls,0,'result recovery never executes a tool');
});

test('pause, unlink and changed ownership gate recovery even before socket closure',async t=>{
  const f=await fixture(t);let recoveries=0,calls=0;
  await device(f,{message:m=>{if(m.type==='recover')recoveries++;if(m.type==='call')calls++;}});
  f.server.store.beginCall('recover-task','p111','test_tool','owner');
  f.server.broker.recover('recover-task','owner');await until(()=>recoveries===1);
  f.server.store.db.prepare('UPDATE registry SET paused=1 WHERE id=?').run('p111');
  f.server.broker.recover('recover-task','owner');
  await assert.rejects(f.server.broker.call('test_tool',{}),/暂停/);
  f.server.store.db.prepare('UPDATE registry SET paused=0,owner=? WHERE id=?').run('alice','p111');
  f.server.broker.recover('recover-task','owner');
  assert.equal(f.server.broker.devices('alice')[0].networkConnected,false);
  assert.equal(f.server.broker.devices('alice')[0].connectedAt,null);
  assert.deepEqual(f.server.broker.tools('alice'),f.server.broker.tools('unpaired'),'a saved private catalog cannot follow an ownership change');
  await assert.rejects(f.server.broker.call('test_tool',{},'alice'),/offline/);
  f.server.store.db.prepare('UPDATE registry SET revoked=1,owner=? WHERE id=?').run('owner','p111');
  f.server.broker.recover('recover-task','owner');
  await assert.rejects(f.server.broker.call('test_tool',{}),/Unknown device/);
  await sleep(35);assert.equal(recoveries,1);assert.equal(calls,0);
});

test('send failures and shutdown return durable uncertain task IDs without leaving pending requests',async t=>{
  const f=await fixture(t,{callTimeoutMs:1000});let sends=0;
  await device(f,{message:m=>{if(m.type==='call')sends++;}});
  const conn=f.server.broker.connections.get('p111'),original=conn.ws.send;
  for(const fail of [()=>{throw new Error('write failed');},(_data,callback)=>callback(new Error('async write failed'))]) {
    conn.ws.send=fail;
    const response=await f.server.broker.call('test_tool',{}),id=response._meta.desktopBridge.callId;
    assert.equal(response.isError,true);assert.ok(id);
    assert.equal(f.server.store.call(id,'owner').status,'awaiting_result');
    assert.equal(f.server.broker.pending.size,0);
  }
  conn.ws.send=original;
  const pending=f.server.broker.call('test_tool',{});
  await until(()=>sends===1);
  await f.server.close();
  const interrupted=await pending,id=interrupted._meta.desktopBridge.callId;
  assert.equal(interrupted.isError,true);assert.ok(id);
  assert.equal(f.server.broker.pending.size,0);
  await assert.rejects(f.server.broker.call('test_tool',{}),/stopping/);
  f.server=await startServer(f.config);
  assert.equal(f.server.store.call(id,'owner').status,'awaiting_result');
});

test('lost rotation acknowledgement is recovered only after a valid pending-key hello',async t=>{
  const f=await fixture(t),pending=opaque(),store=f.server.store;
  store.db.prepare('UPDATE registry SET pendingHash=? WHERE id=?').run(hash(pending),'p111');
  const ws=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+pending}});
  await once(ws,'open');
  assert.equal(store.device('p111').tokenHash,hash(f.token),'upgrade alone cannot promote a key');
  ws.send(JSON.stringify({type:'hello',protocol:2,deviceId:'wrong',tools:[]}));
  await once(ws,'close');await until(()=>!f.server.broker.connections.has('p111'));
  assert.equal(store.device('p111').pendingHash,hash(pending),'invalid catalog cannot consume the pending key');
  await device(f,{token:pending});
  assert.equal(store.device('p111').tokenHash,hash(pending));assert.equal(store.device('p111').pendingHash,null);
  const old=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+f.token}});
  old.on('error',()=>{});
  const status=await new Promise(resolve=>old.on('unexpected-response',(_req,res)=>{res.resume();old.terminate();resolve(res.statusCode);}));
  assert.equal(status,403);
});

test('an actual agent recovers persisted results after relay restart and never replays interrupted side effects',async t=>{
  const f=await fixture(t),project=fileURLToPath(new URL('..',import.meta.url));
  const configPath=path.join(f.directory,'agent-config.json'),journalPath=path.join(f.directory,'journal.json');
  const completed='11111111-1111-4111-8111-111111111111',interrupted='22222222-2222-4222-8222-222222222222';
  f.server.store.beginCall(completed,'p111','increment','owner');
  f.server.store.beginCall(interrupted,'p111','increment','owner');
  await f.server.close();f.server=await startServer(f.config);
  f.origin='http://127.0.0.1:'+f.server.httpServer.address().port;
  assert.equal(f.server.store.call(completed,'owner').status,'unknown','relay restart preserves uncertainty');
  fs.writeFileSync(path.join(f.directory,'counter.txt'),'1');
  fs.writeFileSync(journalPath,JSON.stringify({[completed]:{status:'completed',time:Date.now(),result:{content:[{type:'text',text:'1'}]}},[interrupted]:{status:'executing',time:Date.now()}}));
  fs.writeFileSync(configPath,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
  const child=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),configPath],{stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}});
  await until(()=>f.server.broker.devices()[0].toolsAvailable&&f.server.store.call(completed,'owner').status==='completed'&&f.server.store.call(interrupted,'owner').error);
  assert.equal(f.server.store.call(completed,'owner').result.content[0].text,'1');
  assert.equal(f.server.store.call(interrupted,'owner').status,'unknown');
  f.server.broker.recover(interrupted,'owner');
  await sleep(80);
  assert.equal(fs.readFileSync(path.join(f.directory,'counter.txt'),'utf8'),'1','neither recovery path performs the side effect again');
  assert.equal(f.server.broker.pending.size,0);
});

test('a real side effect completed offline is recovered automatically after relay restart',async t=>{
  const f=await fixture(t),project=fileURLToPath(new URL('..',import.meta.url));
  // Rebind the relay on the same endpoint so the running agent can reconnect itself.
  f.config.port=f.server.httpServer.address().port;
  const configPath=path.join(f.directory,'agent-config.json');
  fs.writeFileSync(configPath,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-delayed-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
  const child=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),configPath],{stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}});
  await until(()=>f.server.broker.devices()[0].toolsAvailable);
  const pending=f.server.broker.call('increment',{});
  await until(()=>fs.existsSync(path.join(f.directory,'counter.txt')));
  f.server.broker.connections.get('p111').ws.terminate();
  const interrupted=await pending,id=interrupted._meta.desktopBridge.callId;
  assert.equal(interrupted.isError,true);
  await until(()=>{
    try{return JSON.parse(fs.readFileSync(path.join(f.directory,'journal.json'),'utf8'))[id]?.status==='completed';}catch{return false;}
  });
  await f.server.close();f.server=await startServer(f.config);
  await until(()=>f.server.store.call(id,'owner').status==='completed');
  assert.equal(f.server.store.call(id,'owner').result.content[0].text,'1');
  assert.equal(fs.readFileSync(path.join(f.directory,'counter.txt'),'utf8'),'1');
  assert.equal(f.server.broker.pending.size,0);
});

test('account identity and monthly counts are isolated, UTC-scoped and durable',async t=>{
 const f=await fixture(t),store=f.server.store;
 store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('alice','Alice','unused',0,Date.now());
 const owner=await mcp(t,f,'owner'),alice=await mcp(t,f,'alice');
 const who=async client=>JSON.parse((await client.callTool({name:'who_am_i',arguments:{}})).content[0].text);
 const first=await who(owner);assert.equal(first.account.id,'owner');assert.equal(first.usage.toolCalls,1);
 assert.equal(first.usage.limit,null);assert.equal(first.usage.percentage,null);assert.equal(first.usage.timezone,'UTC');
 assert.equal(first.devices.paired,1);assert.ok(first.usage.countedSince);assert.equal(JSON.stringify(first).includes('password'),false);
 await owner.callTool({name:'ping',arguments:{device_id:'not-owned'}});
 assert.equal((await who(owner)).usage.toolCalls,3,'failed calls and identity queries count once');
 const other=await who(alice);assert.equal(other.account.id,'alice');assert.equal(other.devices.paired,0);assert.equal(other.usage.toolCalls,1);
 const end=Date.UTC(2020,0,31,23,59,59),start=Date.UTC(2020,1,1);
 store.recordToolCall('owner',end);store.recordToolCall('owner',end);store.recordToolCall('owner',start);
 assert.equal(store.monthlyUsage('owner',end).toolCalls,2);assert.equal(store.monthlyUsage('owner',start).toolCalls,1);assert.equal(store.monthlyUsage('alice',start).toolCalls,0);
 await f.server.close();f.server=await startServer(f.config);assert.equal(f.server.store.monthlyUsage('owner').toolCalls,3);
});

test('ping matches fresh nonces, cleans up timeouts and rechecks ownership and pause',async t=>{
 const f=await fixture(t,{pingTimeoutMs:80}),ws=await device(f,{autoPong:false});
 await assert.rejects(f.server.broker.ping({},'alice'),/Unknown device/);
 ws.on('ping',()=>ws.pong('wrong-nonce'));await assert.rejects(f.server.broker.ping(),/timed out/);
 const conn=f.server.broker.connections.get('p111');assert.equal(conn.probes.size,0);assert.equal(conn.ws.listenerCount('pong'),1);
 ws.removeAllListeners('ping');ws.on('ping',data=>ws.pong(data));
 const good=await f.server.broker.ping();assert.equal(good.pong,true);assert.ok(good.latency_ms>=0);assert.ok(good.timestamp);
 ws.removeAllListeners('ping');ws.on('ping',data=>{f.server.store.db.prepare('UPDATE registry SET paused=1 WHERE id=?').run('p111');ws.pong(data);});
 await assert.rejects(f.server.broker.ping(),/authorization changed/);await assert.rejects(f.server.broker.ping(),/暂停/);
 f.server.store.db.prepare('UPDATE registry SET paused=0 WHERE id=?').run('p111');
 ws.removeAllListeners('ping');ws.on('ping',()=>ws.close());await assert.rejects(f.server.broker.ping(),/disconnected/);assert.equal(conn.probes.size,0);
});

test('remote controls require ownership, capability and no pending calls',async t=>{
 const f=await fixture(t,{callTimeoutMs:80});let calls=0;
 await device(f,{message:m=>{if(m.type==='call')calls++;}});
 const client=await mcp(t,f,'owner');
 const legacy=await client.callTool({name:'shutdown',arguments:{}});assert.equal(legacy.isError,true);assert.match(legacy.content[0].text,/Update/);assert.equal(calls,0);
 assert.equal((await client.callTool({name:'ping',arguments:{device_id:'p111',extra:true}})).isError,true);
 assert.equal((await client.callTool({name:'shutdown',arguments:{device_id:'other'}})).isError,true);
 const conn=f.server.broker.connections.get('p111');conn.canShutdown=true;
 const pending=f.server.broker.call('test_tool',{});await assert.rejects(f.server.broker.call('shutdown',{}),/pending calls/);await pending;assert.equal(calls,1);
});

test('shutdown stops a supervised agent, persists its result and requires local restart',async t=>{
 const f=await fixture(t),project=fileURLToPath(new URL('..',import.meta.url));
 const config=path.join(f.directory,'agent-config.json');
 fs.writeFileSync(config,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
 fs.writeFileSync(path.join(f.directory,'launch.json'),JSON.stringify({agent:path.join(project,'agent/agent.mjs'),config}));
 const children=[];
 const start=()=>{const p=spawn(process.execPath,[path.join(project,'client/runner.mjs'),f.directory],{stdio:'ignore'});children.push(p);return p;};
 t.after(async()=>{for(const p of children)if(p.exitCode===null&&p.signalCode===null){const done=once(p,'exit');p.kill('SIGTERM');await done;}});
 const runner=start();await until(()=>f.server.broker.devices()[0].toolsAvailable);assert.equal(f.server.broker.devices()[0].remoteShutdownAvailable,true);
 const client=await mcp(t,f,'owner'),exited=once(runner,'exit');
 const result=await client.callTool({name:'shutdown',arguments:{device_id:'p111'}});assert.notEqual(result.isError,true);
 const id=result._meta.desktopBridge.callId;await exited;
 assert.ok(fs.existsSync(path.join(f.directory,'maintenance.flag')));assert.equal(f.server.store.call(id,'owner').status,'completed');
 assert.equal(fs.existsSync(path.join(f.directory,'counter.txt')),false,'shutdown never reaches the local tool engine');
 assert.equal(fs.existsSync(path.join(f.directory,'agent.lock')),false);assert.equal(fs.existsSync(path.join(f.directory,'runner-lock')),false);
 assert.equal(JSON.parse(fs.readFileSync(config)).deviceToken,f.token);
 const blocked=start();assert.equal((await once(blocked,'exit'))[0],0);assert.equal(f.server.broker.devices()[0].networkConnected,false);
 fs.rmSync(path.join(f.directory,'maintenance.flag'));start();await until(()=>f.server.broker.devices()[0].toolsAvailable);
 const recovered=await client.callTool({name:'get_call_result',arguments:{call_id:id}});assert.equal(JSON.parse(recovered.content[0].text).status,'completed');
 f.server.broker.send(f.server.broker.connections.get('p111'),{type:'call',id,name:'shutdown',arguments:{}});await sleep(60);
 assert.equal(fs.existsSync(path.join(f.directory,'maintenance.flag')),false,'duplicate shutdown ID returns the saved result without stopping again');
 assert.equal(f.server.broker.devices()[0].networkConnected,true,'querying a saved shutdown never repeats it');
});


test('an agent refuses shutdown while an earlier call has an uncertain in-flight result',async t=>{
 const f=await fixture(t,{callTimeoutMs:50}),project=fileURLToPath(new URL('..',import.meta.url));
 const config=path.join(f.directory,'agent-config.json');
 fs.writeFileSync(config,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-delayed-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
 const child=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),config],{stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}});
 await until(()=>f.server.broker.devices()[0].toolsAvailable);
 const timed=await f.server.broker.call('increment',{});assert.equal(timed.isError,true);
 const rejected=await f.server.broker.call('shutdown',{});assert.equal(rejected.isError,true);assert.match(rejected.content[0].text,/executing call/);
 assert.equal(fs.existsSync(path.join(f.directory,'maintenance.flag')),false);
 assert.equal(f.server.broker.connections.get('p111').stopRequested,false);
 await until(()=>f.server.store.call(timed._meta.desktopBridge.callId,'owner').status==='completed');
 assert.equal(f.server.broker.devices()[0].networkConnected,true);
});

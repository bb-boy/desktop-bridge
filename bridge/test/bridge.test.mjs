import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import bundledCatalog from '../server/desktop-commander-tools.json' with {type:'json'};
import { startServer } from '../server/index.mjs';
import { opaque, hash, passwordHash } from '../server/security.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<500;i++){if(fn())return;await sleep(20);}throw new Error('Condition timed out');}
async function fixture(t,extra={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-bridge-test-'));
  const token=opaque(),password=opaque();
  const config={baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,ownerPasswordHash:await passwordHash(password),devices:[{id:'p111',name:'Test computer',tokenHash:hash(token)}],...extra};
  const server=await startServer(config);
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  // Keep the security origin equal to the actual ephemeral endpoint.
  config.baseUrl=origin;
  const result={server,origin,token,password,config,directory};
  t.after(async()=>{await result.server.close();fs.rmSync(directory,{recursive:true,force:true});});
  return result;
}
async function form(url,data,headers={}) {
  return fetch(url,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(data)});
}
async function authorize(f) {
  const registration=await fetch(f.origin+'/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Integration test',redirect_uris:['https://example.com/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal(registration.status,201);
  const client=await registration.json();
  const verifier=opaque();
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const params=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:'https://example.com/callback',code_challenge:challenge,code_challenge_method:'S256',scope:'desktop',state:'test-state'});
  const auth=await fetch(f.origin+'/authorize?'+params,{redirect:'manual'});
  assert.equal(auth.status,302);
  const cookie=auth.headers.getSetCookie()[0].split(';')[0];
  const request=new URL(auth.headers.get('location'),f.origin).searchParams.get('request');
  const page=await fetch(f.origin+'/oauth/consent?request='+request,{headers:{cookie}});
  const html=await page.text();
  assert.equal(page.headers.get('referrer-policy'),'same-origin');
  assert.match(html,/<p class="error"><\/p>/,'new authorization pages have no error message');
  assert.doesNotMatch(html,/function next\s*\(/,'Express middleware callbacks must not appear on the page');
  const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  const denied=await form(f.origin+'/oauth/approve',{request,csrf,username:f.username??'owner',password:f.password,decision:'approve'},{cookie,origin:'https://attacker.invalid'});
  assert.equal(denied.status,403,'cross-origin authorization rejected');
  const missingCsrf=await form(f.origin+'/oauth/approve',{request,password:f.password,decision:'approve'},{cookie,origin:'null'});
  assert.equal(missingCsrf.status,403,'null Origin does not bypass CSRF protection');
  const browserPost=await form(f.origin+'/oauth/approve',{request,csrf,password:'intentionally-wrong-password',decision:'approve'},{cookie,origin:'null','sec-fetch-site':'same-origin'});
  assert.equal(browserPost.status,200,'valid browser CSRF is accepted even when Origin is suppressed');
  assert.match(await browserPost.text(),/密码不正确/);
  const approval=await form(f.origin+'/oauth/approve',{request,csrf,username:f.username??'owner',password:f.password,decision:'approve'},{cookie,origin:f.origin});
  assert.equal(approval.status,303);
  const callback=new URL(approval.headers.get('location'));
  assert.equal(callback.searchParams.get('state'),'test-state');
  const code=callback.searchParams.get('code');
  const bad=await form(f.origin+'/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:opaque(),redirect_uri:'https://example.com/callback'});
  assert.equal(bad.status,400,'wrong PKCE verifier rejected');
  const response=await form(f.origin+'/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:'https://example.com/callback'});
  assert.equal(response.status,200,await response.clone().text());
  const tokens=await response.json();
  const replay=await form(f.origin+'/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:'https://example.com/callback'});
  assert.equal(replay.status,400,'authorization code cannot be reused');
  return {tokens,client};
}

test('OAuth protects MCP, checks CSRF and PKCE, rotates persistent refresh credentials',async t=>{
  const f=await fixture(t);
  const anonymous=await fetch(f.origin+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(anonymous.status,401);
  assert.match(anonymous.headers.get('www-authenticate'),/resource_metadata/);
  assert.equal((await fetch(f.origin+'/.well-known/oauth-protected-resource/mcp')).status,200);
  const {tokens,client}=await authorize(f);
  assert.equal((await fetch(f.origin+'/api/devices',{headers:{authorization:'Bearer '+tokens.access_token}})).status,200);
  const wrongResource=await form(f.origin+'/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:'https://attacker.invalid/mcp'});
  assert.equal(wrongResource.status,400);
  const refreshed=await form(f.origin+'/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token});
  assert.equal(refreshed.status,200);
  const next=await refreshed.json();
  assert.notEqual(next.refresh_token,tokens.refresh_token);
  assert.equal((await form(f.origin+'/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token})).status,400);
  await f.server.provider.revokeToken(client,{token:next.refresh_token});
  assert.equal((await fetch(f.origin+'/api/devices',{headers:{authorization:'Bearer '+tokens.access_token}})).status,401);
});

test('real MCP client discovers and invokes device tools; disconnects never replay calls',async t=>{
  const f=await fixture(t,{callTimeoutMs:1000});
  const {tokens}=await authorize(f);
  const ws=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+f.token}});
  await once(ws,'open');
  ws.send(JSON.stringify({type:'hello',protocol:2,version:'0.2.0',deviceId:'p111',tools:[{name:'echo_tool',description:'Echo supplied text',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message']}}]}));
  ws.send(JSON.stringify({type:'health',ok:true}));
  await waitFor(()=>f.server.broker.devices()[0].toolsAvailable);
  let calls=0;
  ws.on('message',data=>{
    const m=JSON.parse(data);
    if(m.type==='call') {
      calls++;
      if(m.arguments.message==='disconnect')return ws.terminate();
      ws.send(JSON.stringify({type:'result',id:m.id,result:{content:[{type:'text',text:m.arguments.message}]}}));
    }
  });
  const client=new Client({name:'test',version:'1.0'},{capabilities:{}});
  const transport=new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+tokens.access_token}}});
  await client.connect(transport);
  t.after(()=>client.close());
  const tools=await client.listTools();
  assert.deepEqual(tools.tools.map(t=>t.name),['list_devices','list_calls','get_call_result','who_am_i','ping','shutdown','get_device_permissions','set_device_permissions',...bundledCatalog.tools.map(t=>t.name),'echo_tool']);
  assert.ok(tools.tools.find(t=>t.name==='echo_tool').inputSchema.properties.device_id);
  const good=await client.callTool({name:'echo_tool',arguments:{device_id:'p111',message:'hello'}});
  assert.equal(good.content[0].text,'hello');
  const badDevice=await client.callTool({name:'echo_tool',arguments:{device_id:'other',message:'hello'}});
  assert.equal(badDevice.isError,true);
  assert.equal(calls,1,'unknown device was never called');
  const lost=await client.callTool({name:'echo_tool',arguments:{message:'disconnect'}});
  assert.equal(lost.isError,true);
  assert.match(lost.content[0].text,/任务可能仍在执行/);
  assert.ok(lost._meta.desktopBridge.callId);
  await sleep(100);
  assert.equal(calls,2);
  const offline=await client.callTool({name:'echo_tool',arguments:{message:'hello'}});
  assert.equal(offline.isError,true);
  assert.equal(calls,2,'offline calls not queued');
});

test('device credentials are separate from OAuth credentials',async t=>{
  const f=await fixture(t);
  const ws=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+opaque()}});
  const result=await new Promise(resolve=>{ws.on('unexpected-response',(_req,res)=>{res.resume();ws.terminate();resolve(res.statusCode);});ws.on('error',()=>{});});
  assert.equal(result,403);
});

test('parallel authorization attempts keep independent browser CSRF cookies',async t=>{
  const f=await fixture(t);
  const {client}=await authorize(f);
  const requests=[],cookies=[];
  for(let i=0;i<2;i++) {
    const query=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:'https://example.com/callback',code_challenge:opaque(),code_challenge_method:'S256',scope:'desktop'});
    const response=await fetch(f.origin+'/authorize?'+query,{redirect:'manual'});
    assert.equal(response.status,302);
    requests.push(response.headers.get('location'));
    cookies.push(response.headers.getSetCookie()[0].split(';')[0]);
  }
  assert.notEqual(cookies[0].split('=')[0],cookies[1].split('=')[0]);
  for(const request of requests) {
    const page=await fetch(f.origin+request,{headers:{cookie:cookies.join('; ')}});
    assert.equal(page.status,200,'starting a second authorization must not invalidate the first page');
  }
});

test('access and refresh grants survive a relay process restart',async t=>{
  const f=await fixture(t);
  const {tokens,client}=await authorize(f);
  await f.server.close();
  f.server=await startServer(f.config);
  const auth=await f.server.provider.verifyAccessToken(tokens.access_token);
  assert.equal(auth.clientId,client.client_id);
  const next=await f.server.provider.exchangeRefreshToken(client,tokens.refresh_token);
  assert.ok(next.access_token);
  assert.ok(!fs.readFileSync(path.join(f.directory,'bridge.db'),'utf8').includes(tokens.access_token),'access bearer tokens not stored as plaintext');
});

test('actual agent persists duplicate-call protection across restarts',async t=>{
  const f=await fixture(t);
  const project=fileURLToPath(new URL('..',import.meta.url));
  const configPath=path.join(f.directory,'agent-config.json');
  fs.writeFileSync(configPath,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
  let child;
  async function start(){child=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),configPath],{stdio:'ignore'});await waitFor(()=>f.server.broker.devices()[0].toolsAvailable);}
  async function stop(){if(child && child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}if(f.server.httpServer.listening)await waitFor(()=>!f.server.broker.devices()[0].online);}
  t.after(stop);
  await start();
  const id='12345678-1234-1234-1234-123456789012';
  const call={type:'call',id,name:'increment',arguments:{}};
  const completed=()=>{try{return JSON.parse(fs.readFileSync(path.join(f.directory,'journal.json'),'utf8'))[id]?.status==='completed';}catch{return false;}};
  f.server.broker.connections.get('p111').ws.send(JSON.stringify(call));
  await waitFor(completed);
  f.server.broker.connections.get('p111').ws.send(JSON.stringify(call));
  await sleep(100);
  assert.equal(fs.readFileSync(path.join(f.directory,'counter.txt'),'utf8'),'1');
  await stop();await start();
  f.server.broker.connections.get('p111').ws.send(JSON.stringify(call));
  await sleep(100);
  assert.equal(fs.readFileSync(path.join(f.directory,'counter.txt'),'utf8'),'1','same call ID is not executed again after restart');
  await stop();
});

test('unlinked online device loses its server hash and local Agent credentials',async t=>{
  const f=await fixture(t),account=await browser(f);
  const project=fileURLToPath(new URL('..',import.meta.url)),configPath=path.join(f.directory,'agent-config.json');
  fs.writeFileSync(configPath,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
  const child=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),configPath],{stdio:'ignore',env:{...process.env,DESKTOP_BRIDGE_SUPPRESS_NOTIFICATIONS:'1'}});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
  await waitFor(()=>f.server.broker.devices()[0].toolsAvailable);
  assert.equal((await account.request('/api/manage/devices/p111/unlink',{})).status,200);
  const record=f.server.store.db.prepare('SELECT revoked,tokenHash,pendingHash FROM registry WHERE id=?').get('p111');
  assert.equal(record.revoked,1);assert.equal(record.tokenHash,null);assert.equal(record.pendingHash,null);
  const revokedList=await(await account.request('/api/manage/revoked-devices')).json();
  assert.equal(revokedList.devices.length,1);
  assert.equal(revokedList.devices[0].name,'Test computer');
  assert.ok(revokedList.devices[0].revokedAt>0);
  await waitFor(()=>{
    const local=JSON.parse(fs.readFileSync(configPath,'utf8'));
    return !('deviceToken' in local)&&!('deviceId' in local)&&fs.existsSync(path.join(f.directory,'maintenance.flag'));
  });
  assert.equal((await(await fetch(f.origin+'/api/agent/revocation-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:'p111'})})).json()).revoked,true);
  const socket=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+f.token}});
  const forbidden=await new Promise(resolve=>{socket.on('unexpected-response',(_req,res)=>{res.resume();socket.terminate();resolve(res.statusCode);});socket.on('error',()=>{});});
  assert.equal(forbidden,403);
  const status=JSON.parse(fs.readFileSync(path.join(f.directory,'auth-status.json'),'utf8'));
  assert.equal(status.authStatus,'re_pair_required');
  assert.equal(status.notificationShown,false,'noninteractive test does not show Windows popups');
});

test('offline revoked device clears saved credentials on next Agent launch',async t=>{
  const f=await fixture(t),account=await browser(f);
  const project=fileURLToPath(new URL('..',import.meta.url)),configPath=path.join(f.directory,'agent-config.json');
  fs.writeFileSync(configPath,JSON.stringify({serverUrl:f.origin,deviceId:'p111',deviceToken:f.token,runtimeDir:project,mcpEntry:fileURLToPath(new URL('fixture-mcp.mjs',import.meta.url)),workingDirectory:f.directory}));
  assert.equal((await account.request('/api/manage/devices/p111/unlink',{})).status,200);
  const child=spawn(process.execPath,[path.join(project,'agent/agent.mjs'),configPath],{stdio:'ignore',env:{...process.env,DESKTOP_BRIDGE_SUPPRESS_NOTIFICATIONS:'1'}});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
  const [exitCode]=await once(child,'exit');
  assert.equal(exitCode,78);
  const local=JSON.parse(fs.readFileSync(configPath,'utf8'));
  assert.equal(local.deviceToken,undefined);assert.equal(local.deviceId,undefined);
  assert.equal(fs.existsSync(path.join(f.directory,'maintenance.flag')),true);
  const status=JSON.parse(fs.readFileSync(path.join(f.directory,'auth-status.json'),'utf8'));
  assert.equal(status.authStatus,'re_pair_required');
});

test('revoked-device history is visible only to its account owner',async t=>{
  const f=await fixture(t),owner=await browser(f);
  const pass='Other account password that is long enough';
  f.server.store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('another','another',await passwordHash(pass),0,Date.now());
  const other=await browser(f,'another',pass);
  assert.deepEqual((await(await other.request('/api/manage/revoked-devices')).json()).devices,[]);
  assert.equal((await owner.request('/api/manage/devices/p111/unlink',{})).status,200);
  const history=(await(await owner.request('/api/manage/revoked-devices')).json()).devices;
  assert.equal(history.length,1);
  assert.equal(history[0].id,'p111');
  assert.ok(history[0].revokedAt>0);
  assert.deepEqual((await(await other.request('/api/manage/revoked-devices')).json()).devices,[]);
});

test('a paused device is not treated as revoked, preserving its local Token',async t=>{
  const f=await fixture(t),account=await browser(f);
  assert.equal((await account.request('/api/manage/devices/p111/pause',{})).status,200);
  const response=await fetch(f.origin+'/api/agent/revocation-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:'p111'})});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{revoked:false});
  const invalid=await fetch(f.origin+'/api/agent/revocation-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:{not:'valid'}})});
  assert.equal(invalid.status,400);
  assert.deepEqual((await(await account.request('/api/manage/revoked-devices')).json()).devices,[]);
});

async function browser(f,username='owner',password=f.password) {
  const session=await fetch(f.origin+'/api/session'),initial=await session.json();
  const cookie=session.headers.getSetCookie()[0].split(';')[0];
  const response=await fetch(f.origin+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:f.origin,cookie,'x-csrf-token':initial.csrf},body:JSON.stringify({username,password})});
  assert.equal(response.status,200,await response.clone().text());
  const s=await response.json(),headers={cookie:response.headers.getSetCookie().find(c=>c.startsWith('bridge_session=')).split(';')[0],origin:f.origin,'x-csrf-token':s.csrf,'content-type':'application/json'};
  return {headers,account:s.account,request:(url,data)=>fetch(f.origin+url,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{body:JSON.stringify(data)})})};
}
async function startPair(f,name='Test paired computer') {
  const r=await fetch(f.origin+'/api/pair/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,platform:'win32',version:'0.2.0'})});
  assert.equal(r.status,200,await r.clone().text());return r.json();
}
const pollPair=(f,p)=>fetch(f.origin+'/api/pair/poll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceCode:p.deviceCode})});
async function connectDevice(f,credentials,handlers={}) {
  const ws=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+credentials.deviceToken}});
  ws.on('message',data=>{const m=JSON.parse(data);if(m.type==='health_check'&&handlers.health!==false)ws.send(JSON.stringify({type:'health',ok:true}));handlers.message?.(m,ws);});
  await once(ws,'open');
  ws.send(JSON.stringify({type:'hello',protocol:2,deviceId:credentials.deviceId,version:'0.2.0',platform:'win32',tools:[{name:'test_tool',description:'Test',inputSchema:{type:'object',properties:{}}}]}));
  await waitFor(()=>f.server.broker.connections.get(credentials.deviceId)?.ready);
  if(handlers.health!==false)await waitFor(()=>f.server.broker.connections.get(credentials.deviceId)?.healthOk);
  return ws;
}

test('dashboard distinguishes ready devices from executable MCP tool count',async t=>{
  const f=await fixture(t),account=await browser(f);
  const initial=await(await account.request('/api/manage/devices')).json();
  assert.equal(initial.devices.length,1);
  assert.equal(initial.readyDevices,0);
  assert.equal(initial.toolCount,0,'offline device must not count tools as executable');
  const ws=await connectDevice(f,{deviceId:'p111',deviceToken:f.token});
  t.after(()=>ws.terminate());
  const connected=await(await account.request('/api/manage/devices')).json();
  assert.equal(connected.readyDevices,1,'one ready device is not one tool');
  assert.equal(8+bundledCatalog.tools.length,33,'standard Desktop Bridge catalog now has 33 tools');
  assert.equal(connected.toolCount,34,'the connected test device registers one additional test_tool plus two permission tools');
  assert.equal(connected.toolCount,8+f.server.broker.tools(account.account.id).length);
});

test('browser sessions enforce CSRF, one-time invitations, pairing ownership and account isolation',async t=>{
  const f=await fixture(t),a=await browser(f);
  const denied=await fetch(f.origin+'/api/invitations',{method:'POST',headers:{...a.headers,'x-csrf-token':'wrong'},body:'{}'});assert.equal(denied.status,403);
  const invite=await(await a.request('/api/invitations',{})).json();
  const invitation=new URL(invite.url).searchParams.get('invite');
  const s=await fetch(f.origin+'/api/session'),pre=await s.json(),cookie=s.headers.getSetCookie()[0].split(';')[0];
  const signup=()=>fetch(f.origin+'/api/signup',{method:'POST',headers:{'content-type':'application/json',cookie,origin:f.origin,'x-csrf-token':pre.csrf},body:JSON.stringify({username:'alice',password:'Alice very private password',invitation})});
  assert.equal((await signup()).status,201);assert.equal((await signup()).status,400,'invitation cannot be reused');
  const b=await browser(f,'alice','Alice very private password');
  assert.equal((await b.request('/api/invitations',{})).status,403);
  const p=await startPair(f);assert.equal((await pollPair(f,p)).status,202);
  assert.equal((await b.request('/api/manage/pair',{code:p.userCode,decision:'approve'})).status,200);
  const claimed=await pollPair(f,p);assert.equal(claimed.status,200);const credentials=await claimed.json();
  assert.equal((await pollPair(f,p)).status,410,'device credential can only be claimed once');
  const ws=await connectDevice(f,credentials);
  const id=credentials.deviceId;
  assert.equal((await(await b.request('/api/manage/devices')).json()).devices[0].id,id);
  assert.equal((await(await a.request('/api/manage/devices')).json()).devices.some(d=>d.id===id),false);
  assert.equal((await a.request('/api/manage/devices/'+id+'/unlink',{})).status,404);
  assert.equal(f.server.broker.tools('owner').some(x=>x.name==='test_tool'),false);
  await assert.rejects(f.server.broker.call('test_tool',{device_id:id},'owner'),/Unknown device/);
  assert.equal((await b.request('/api/manage/devices/'+id+'/rename',{name:'Alice laptop'})).status,200);
  assert.equal(f.server.store.device(id).name,'Alice laptop');
  f.server.store.beginCall('test-task-id',id,'test_tool',b.account.id);f.server.store.finishCall('test-task-id','completed',{content:[{type:'text',text:'private file content'}]});
  assert.equal((await a.request('/api/manage/calls/test-task-id')).status,404);
  assert.equal((await b.request('/api/manage/calls/test-task-id')).status,200);
  assert.equal(f.server.store.call('test-task-id','owner'),undefined);
  const {tokens}=await authorize({...f,username:'alice',password:'Alice very private password'});
  const devices=await(await fetch(f.origin+'/api/devices',{headers:{authorization:'Bearer '+tokens.access_token}})).json();assert.deepEqual(devices.devices.map(d=>d.id),[id],'OAuth routes to authorizing account');
  const auths=await(await b.request('/api/manage/authorizations')).json();assert.equal(auths.authorizations.length,1);
  assert.equal((await a.request('/api/manage/authorizations/'+auths.authorizations[0].id+'/revoke',{})).status,200);
  assert.equal((await fetch(f.origin+'/api/devices',{headers:{authorization:'Bearer '+tokens.access_token}})).status,200,'other account cannot revoke authorization');
  await b.request('/api/manage/authorizations/'+auths.authorizations[0].id+'/revoke',{});
  assert.equal((await fetch(f.origin+'/api/devices',{headers:{authorization:'Bearer '+tokens.access_token}})).status,401);
  await b.request('/api/manage/devices/'+id+'/pause',{});await waitFor(()=>!f.server.broker.connections.has(id));
  await assert.rejects(f.server.broker.call('test_tool',{device_id:id},b.account.id),/暂停/);
  await b.request('/api/manage/devices/'+id+'/resume',{});
  await connectDevice(f,credentials);
  await b.request('/api/manage/devices/'+id+'/unlink',{});await waitFor(()=>!f.server.broker.connections.has(id));assert.equal(f.server.store.device(id),undefined);
});

test('network connectivity is distinct from tool health; stale and failed probes prevent dispatch',async t=>{
  const f=await fixture(t,{healthStaleMs:2000});
  const ws=await connectDevice(f,{deviceId:'p111',deviceToken:f.token},{health:false});
  assert.equal(f.server.broker.devices()[0].networkConnected,true);assert.equal(f.server.broker.devices()[0].toolsAvailable,false);
  await assert.rejects(f.server.broker.call('test_tool',{}),/健康检查/);
  ws.send(JSON.stringify({type:'health',ok:true}));await waitFor(()=>f.server.broker.devices()[0].toolsAvailable);
  const conn=f.server.broker.connections.get('p111');conn.healthAt=Date.now()-f.config.healthStaleMs-1;assert.equal(f.server.broker.devices()[0].toolsAvailable,false);
  ws.send(JSON.stringify({type:'health',ok:false}));await waitFor(()=>f.server.broker.devices()[0].health==='local_unavailable');
  await assert.rejects(f.server.broker.call('test_tool',{}),/健康检查/);
});

test('late and reconnected results survive synchronous deadlines and relay restart without rerunning tasks',async t=>{
  const f=await fixture(t,{callTimeoutMs:40});let sent=0,call;
  let ws=await connectDevice(f,{deviceId:'p111',deviceToken:f.token},{message:m=>{if(m.type==='call'){sent++;call=m;}}});
  const timed=await f.server.broker.call('test_tool',{}),id=timed._meta.desktopBridge.callId;
  assert.equal(f.server.store.call(id,'owner').status,'awaiting_result');
  ws.send(JSON.stringify({type:'result',id,result:{content:[{type:'text',text:'late result'}]}}));
  await waitFor(()=>f.server.store.call(id,'owner').status==='completed');
  const interrupted=f.server.broker.call('test_tool',{});await waitFor(()=>sent===2);ws.terminate();const r=await interrupted,lost=r._meta.desktopBridge.callId;
  await waitFor(()=>!f.server.broker.connections.has('p111'));
  await f.server.close();f.server=await startServer(f.config);f.origin='http://127.0.0.1:'+f.server.httpServer.address().port;
  ws=await connectDevice(f,{deviceId:'p111',deviceToken:f.token},{message:(m,s)=>{if(m.type==='call')sent++;if(m.type==='welcome'){assert.ok(m.recover.includes(lost));s.send(JSON.stringify({type:'result',id:lost,result:{content:[{type:'text',text:'recovered after restart'}]}}));}}});
  await waitFor(()=>f.server.store.call(lost,'owner').status==='completed');
  assert.equal(f.server.store.call(lost,'owner').result.content[0].text,'recovered after restart');assert.equal(sent,2,'recover protocol sends no execution request');
  assert.equal(f.server.store.call(id,'owner').result.content[0].text,'late result');
});

test('device key rotation promotes only after acknowledgement and revocation rejects old keys',async t=>{
  const f=await fixture(t),a=await browser(f);let nextToken;
  const ws=await connectDevice(f,{deviceId:'p111',deviceToken:f.token},{message:(m,s)=>{if(m.type==='rotate'){nextToken=m.token;s.send(JSON.stringify({type:'rotate_ack',tokenHash:hash(m.token)}));}}});
  assert.equal((await a.request('/api/manage/devices/p111/rotate',{})).status,200);
  await waitFor(()=>nextToken&&f.server.store.device('p111').tokenHash===hash(nextToken));
  assert.equal(f.server.store.device('p111').pendingHash,null);
  ws.terminate();await waitFor(()=>!f.server.broker.connections.has('p111'));
  const old=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+f.token}});old.on('error',()=>{});
  const status=await new Promise(resolve=>old.on('unexpected-response',(_q,r)=>{r.resume();old.terminate();resolve(r.statusCode);}));assert.equal(status,403);
  await connectDevice(f,{deviceId:'p111',deviceToken:nextToken});
});

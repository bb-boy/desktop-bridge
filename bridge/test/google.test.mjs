import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { startServer } from '../server/index.mjs';
import { hash, opaque, passwordHash, checkPassword } from '../server/security.mjs';

const signing=await generateKeyPair('RS256');
const otherSigning=await generateKeyPair('RS256');
const jwk={...await exportJWK(signing.publicKey),kid:'test-google-key',alg:'RS256',use:'sig'};
const ISSUER='https://accounts.google.com';
const sessionCookie=response=>response.headers.getSetCookie().find(c=>c.startsWith('bridge_session='))?.split(';')[0];

async function fixture(t,{enabled=true}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-google-'));
  const password=opaque(),encoded=await passwordHash(password);
  const config={baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,ownerPasswordHash:encoded,devices:[{id:'owner-device',name:'Owner computer',tokenHash:hash(opaque())}],...(enabled?{google:{clientId:'google-client.apps.googleusercontent.com',clientSecret:'test-server-only-secret'}}:{})};
  const codes=new Map(),exchanges=[];
  let exchangeHook;
  const mockFetch=async(url,options)=>{
    if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
    assert.equal(String(url),'https://oauth2.googleapis.com/token','production uses fixed Google endpoints');
    const body=new URLSearchParams(options.body),pending=codes.get(body.get('code'));
    assert.ok(pending,'provider authorization codes are one-time');codes.delete(body.get('code'));
    assert.equal(body.get('client_id'),config.google.clientId);
    assert.equal(body.get('client_secret'),config.google.clientSecret);
    assert.equal(body.get('redirect_uri'),config.baseUrl+'/auth/google/callback');
    assert.equal(body.get('grant_type'),'authorization_code');
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),pending.challenge);
    assert.equal(options.redirect,'error');assert.ok(options.signal);
    exchanges.push(body);
    await exchangeHook?.();
    return Response.json({id_token:pending.token,access_token:'google-access-not-retained'});
  };
  let server=await startServer(config,{googleFetch:mockFetch});
  const origin='http://127.0.0.1:'+server.httpServer.address().port;config.baseUrl=origin;
  t.after(async()=>{await server.close();fs.rmSync(directory,{recursive:true,force:true});});
  const post=(url,data={},headers={})=>fetch(config.baseUrl+url,{method:'POST',redirect:'manual',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
  async function anonymous() {
    const response=await fetch(config.baseUrl+'/api/session'),session=await response.json();
    return {headers:{cookie:response.headers.getSetCookie()[0].split(';')[0],origin:config.baseUrl,'x-csrf-token':session.csrf}};
  }
  async function localLogin() {
    const initial=await anonymous(),response=await post('/api/login',{username:'owner',password},initial.headers);
    assert.equal(response.status,200);return fromSessionCookie(sessionCookie(response));
  }
  async function fromSessionCookie(cookie) {
    const response=await fetch(config.baseUrl+'/api/session',{headers:{cookie}}),session=await response.json();
    assert.ok(session.account);
    return {account:session.account,headers:{cookie,origin:config.baseUrl,'x-csrf-token':session.csrf}};
  }
  async function begin({session,mode='login',returnTo='/'}={}) {
    session??=await anonymous();
    const response=await post('/auth/google/'+(mode==='link'?'link':'start'),{returnTo},session.headers);
    assert.equal(response.status,200,await response.clone().text());
    const url=new URL((await response.json()).url);
    assert.equal(url.origin,'https://accounts.google.com');
    assert.equal(url.searchParams.get('scope'),'openid email');
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    assert.equal(url.searchParams.get('redirect_uri'),config.baseUrl+'/auth/google/callback');
    assert.ok(!url.href.includes(config.google.clientSecret));
    return {url,cookie:response.headers.getSetCookie()[0].split(';')[0],state:url.searchParams.get('state')};
  }
  async function callback(flow,{claims={},signingKey=signing.privateKey,cookie=flow.cookie,error,afterToken}={}) {
    if(error)return fetch(config.baseUrl+'/auth/google/callback?'+new URLSearchParams({state:flow.state,error}),{redirect:'manual',headers:{cookie}});
    const now=Math.floor(Date.now()/1000);
    const token=await new SignJWT({iss:ISSUER,aud:config.google.clientId,sub:'google-subject',nonce:flow.url.searchParams.get('nonce'),email:'person@example.com',email_verified:true,iat:now,exp:now+3600,...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(signingKey);
    const code=opaque();codes.set(code,{token,challenge:flow.url.searchParams.get('code_challenge')});
    exchangeHook=afterToken;
    try {return await fetch(config.baseUrl+'/auth/google/callback?'+new URLSearchParams({state:flow.state,code}),{redirect:'manual',headers:{cookie}});}
    finally {exchangeHook=undefined;}
  }
  return {get server(){return server;},config,password,encoded,get origin(){return config.baseUrl;},directory,post,anonymous,localLogin,fromSessionCookie,begin,callback,exchanges,async restart(){await server.close();server=await startServer(config,{googleFetch:mockFetch});config.baseUrl='http://127.0.0.1:'+server.httpServer.address().port;}};
}

test('Google: missing server credentials disable sign-in without changing local password login',async t=>{
  const f=await fixture(t,{enabled:false});
  assert.deepEqual(await(await fetch(f.origin+'/api/auth/google')).json(),{enabled:false});
  assert.equal((await f.post('/auth/google/start')).status,503);
  assert.equal((await fetch(f.origin+'/auth/google/callback')).status,503);
  const owner=await f.localLogin();
  const status=await(await fetch(f.origin+'/api/manage/google',{headers:owner.headers})).json();
  assert.deepEqual(status,{enabled:false,linked:false,identity:null,hasPassword:true,canUnlink:false});
});

test('Google: subjects create isolated accounts automatically, survive restart and never merge by email',async t=>{
  const f=await fixture(t),owner=await f.localLogin(),flow=await f.begin({session:owner});
  const response=await f.callback(flow);assert.equal(response.status,303);
  assert.match(response.headers.getSetCookie().find(c=>c.startsWith('bridge_session=')),/SameSite=Lax/i);
  const first=await f.fromSessionCookie(sessionCookie(response));
  assert.notEqual(first.account.id,'owner');
  assert.equal(f.server.store.account(first.account.username).password,'');
  assert.equal(await checkPassword('',f.server.store.account(first.account.username).password),false);
  assert.equal((await(await fetch(f.origin+'/api/manage/devices',{headers:first.headers})).json()).devices.length,0);
  await f.restart();
  const again=await f.callback(await f.begin(),{claims:{email:'changed@example.com',iss:'accounts.google.com'}});
  assert.equal(again.status,303);const same=await f.fromSessionCookie(sessionCookie(again));
  assert.equal(same.account.id,first.account.id,'issuer aliases map to the same Google subject');
  const different=await f.callback(await f.begin(),{claims:{sub:'different-subject',email:'changed@example.com'}});
  assert.equal(different.status,303);const second=await f.fromSessionCookie(sessionCookie(different));
  assert.notEqual(second.account.id,first.account.id,'matching email never merges identities');
  assert.equal(f.server.store.devices('owner')[0].id,'owner-device');
  const disk=fs.readFileSync(path.join(f.directory,'bridge.db')).toString()+fs.readFileSync(path.join(f.directory,'bridge.db-wal')).toString();
  assert.ok(!disk.includes(f.config.google.clientSecret));assert.ok(!disk.includes('google-access-not-retained'));
});

test('Google: closing registration blocks new subjects but permits existing Google identities',async t=>{
  const f=await fixture(t),owner=await f.localLogin();
  const first=await f.callback(await f.begin(),{claims:{sub:'already-created',email:'existing@example.com'}});
  assert.equal(first.status,303);
  const existing=await f.fromSessionCookie(sessionCookie(first));
  const disabled=await f.post('/api/manage/admin/registration',{enabled:false},owner.headers);
  assert.equal(disabled.status,200);
  const repeat=await f.callback(await f.begin(),{claims:{sub:'already-created',email:'existing@example.com'}});
  assert.equal(repeat.status,303,'existing Google identity remains able to sign in');
  const loggedIn=await f.fromSessionCookie(sessionCookie(repeat));
  assert.equal(loggedIn.account.id,existing.account.id);
  const fresh=await f.callback(await f.begin(),{claims:{sub:'new-subject-while-closed',email:'new@example.com'}});
  assert.equal(fresh.status,403,'new Google subjects must not create accounts');
  assert.equal((await fresh.json()).error,'registration_disabled');
  assert.equal(f.server.store.db.prepare('SELECT count(*) AS n FROM google_identities').get().n,1);
});

test('Google: explicit linking retains owner devices and unlinking preserves a password login',async t=>{
  const f=await fixture(t),owner=await f.localLogin();
  const response=await f.callback(await f.begin({session:owner,mode:'link'}));
  assert.equal(response.status,303);const linked=await f.fromSessionCookie(sessionCookie(response));
  assert.equal(linked.account.id,'owner');assert.equal(f.server.store.devices('owner')[0].id,'owner-device');
  const status=await(await fetch(f.origin+'/api/manage/google',{headers:linked.headers})).json();
  assert.equal(status.linked,true);assert.equal(status.canUnlink,true);assert.equal(status.identity.subject,'google-subject');
  assert.equal((await f.post('/auth/google/link',{},linked.headers)).status,409);
  assert.equal((await f.post('/api/manage/google/unlink',{}, {...linked.headers,'x-csrf-token':'wrong'})).status,403);
  const unlinked=await f.post('/api/manage/google/unlink',{},linked.headers);assert.equal(unlinked.status,200);
  const fresh=await f.fromSessionCookie(sessionCookie(unlinked));assert.equal(fresh.account.id,'owner');
  assert.equal((await fetch(f.origin+'/api/manage/devices',{headers:linked.headers})).status,401,'unlink rotates existing sessions');
  assert.equal((await f.localLogin()).account.id,'owner');
  assert.equal(f.server.store.devices('owner').length,1);
});

test('Google: a Google-only account cannot remove its last login method or be claimed by another owner',async t=>{
  const f=await fixture(t),response=await f.callback(await f.begin());
  const google=await f.fromSessionCookie(sessionCookie(response));
  const status=await(await fetch(f.origin+'/api/manage/google',{headers:google.headers})).json();
  assert.equal(status.hasPassword,false);assert.equal(status.canUnlink,false);
  assert.equal((await f.post('/api/manage/google/unlink',{},google.headers)).status,409);
  const owner=await f.localLogin(),conflict=await f.callback(await f.begin({session:owner,mode:'link'}));
  assert.equal(conflict.status,409);
  assert.equal(f.server.store.db.prepare('SELECT owner FROM google_identities WHERE subject=?').get('google-subject').owner,google.account.id);
});

test('Google: state requires its browser cookie, expires, and cannot be replayed after success or cancellation',async t=>{
  const f=await fixture(t),first=await f.begin();
  assert.equal((await f.callback(first,{cookie:'other=value'})).status,403);
  assert.equal(f.exchanges.length,0);
  assert.equal((await f.callback(first)).status,303);
  assert.equal((await f.callback(first)).status,403);assert.equal(f.exchanges.length,1);
  const expired=await f.begin();f.server.store.db.prepare('UPDATE grants SET expires=? WHERE hash=?').run(Date.now()-1,hash(expired.state));
  assert.equal((await f.callback(expired)).status,403);assert.equal(f.exchanges.length,1);
  const cancelled=await f.begin();assert.equal((await f.callback(cancelled,{error:'access_denied'})).status,400);
  assert.equal((await f.callback(cancelled)).status,403);assert.equal(f.exchanges.length,1);
});

test('Google: starts enforce Origin and CSRF, and return destinations stay within this server',async t=>{
  const f=await fixture(t),initial=await f.anonymous();
  assert.equal((await f.post('/auth/google/start',{},initial.headers)).status,200);
  assert.equal((await f.post('/auth/google/start',{}, {...initial.headers,origin:'https://attacker.invalid'})).status,403);
  assert.equal((await f.post('/auth/google/start',{}, {...initial.headers,'x-csrf-token':'wrong'})).status,403);
  for(const returnTo of ['https://attacker.invalid','//attacker.invalid','/\\attacker.invalid','/\nattacker'])assert.equal((await f.post('/auth/google/start',{returnTo},initial.headers)).status,400);
  assert.equal((await f.post('/auth/google/link',{},initial.headers)).status,401);
});

for(const [name,claims,key] of [
  ['issuer',{iss:'https://attacker.invalid'}],['audience',{aud:'another-client'}],['nonce',{nonce:'other-nonce'}],
  ['expiry',{exp:Math.floor(Date.now()/1000)-120}],['missing expiry',{exp:undefined}],['future issuance',{iat:Math.floor(Date.now()/1000)+600}],['subject',{sub:''}],['missing subject',{sub:undefined}],
  ['unverified email',{email_verified:false}],['missing email',{email:undefined}],['authorized party',{azp:'another-client'}],
  ['multiple audiences without authorized party',{aud:['google-client.apps.googleusercontent.com','another-client']}],
  ['signature',{},otherSigning.privateKey]
])test('Google: rejects invalid '+name,async t=>{
  const f=await fixture(t),response=await f.callback(await f.begin(),{claims,signingKey:key??signing.privateKey});
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'google_verification_failed'});
  assert.equal(f.server.store.db.prepare('SELECT count(*) AS n FROM google_identities').get().n,0);
  assert.equal(f.server.store.db.prepare('SELECT count(*) AS n FROM accounts').get().n,1);
});

test('Google: an expired linking session is rechecked after exchanging the authorization code',async t=>{
  const f=await fixture(t),owner=await f.localLogin(),flow=await f.begin({session:owner,mode:'link'});
  const response=await f.callback(flow,{afterToken:()=>f.server.store.db.prepare('DELETE FROM sessions WHERE owner=?').run('owner')});
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'link_session_expired'});
  assert.equal(f.server.store.db.prepare('SELECT count(*) AS n FROM google_identities').get().n,0);
});

test('Google: a passwordless session still requires explicit MCP approval and authorizes only its own account',async t=>{
  const f=await fixture(t),request=opaque(),csrf=opaque(),csrfCookie='bridge_csrf_test';
  const grant={clientId:'test-mcp',clientName:'Test MCP',redirectUri:'https://example.com/callback',state:'mcp-state',challenge:opaque(),csrf,csrfCookie};
  f.server.store.saveGrant(hash(request),'consent',grant.clientId,grant,Date.now()+600000);
  const consentPath='/oauth/consent?request='+request;
  const anonymousPage=await fetch(f.origin+consentPath,{headers:{cookie:csrfCookie+'='+csrf}}),anonymousHtml=await anonymousPage.text();
  assert.match(anonymousHtml,/id="google-consent-login"/);assert.match(anonymousHtml,/src="\/oauth-google.js"/);
  assert.match(anonymousPage.headers.get('content-security-policy'),/script-src 'self'/);
  const login=await f.callback(await f.begin({returnTo:consentPath}));assert.equal(login.status,303);assert.equal(login.headers.get('location'),consentPath);
  const google=await f.fromSessionCookie(sessionCookie(login));
  const cookie=google.headers.cookie+'; '+csrfCookie+'='+csrf;
  const page=await fetch(f.origin+consentPath,{headers:{cookie}}),html=await page.text();
  assert.match(html,/name="authMode" value="session"/);assert.doesNotMatch(html,/name="password"|google-consent-login/);
  const count=()=>f.server.store.db.prepare("SELECT count(*) AS n FROM grants WHERE kind IN ('code','access','refresh')").get().n;
  assert.equal(count(),0,'Google login alone never approves MCP access');
  const body={request,csrf,authMode:'session',ownerId:google.account.id,sessionCsrf:google.headers['x-csrf-token'],decision:'approve'};
  assert.equal((await f.post('/oauth/approve',{...body,sessionCsrf:'wrong'},{cookie,origin:f.origin})).status,403);
  assert.equal(count(),0);
  const response=await f.post('/oauth/approve',body,{cookie,origin:f.origin});assert.equal(response.status,303);
  const code=new URL(response.headers.get('location')).searchParams.get('code');
  const tokens=await f.server.provider.exchangeAuthorizationCode({client_id:'test-mcp'},code,null,grant.redirectUri);
  assert.equal((await f.server.provider.verifyAccessToken(tokens.access_token)).extra.ownerId,google.account.id);
  const devices=await(await fetch(f.origin+'/api/devices',{headers:{authorization:'Bearer '+tokens.access_token}})).json();
  assert.deepEqual(devices.devices,[]);
});


test('Google: concurrent callbacks exchange a flow once and failed provider exchanges burn the flow',async t=>{
  const f=await fixture(t),flow=await f.begin();
  const results=await Promise.all([f.callback(flow),f.callback(flow)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[303,403]);assert.equal(f.exchanges.length,1);
  const failed=await f.begin();
  assert.equal((await f.callback(failed,{afterToken:()=>{throw new Error('Provider connection failed');}})).status,403);
  assert.equal((await f.callback(failed)).status,403);assert.equal(f.exchanges.length,2);
});

test('distribution: fresh Google users pair and authorize the same plugin without owner intervention or cross-account access',async t=>{
 const f=await fixture(t);
 const guide=await fetch(f.origin+'/start.html');assert.equal(guide.status,200);
 const html=await guide.text();
 assert.match(html,/https:\/\/mcp\.ilovestudy\.de\/mcp/);
 assert.match(html,/OAuth/);
 assert.doesNotMatch(html,/href="\/downloads\/desktop-bridge-plugin\.zip"/);
 assert.doesNotMatch(html,/https:\/\/chatgpt\.com\/plugins\/(?:plugin|plugins|dev)[_-]/);
 const signIn=async subject=>{
  const response=await f.callback(await f.begin(),{claims:{sub:subject,email:'same-display-email@example.com'}});
  assert.equal(response.status,303);return f.fromSessionCookie(sessionCookie(response));
 };
 const alice=await signIn('distribution-alice'),bob=await signIn('distribution-bob');
 assert.notEqual(alice.account.id,bob.account.id);assert.notEqual(alice.account.id,'owner');assert.notEqual(bob.account.id,'owner');
 for(const user of [alice,bob]){
  assert.deepEqual((await(await fetch(f.origin+'/api/manage/devices',{headers:user.headers})).json()).devices,[]);
  assert.equal(f.server.store.account(user.account.username).password,'','no local password or invitation was required');
 }
 const pairingResponse=await f.post('/api/pair/start',{name:'Alice Windows',platform:'win32',version:'0.2.1'});
 assert.equal(pairingResponse.status,200);const pairing=await pairingResponse.json();
 assert.equal((await f.post('/api/manage/pair',{code:pairing.userCode,decision:'approve'},alice.headers)).status,200);
 const poll=await f.post('/api/pair/poll',{deviceCode:pairing.deviceCode});assert.equal(poll.status,200);
 const credentials=await poll.json();
 assert.equal((await f.post('/api/manage/devices/'+credentials.deviceId+'/rename',{name:'not yours'},bob.headers)).status,404);
 const registration=await f.post('/register',{client_name:'Shared distribution fixture',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});
 assert.equal(registration.status,201);const registered=await registration.json();
 async function connectMcp(user){
  const verifier=opaque(),challenge=createHash('sha256').update(verifier).digest('base64url');
  const params=new URLSearchParams({client_id:registered.client_id,response_type:'code',redirect_uri:'https://client.example/callback',code_challenge:challenge,code_challenge_method:'S256',scope:'desktop',state:opaque()});
  const authorization=await fetch(f.origin+'/authorize?'+params,{redirect:'manual'});assert.equal(authorization.status,302);
  const consentCookie=authorization.headers.getSetCookie()[0].split(';')[0];
  const request=new URL(authorization.headers.get('location'),f.origin).searchParams.get('request');
  const cookie=user.headers.cookie+'; '+consentCookie;
  const page=await fetch(f.origin+'/oauth/consent?request='+request,{headers:{cookie}});assert.equal(page.status,200);
  const csrf=(await page.text()).match(/name="csrf" value="([^"]+)"/)[1];
  const approved=await f.post('/oauth/approve',{request,csrf,authMode:'session',ownerId:user.account.id,sessionCsrf:user.headers['x-csrf-token'],decision:'approve'},{origin:f.origin,cookie});
  assert.equal(approved.status,303);
  const code=new URL(approved.headers.get('location')).searchParams.get('code');
  const tokenResponse=await fetch(f.origin+'/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,code,code_verifier:verifier,redirect_uri:'https://client.example/callback'})});
  assert.equal(tokenResponse.status,200);const tokens=await tokenResponse.json();
  const client=new Client({name:'distribution-test',version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+tokens.access_token}}}));
  return client;
 }
 let ws,aliceClient,bobClient,dispatched=0;
 try{
  ws=new WebSocket(f.origin.replace('http:','ws:')+'/agent',{headers:{authorization:'Bearer '+credentials.deviceToken}});
  await once(ws,'open');
  ws.on('message',data=>{const message=JSON.parse(data);if(message.type==='call'){dispatched++;ws.send(JSON.stringify({type:'result',id:message.id,result:{content:[{type:'text',text:'read-only fixture result'}]}}));}});
  ws.send(JSON.stringify({type:'hello',protocol:2,version:'0.2.1',deviceId:credentials.deviceId,tools:[{name:'distribution_echo',description:'Read-only fixture echo',inputSchema:{type:'object',properties:{}}}]}));
  ws.send(JSON.stringify({type:'health',ok:true}));
  for(let i=0;i<100&&!f.server.broker.devices(alice.account.id)[0]?.toolsAvailable;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.server.broker.devices(alice.account.id)[0]?.toolsAvailable,true);
  aliceClient=await connectMcp(alice);bobClient=await connectMcp(bob);
  const devices=client=>client.callTool({name:'list_devices',arguments:{}}).then(r=>JSON.parse(r.content[0].text));
  const own=await devices(aliceClient);assert.equal(own.length,1);assert.equal(own[0].id,credentials.deviceId);assert.equal(own[0].toolsAvailable,true);
  assert.deepEqual(await devices(bobClient),[]);
  assert.ok((await aliceClient.listTools()).tools.some(tool=>tool.name==='distribution_echo'));
  assert.ok(!(await bobClient.listTools()).tools.some(tool=>tool.name==='distribution_echo'));
  const result=await aliceClient.callTool({name:'distribution_echo',arguments:{device_id:credentials.deviceId}});assert.notEqual(result.isError,true);
  const denied=await bobClient.callTool({name:'distribution_echo',arguments:{device_id:credentials.deviceId}});assert.equal(denied.isError,true);assert.equal(dispatched,1);
  const tasks=JSON.parse((await aliceClient.callTool({name:'list_calls',arguments:{}})).content[0].text);assert.equal(tasks.length,1);
  assert.deepEqual(JSON.parse((await bobClient.callTool({name:'list_calls',arguments:{}})).content[0].text),[]);
  const hiddenResult=await bobClient.callTool({name:'get_call_result',arguments:{call_id:tasks[0].id}});assert.equal(hiddenResult.isError,true);
  assert.equal(f.server.store.devices('owner').length,1,'original owner devices remain separate');
 }finally{await aliceClient?.close();await bobClient?.close();ws?.terminate();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.mjs';
import { checkPassword, hash, opaque, passwordHash } from '../server/security.mjs';

async function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-accounts-'));
  const password=opaque(),encoded=await passwordHash(password);
  const config={baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,ownerPasswordHash:encoded,devices:[]};
  const server=await startServer(config);
  config.baseUrl='http://127.0.0.1:'+server.httpServer.address().port;
  t.after(async()=>{await server.close();fs.rmSync(directory,{recursive:true,force:true});});
  const post=(url,data,headers={})=>fetch(config.baseUrl+url,{method:'POST',redirect:'manual',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
  async function login(username='owner',secret=password) {
    const initial=await fetch(config.baseUrl+'/api/session'),{csrf}=await initial.json();
    const response=await post('/api/login',{username,password:secret},{origin:config.baseUrl,cookie:initial.headers.getSetCookie()[0].split(';')[0],'x-csrf-token':csrf});
    assert.equal(response.status,200);
    const session=await response.json();
    const headers={origin:config.baseUrl,cookie:response.headers.getSetCookie().find(v=>v.startsWith('bridge_session=')).split(';')[0],'x-csrf-token':session.csrf};
    return {session,headers,post:(url,data)=>post(url,data,headers),get:url=>fetch(config.baseUrl+url,{headers})};
  }
  async function consent(ownerId='owner') {
    const request=opaque(),csrf=opaque(),csrfCookie='test_consent_'+opaque();
    const grant={clientId:'test-client',clientName:'Test client',redirectUri:'https://example.com/callback',state:'private-state',challenge:opaque(),csrf,csrfCookie};
    server.store.saveGrant(hash(request),'consent',grant.clientId,grant,Date.now()+60000);
    const headers={origin:config.baseUrl,cookie:csrfCookie+'='+csrf};
    return {request,grant,approve:()=>post('/oauth/approve',{request,csrf,username:ownerId,password,decision:'approve'},headers),deny:()=>post('/oauth/approve',{request,csrf,decision:'deny'},headers)};
  }
  return {server,password,encoded,origin:config.baseUrl,post,login,consent};
}

test('accounts: concurrent OAuth approvals consume consent exactly once; denial cannot be replayed',async t=>{
  const f=await fixture(t),c=await f.consent();
  const results=await Promise.all([c.approve(),c.approve()]);
  assert.deepEqual(results.map(r=>r.status).sort(),[303,403]);
  assert.equal(f.server.store.db.prepare("SELECT count(*) AS n FROM grants WHERE kind='code'").get().n,1);
  const denied=await f.consent();
  assert.equal((await denied.deny()).status,303);
  assert.equal((await denied.approve()).status,403);
});

test('accounts: password changes invalidate existing sessions and every OAuth credential',async t=>{
  const f=await fixture(t),first=await f.login(),second=await f.login();
  const client={client_id:'test-client'};
  const c=await f.consent(),approved=await c.approve();
  const code=new URL(approved.headers.get('location')).searchParams.get('code');
  const tokens=await f.server.provider.exchangeAuthorizationCode(client,code,null,'https://example.com/callback');
  const pending=await f.consent();
  const approvedPending=await pending.approve(),pendingCode=new URL(approvedPending.headers.get('location')).searchParams.get('code');
  const result=await first.post('/api/password',{currentPassword:f.password,password:'A changed sufficiently long password'});
  assert.equal(result.status,200);
  assert.equal((await second.get('/api/manage/devices')).status,401);
  assert.equal((await first.get('/api/manage/devices')).status,200);
  await assert.rejects(f.server.provider.verifyAccessToken(tokens.access_token));
  await assert.rejects(f.server.provider.exchangeRefreshToken(client,tokens.refresh_token));
  await assert.rejects(f.server.provider.exchangeAuthorizationCode(client,pendingCode,null,'https://example.com/callback'));
  assert.equal(await checkPassword(f.password,f.server.store.account('owner').password),false);
});

test('accounts: pairing denial, expiration, owner isolation and unlink-before-claim are enforced',async t=>{
  const f=await fixture(t),owner=await f.login();
  const db=f.server.store.db;
  db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('alice','alice',f.encoded,0,Date.now());
  const alice=await f.login('alice');
  const pair=async()=>{const response=await f.post('/api/pair/start',{name:'Computer',platform:'linux',version:'0.2.0'});assert.equal(response.status,200);return response.json();};
  const poll=p=>f.post('/api/pair/poll',{deviceCode:p.deviceCode});
  const denied=await pair();
  assert.equal((await alice.post('/api/manage/pair',{code:denied.userCode,decision:'deny'})).status,200);
  assert.equal((await poll(denied)).status,403);
  assert.equal((await owner.post('/api/manage/pair',{code:denied.userCode,decision:'approve'})).status,404);
  const expired=await pair();
  db.prepare('UPDATE pairings SET expires=? WHERE hash=?').run(Date.now()-1,hash(expired.deviceCode));
  assert.equal((await poll(expired)).status,410);
  assert.equal((await alice.post('/api/manage/pair',{code:expired.userCode,decision:'approve'})).status,404);
  const active=await pair();
  assert.equal((await alice.post('/api/manage/pair',{code:active.userCode,decision:'approve'})).status,200);
  const device=db.prepare('SELECT device FROM pairings WHERE hash=?').get(hash(active.deviceCode)).device;
  for(const action of ['rename','pause','resume','unlink','rotate'])assert.equal((await owner.post('/api/manage/devices/'+device+'/'+action,{name:'Not mine'})).status,404);
  assert.equal((await alice.post('/api/manage/devices/'+device+'/unlink',{})).status,200);
  assert.equal((await poll(active)).status,410,'unlinked device never receives credentials');
  assert.equal(db.prepare('SELECT tokenHash FROM registry WHERE id=?').get(device).tokenHash,null);
});

test('accounts: invalid pairing decisions do not approve and capacity never prevents denial',async t=>{
  const f=await fixture(t),owner=await f.login();
  const response=await f.post('/api/pair/start',{}),pair=await response.json();
  assert.equal((await owner.post('/api/manage/pair',{code:pair.userCode,decision:'maybe'})).status,400);
  for(let i=0;i<50;i++)f.server.store.db.prepare('INSERT INTO registry(id,owner,name) VALUES (?,?,?)').run('device-'+i,'owner','Device');
  assert.equal((await owner.post('/api/manage/pair',{code:pair.userCode,decision:'approve'})).status,409);
  assert.equal((await owner.post('/api/manage/pair',{code:pair.userCode,decision:'deny'})).status,200);
});

test('accounts: session writes require both same-origin requests and the session CSRF token',async t=>{
  const f=await fixture(t),owner=await f.login();
  for(const headers of [{...owner.headers,origin:'https://attacker.invalid'},{...owner.headers,'x-csrf-token':'wrong'},{...owner.headers,'sec-fetch-site':'cross-site'}]){
    assert.equal((await f.post('/api/invitations',{},headers)).status,403);
  }
  assert.equal((await owner.post('/api/logout',{})).status,200);
  assert.equal((await owner.get('/api/manage/devices')).status,401);
});

test('accounts: expired consent and deleted owners cannot mint credentials',async t=>{
  const f=await fixture(t),c=await f.consent();
  f.server.store.db.prepare('UPDATE grants SET expires=? WHERE hash=?').run(Date.now()-1,hash(c.request));
  assert.equal((await c.approve()).status,403);
  const tokens=f.server.provider.exchangeRefreshToken;
  f.server.store.saveGrant(hash('refresh-token'),'refresh','test-client',{clientId:'test-client',ownerId:'deleted',family:'family'},Date.now()+60000);
  await assert.rejects(tokens({client_id:'test-client'},'refresh-token'));
  assert.ok(f.server.store.grant(hash('refresh-token'),'refresh'),'failed exchange does not consume the original grant');
});

test('accounts: malformed password digests fail closed',async()=>{
  for(const encoded of [undefined,null,'','bad','salt:not-a-digest',':'+ 'f'.repeat(128)])assert.equal(await checkPassword('password',encoded),false);
});

test('accounts: stale password snapshots cannot create login sessions or OAuth codes',async t=>{
  const f=await fixture(t),replacement=await passwordHash('A different sufficiently long password');
  const originalAccount=f.server.store.account.bind(f.server.store);
  function replaceAfterSnapshot() {
    let first=true;
    f.server.store.account=username=>{
      const account=originalAccount(username);
      if(first&&account){first=false;f.server.store.db.prepare('UPDATE accounts SET password=? WHERE id=?').run(replacement,account.id);}
      return account;
    };
  }
  const c=await f.consent();replaceAfterSnapshot();
  assert.equal((await c.approve()).status,403,'a reset after the password snapshot invalidates approval');
  assert.equal(f.server.store.db.prepare("SELECT count(*) AS n FROM grants WHERE kind='code'").get().n,0);
  f.server.store.db.prepare('UPDATE accounts SET password=? WHERE id=?').run(f.encoded,'owner');
  replaceAfterSnapshot();
  const initial=await fetch(f.origin+'/api/session'),{csrf}=await initial.json();
  const response=await f.post('/api/login',{username:'owner',password:f.password},{origin:f.origin,cookie:initial.headers.getSetCookie()[0].split(';')[0],'x-csrf-token':csrf});
  assert.equal(response.status,401,'a stale password verification cannot create a session');
  assert.equal(f.server.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});

test('accounts: rotation delivery failure permits retry and preserves a newer pending credential',async t=>{
  const f=await fixture(t),owner=await f.login();
  const db=f.server.store.db;
  db.prepare('INSERT INTO registry(id,owner,name,tokenHash) VALUES (?,?,?,?)').run('rotation-device','owner','Computer',hash('old-token'));
  const connection={ready:true,protocol:2,ws:{readyState:1,send(_data,callback){callback(new Error('Connection lost'));}}};
  f.server.broker.connections.set('rotation-device',connection);
  try {
    const response=await owner.post('/api/manage/devices/rotation-device/rotate',{});
    assert.equal(response.status,503);
    assert.equal(f.server.store.device('rotation-device').pendingHash,null);
    assert.equal(f.server.store.device('rotation-device').tokenHash,hash('old-token'));
    const newer=hash('newer-token');
    connection.ws.send=(_data,callback)=>{db.prepare('UPDATE registry SET pendingHash=? WHERE id=?').run(newer,'rotation-device');callback(new Error('Old send failed'));};
    assert.equal((await owner.post('/api/manage/devices/rotation-device/rotate',{})).status,503);
    assert.equal(f.server.store.device('rotation-device').pendingHash,newer);
  } finally {f.server.broker.connections.delete('rotation-device');}
});

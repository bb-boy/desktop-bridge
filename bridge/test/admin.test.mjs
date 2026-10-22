import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server/index.mjs';
import {hash,opaque,passwordHash} from '../server/security.mjs';

async function fixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-admin-'));
 const secret=opaque(),encoded=await passwordHash(secret);
 const config={baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,ownerPasswordHash:encoded,devices:[]};
 let server=await startServer(config);
 config.baseUrl='http://127.0.0.1:'+server.httpServer.address().port;
 t.after(async()=>{await server.close();fs.rmSync(directory,{recursive:true,force:true});});
 const send=(url,data,headers={})=>fetch(config.baseUrl+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
 async function login(username='owner'){
  const initial=await fetch(config.baseUrl+'/api/session'),{csrf}=await initial.json();
  const response=await send('/api/login',{username,password:secret},{cookie:initial.headers.getSetCookie()[0].split(';')[0],origin:config.baseUrl,'x-csrf-token':csrf});
  assert.equal(response.status,200);
  const result=await response.json();
  return {account:result.account,headers:{cookie:response.headers.getSetCookie().find(c=>c.startsWith('bridge_session=')).split(';')[0],origin:config.baseUrl,'x-csrf-token':result.csrf},
   get:url=>fetch(config.baseUrl+url,{headers:this?.headers}), // overridden below to avoid capturing lexical this
   post:null};
 }
 async function authenticated(username='owner'){
  const a=await login(username);
  a.get=url=>fetch(config.baseUrl+url,{headers:a.headers});
  a.post=(url,data={})=>send(url,data,a.headers);
  return a;
 }
 return {get server(){return server;},config,directory,secret,encoded,send,authenticated,async restart(){await server.close();server=await startServer(config);config.baseUrl='http://127.0.0.1:'+server.httpServer.address().port;}};
}

test('admin: only an authenticated administrator can list or change user settings',async t=>{
 const f=await fixture(t),admin=await f.authenticated();
 const db=f.server.store.db;
 db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('regular','regular',f.encoded,0,Date.now());
 const ordinary=await f.authenticated('regular');
 assert.equal((await f.send('/api/manage/admin/registration',{enabled:false})).status,401);
 assert.equal((await ordinary.get('/api/manage/admin')).status,403);
 assert.equal((await ordinary.post('/api/manage/admin/registration',{enabled:false})).status,403);
 assert.equal((await ordinary.post('/api/manage/admin/users/owner/delete')).status,403);
 assert.equal((await f.send('/api/manage/admin/registration',{enabled:false},{...admin.headers,origin:'https://evil.invalid'})).status,403);
 assert.equal((await f.send('/api/manage/admin/registration',{enabled:false},{...admin.headers,'x-csrf-token':'incorrect'})).status,403);
 assert.equal((await admin.post('/api/manage/admin/registration',{enabled:'false'})).status,400);
 const result=await(await admin.get('/api/manage/admin')).json();
 assert.equal(result.registrationEnabled,true);
 assert.equal(result.users.length,2);
 assert.ok(result.users.every(a=>!('password' in a)&&!('tokenHash' in a)));
 assert.equal(result.users[0].admin,1);
});

test('admin: registration switch persists and protects signup, without disabling existing logins',async t=>{
 const f=await fixture(t),admin=await f.authenticated();
 const {db}=f.server.store;
 db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('regular','regular',f.encoded,0,Date.now());
 assert.equal((await admin.post('/api/manage/admin/registration',{enabled:false})).status,200);
 assert.equal((await(await fetch(f.config.baseUrl+'/api/registration')).json()).enabled,false);
 assert.equal((await admin.post('/api/invitations')).status,409);
 const initial=await fetch(f.config.baseUrl+'/api/session'),{csrf}=await initial.json();
 const signup=()=>f.send('/api/signup',{username:'newuser',password:'very long secure password',invitation:'no-invite'},{
  cookie:initial.headers.getSetCookie()[0].split(';')[0],origin:f.config.baseUrl,'x-csrf-token':csrf
 });
 assert.equal((await signup()).status,403);
 assert.equal((await f.authenticated('regular')).account.id,'regular');
 await f.restart();
 assert.equal((await(await fetch(f.config.baseUrl+'/api/registration')).json()).enabled,false);
 const adminAgain=await f.authenticated();
 assert.equal((await adminAgain.post('/api/manage/admin/registration',{enabled:true})).status,200);
 assert.equal((await adminAgain.post('/api/invitations')).status,200);
 const invitation=await(await adminAgain.post('/api/invitations')).json();
 const token=new URL(invitation.url).searchParams.get('invite');
 const openSession=await fetch(f.config.baseUrl+'/api/session');
 const csrfOpen=(await openSession.json()).csrf;
 const response=await f.send('/api/signup',{username:'newuser',password:'very long secure password',invitation:token},{
  cookie:openSession.headers.getSetCookie()[0].split(';')[0],origin:f.config.baseUrl,'x-csrf-token':csrfOpen
 });
 assert.equal(response.status,201);
});

test('admin: deleting an account removes credentials, devices, Google identity and sessions',async t=>{
 const f=await fixture(t),admin=await f.authenticated(),db=f.server.store.db;
 db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('regular','regular',f.encoded,0,Date.now());
 const regular=await f.authenticated('regular');
 db.prepare('INSERT INTO google_identities VALUES (?,?,?,?,?)').run('https://accounts.google.com','subject-id','regular','regular@example.com',Date.now());
 db.prepare('INSERT INTO registry(id,owner,name,tokenHash) VALUES (?,?,?,?)').run('regular-device','regular','Computer',hash('device-secret'));
 db.prepare('INSERT INTO devices(id,owner,tools,updated) VALUES (?,?,?,?)').run('regular-device','regular','[]',Date.now());
 db.prepare('INSERT INTO pairings VALUES (?,?,?,?,?,?,?,?,?)').run(hash('pair'),hash('code'),'other','Computer','linux','1.0','regular','approved',Date.now()+100000);
 db.prepare('INSERT INTO monthly_usage VALUES (?,?,?,?)').run('regular','2026-10',5,Date.now());
 f.server.store.saveGrant(hash('access'),'access','client',{ownerId:'regular',family:'family'},Date.now()+60000);
 const users=await(await admin.get('/api/manage/admin')).json();
 assert.equal(users.users.find(a=>a.id==='regular').email,'regular@example.com');
 assert.equal(users.users.find(a=>a.id==='regular').deviceCount,1);
 assert.equal((await regular.post('/api/manage/admin/users/owner/delete')).status,403);
 assert.equal((await admin.post('/api/manage/admin/users/owner/delete')).status,403);
 f.server.store.setDeviceLimit('regular',12);
 assert.equal((await admin.post('/api/manage/admin/users/regular/delete')).status,200);
 assert.equal((await admin.post('/api/manage/admin/users/regular/delete')).status,404);
 assert.equal((await regular.get('/api/manage/devices')).status,401);
 assert.equal(f.server.store.accountById('regular'),undefined);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM google_identities WHERE owner=?').get('regular').n,0);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE owner=?').get('regular').n,0);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM grants WHERE hash=?').get(hash('access')).n,0);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM pairings WHERE owner=?').get('regular').n,0);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM monthly_usage WHERE owner=?').get('regular').n,0);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM account_device_limits WHERE owner=?').get('regular').n,0);
 assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE owner=?').get('regular').n,0);
 const revoked=f.server.store.db.prepare('SELECT * FROM registry WHERE id=?').get('regular-device');
 assert.equal(revoked.revoked,1);assert.equal(revoked.tokenHash,null);assert.equal(revoked.owner,'deleted');
 assert.equal((await admin.get('/api/manage/admin')).status,200,'admin remains active');
});

test('admin: UI exposes separate administrator dialog without adding a standard account tab',()=>{
 const dirname=path.dirname(fileURLToPath(import.meta.url));
 const html=fs.readFileSync(path.join(dirname,'../public/index.html'),'utf8');
 const js=fs.readFileSync(path.join(dirname,'../public/app.js'),'utf8');
 assert.match(html,/id="admin-entry"[^>]*hidden/);
 assert.match(html,/id="admin-dialog"[^>]*aria-labelledby="admin-heading"/);
 assert.match(html,/id="registration-enabled" role="switch"/);
 assert.match(js,/admin-entry'\)\.hidden=!account\?\.admin/);
 assert.match(js,/api\/manage\/admin\/users/);
 assert.match(js,/device-limit/);
 assert.match(js,/limitInput\.min='0';limitInput\.max='1000'/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});


test('admin: per-user device limits default to 50, validate input, respect role and survive restart',async t=>{
 const f=await fixture(t),admin=await f.authenticated(),db=f.server.store.db;
 db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('regular','regular',f.encoded,0,Date.now());
 const regular=await f.authenticated('regular');
 const endpoint='/api/manage/admin/users/regular/device-limit';
 const users=(await(await admin.get('/api/manage/admin')).json()).users;
 assert.equal(users.find(u=>u.id==='regular').deviceLimit,50);
 assert.equal(users.find(u=>u.id==='owner').deviceLimit,50);
 assert.equal((await f.send(endpoint,{limit:1})).status,401);
 assert.equal((await regular.post(endpoint,{limit:1})).status,403);
 assert.equal((await admin.post(endpoint,{limit:'1'})).status,400);
 for(const limit of [-1,1001,1.2,null,true])assert.equal((await admin.post(endpoint,{limit})).status,400);
 assert.equal((await f.send(endpoint,{limit:1},{...admin.headers,origin:'https://not-our-site.invalid'})).status,403);
 assert.equal((await admin.post('/api/manage/admin/users/nonexistent/device-limit',{limit:5})).status,404);
 assert.equal((await admin.post(endpoint,{limit:0})).status,200,'zero disables future pairs');
 assert.equal(f.server.store.deviceLimit('regular'),0);
 assert.equal((await admin.post(endpoint,{limit:1000})).status,200);
 assert.equal(f.server.store.deviceLimit('regular'),1000);
 assert.equal((await admin.post(endpoint,{limit:2})).status,200);
 await f.restart();
 assert.equal(f.server.store.deviceLimit('regular'),2);
 const after=(await(await(await f.authenticated()).get('/api/manage/admin')).json()).users;
 assert.equal(after.find(u=>u.id==='regular').deviceLimit,2);
 assert.equal(after.find(u=>u.id==='owner').deviceLimit,50);
});

test('admin: per-user limit is enforced atomically at pairing approval, without evicting existing devices',async t=>{
 const f=await fixture(t),admin=await f.authenticated(),db=f.server.store.db;
 db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('regular','regular',f.encoded,0,Date.now());
 const regular=await f.authenticated('regular');
 const limitEndpoint='/api/manage/admin/users/regular/device-limit';
 assert.equal((await admin.post(limitEndpoint,{limit:1})).status,200);
 async function startPair(name){
   const response=await f.send('/api/pair/start',{name,platform:'darwin',version:'0.2.7'});
   assert.equal(response.status,200);
   return response.json();
 }
 const first=await startPair('First');
 const second=await startPair('Second');
 assert.equal((await regular.post('/api/manage/pair',{code:first.userCode,decision:'approve'})).status,200);
 const conflict=await regular.post('/api/manage/pair',{code:second.userCode,decision:'approve'});
 assert.equal(conflict.status,409);
 assert.match((await conflict.json()).error,/1 台/);
 let users=(await(await admin.get('/api/manage/admin')).json()).users;
 assert.equal(users.find(u=>u.id==='regular').deviceCount,1);
 assert.equal((await admin.post(limitEndpoint,{limit:0})).status,200);
 users=(await(await admin.get('/api/manage/admin')).json()).users;
 assert.equal(users.find(u=>u.id==='regular').deviceCount,1,'lowering a limit does not unbind devices');
 assert.equal(users.find(u=>u.id==='regular').deviceLimit,0);
 assert.equal((await regular.post('/api/manage/pair',{code:second.userCode,decision:'approve'})).status,409);
 const deviceId=db.prepare('SELECT id FROM registry WHERE owner=? AND revoked=0').get('regular').id;
 assert.equal((await regular.post('/api/manage/devices/'+deviceId+'/unlink',{})).status,200);
 assert.equal((await regular.post('/api/manage/pair',{code:second.userCode,decision:'approve'})).status,409,'limit zero still blocks pairing');
 assert.equal((await admin.post(limitEndpoint,{limit:1})).status,200);
 assert.equal((await regular.post('/api/manage/pair',{code:second.userCode,decision:'approve'})).status,200,'slot is available after unlink');
 const poll=await f.send('/api/pair/poll',{deviceCode:second.deviceCode});
 assert.equal(poll.status,200);
 assert.ok((await poll.json()).deviceToken);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registry WHERE owner=? AND revoked=0').get('regular').n,1);
});

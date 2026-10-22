import { randomUUID, randomInt } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { opaque,hash,passwordHash,checkPassword,cookieValue } from './security.mjs';
import { bridgeToolNames } from './broker.mjs';

const codeHash=value=>hash(String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,''));
export function createSessions(config,store) {
  const cookieOptions={httpOnly:true,secure:new URL(config.baseUrl).protocol==='https:',sameSite:'strict',path:'/'};
  const sameOrigin=req=>req.get('origin')===new URL(config.baseUrl).origin && req.get('sec-fetch-site')!=='cross-site';
  const json=(res,status,error)=>res.status(status).json({error});
  function session(req) {
    const token=cookieValue(req,'bridge_session');
    return token&&store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash(token),Date.now());
  }
  function requireSession(req,res,next) {
    const s=session(req);
    if(!s || !store.accountById(s.owner))return json(res,401,'请先登录');
    req.session=s;
    if(!['GET','HEAD'].includes(req.method) && (!sameOrigin(req)||req.get('x-csrf-token')!==s.csrf))return json(res,403,'页面验证失败，请刷新后重试');
    res.set('Cache-Control','no-store'); next();
  }
  function newSession(res,owner) {
    const token=opaque(),csrf=opaque();
    store.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),owner,csrf,Date.now()+7*86400000);
    res.cookie('bridge_session',token,{...cookieOptions,sameSite:'lax',maxAge:7*86400000});
    return {account:store.accountById(owner),csrf};
  }
  function loginCsrf(req,res,next) {
    if(!sameOrigin(req)||req.get('x-csrf-token')!==cookieValue(req,'bridge_login')||!cookieValue(req,'bridge_login'))return json(res,403,'请刷新登录页面');
    next();
  }
  return {session,requireSession,newSession,loginCsrf,cookieOptions};
}

export function installManagement(app,config,store,broker,loginLimiter,sessions=createSessions(config,store)) {
  const {session,requireSession,newSession,loginCsrf,cookieOptions}=sessions;
  const json=(res,status,error)=>res.status(status).json({error});
  app.get('/api/session',(req,res)=>{
    res.set('Cache-Control','no-store');
    const s=session(req);
    if(s&&store.accountById(s.owner))return res.json({account:store.accountById(s.owner),csrf:s.csrf});
    const csrf=opaque();res.cookie('bridge_login',csrf,{...cookieOptions,maxAge:600000});res.json({account:null,csrf});
  });
  app.post('/api/login',loginLimiter,loginCsrf,async(req,res)=>{
    const a=store.account(String(req.body.username??''));
    const valid=await checkPassword(req.body.password,a?.password??config.ownerPasswordHash);
    const current=a&&store.account(a.username);
    if(!a||!valid||current?.id!==a.id||current.password!==a.password)return json(res,401,'账号或密码错误');
    const old=cookieValue(req,'bridge_session');if(old)store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(old));
    res.clearCookie('bridge_login',cookieOptions);res.json(newSession(res,a.id));
  });
  app.get('/api/registration',(_req,res)=>res.set('Cache-Control','no-store').json({enabled:store.registrationEnabled()}));
  app.post('/api/signup',loginLimiter,loginCsrf,async(req,res)=>{
    if(!store.registrationEnabled())return json(res,403,'注册已关闭');
    const {username,password,invitation}=req.body;
    if(typeof username!=='string'||!/^\p{L}[\p{L}\p{N}_.-]{2,47}$/u.test(username)||typeof password!=='string'||password.length<12||password.length>256)return json(res,400,'账号需为 3–48 位；密码至少 12 位');
    const passwordEncoded=await passwordHash(password);
    try {
      const id=store.transaction(()=>{
        if(!store.registrationEnabled())throw new Error('注册已关闭');
        const invite=store.db.prepare('SELECT hash FROM invitations WHERE hash=? AND expires>?').get(hash(String(invitation??'')),Date.now());
        if(!invite)throw new Error('邀请已失效');
        if(store.account(username))throw new Error('账号已存在');
        const id=randomUUID();store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(id,username,passwordEncoded,0,Date.now());
        store.db.prepare('DELETE FROM invitations WHERE hash=?').run(invite.hash);return id;
      });
      const old=cookieValue(req,'bridge_session');if(old)store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(old));
      res.clearCookie('bridge_login',cookieOptions);
      res.status(201).json(newSession(res,id));
    } catch(e){json(res,400,e.message);}
  });
  app.post('/api/logout',requireSession,(req,res)=>{store.db.prepare('DELETE FROM sessions WHERE hash=?').run(req.session.hash);res.clearCookie('bridge_session',cookieOptions);res.json({ok:true});});
  app.post('/api/invitations',requireSession,(req,res)=>{
    if(!store.accountById(req.session.owner).admin)return json(res,403,'仅管理员可邀请用户');
    if(!store.registrationEnabled())return json(res,409,'注册已关闭');
    const token=opaque();store.db.prepare('INSERT INTO invitations VALUES (?,?)').run(hash(token),Date.now()+86400000);
    res.json({url:new URL('/?invite='+token,config.baseUrl).href,expiresIn:86400});
  });
  app.post('/api/password',requireSession,loginLimiter,async(req,res)=>{
    const a=store.db.prepare('SELECT * FROM accounts WHERE id=?').get(req.session.owner);
    if(!await checkPassword(req.body.currentPassword,a.password))return json(res,403,'当前密码错误');
    if(typeof req.body.password!=='string'||req.body.password.length<12||req.body.password.length>256)return json(res,400,'新密码至少 12 位');
    const encoded=await passwordHash(req.body.password);
    const changed=store.transaction(()=>{
      const current=store.account(a.username);
      if(current?.id!==a.id || current.password!==a.password || !session(req))return false;
      store.db.prepare('UPDATE accounts SET password=? WHERE id=?').run(encoded,a.id);
      store.db.prepare('DELETE FROM sessions WHERE owner=? AND hash<>?').run(a.id,req.session.hash);
      store.db.prepare("DELETE FROM grants WHERE json_extract(value,'$.ownerId')=? AND kind IN ('access','refresh','code')").run(a.id);
      return true;
    });
    if(!changed)return json(res,403,'会话或密码已变更，请重新登录');
    res.json({ok:true});
  });
  // A revoked device cannot authenticate with its erased old token hash.
  // Report only the revoked bit for a high-entropy device ID, never device owner
  // details or a replacement credential. Rate-limited for reconnect diagnostics.
  app.post('/api/agent/revocation-status',rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-8',legacyHeaders:false}),(req,res)=>{
    const id=req.body?.deviceId;
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))return json(res,400,'Invalid device ID');
    const record=store.db.prepare('SELECT revoked FROM registry WHERE id=?').get(id);
    res.set('Cache-Control','no-store').json({revoked:record?.revoked===1});
  });
  app.get('/api/manage/devices',requireSession,(req,res)=>{
    const devices=broker.devices(req.session.owner);
    // "toolsAvailable" is a per-device readiness boolean, not a tool count.
    // Include actual MCP catalog size, counting executable tools only when
    // at least one owned device is healthy enough to run remote calls.
    const readyDevices=devices.filter(d=>d.toolsAvailable).length;
    const toolCount=readyDevices>0?bridgeToolNames.size+broker.tools(req.session.owner).length:0;
    res.json({devices,readyDevices,toolCount});
  });
  app.get('/api/manage/revoked-devices',requireSession,(req,res)=>{
    const devices=store.db.prepare(
      'SELECT id,name,platform,revokedAt FROM registry WHERE owner=? AND revoked=1 ORDER BY revokedAt DESC LIMIT 50'
    ).all(req.session.owner);
    res.json({devices});
  });
  app.post('/api/manage/devices/:id/:action',requireSession,async(req,res)=>{
    const d=store.device(req.params.id);
    if(!d||d.owner!==req.session.owner)return json(res,404,'设备不存在');
    switch(req.params.action) {
      case 'rename': {
        const name=String(req.body.name??'').trim();if(!name||name.length>100)return json(res,400,'名称需为 1–100 字');
        store.db.prepare('UPDATE registry SET name=? WHERE id=?').run(name,d.id);break;
      }
      case 'pause':store.db.prepare('UPDATE registry SET paused=1 WHERE id=?').run(d.id);broker.disconnect(d.id,'Device paused');break;
      case 'resume':store.db.prepare('UPDATE registry SET paused=0 WHERE id=?').run(d.id);break;
      case 'unlink':
        // Invalidate first. An old credential must cease authorizing remote calls
        // even if notifying the local Agent fails or the device is offline.
        store.db.prepare('UPDATE registry SET revoked=1,tokenHash=NULL,pendingHash=NULL,revokedAt=? WHERE id=?').run(Date.now(),d.id);
        broker.revoke(d.id);
        break;
      case 'rotate': {
        const conn=broker.connections.get(d.id);
        if(!conn?.ready||conn.protocol<2||conn.ws.readyState!==1)return json(res,409,'请先连接新版客户端；离线设备可解绑后重新配对');
        if(d.pendingHash)return json(res,409,'上次密钥轮换尚未确认，请等待设备重连');
        const token=opaque();store.db.prepare('UPDATE registry SET pendingHash=? WHERE id=?').run(hash(token),d.id);
        try {
          await new Promise((resolve,reject)=>conn.ws.send(JSON.stringify({type:'rotate',token}),error=>error?reject(error):resolve()));
        } catch {
          store.db.prepare('UPDATE registry SET pendingHash=NULL WHERE id=? AND pendingHash=?').run(d.id,hash(token));
          return json(res,503,'设备连接已断开，请重试');
        }
        break;
      }
      default:return json(res,404,'未知操作');
    }
    res.json({ok:true});
  });
  app.get('/api/manage/calls',requireSession,(req,res)=>res.json({calls:store.recentCalls(req.session.owner)}));
  app.get('/api/manage/calls/:id',requireSession,(req,res)=>{
    const call=broker.recover(req.params.id,req.session.owner);if(!call)return json(res,404,'任务不存在');res.json(call);
  });
  app.get('/api/manage/authorizations',requireSession,(req,res)=>{
    const grants=store.db.prepare("SELECT client,value,expires FROM grants WHERE kind IN ('access','refresh') AND json_extract(value,'$.ownerId')=? AND expires>? ORDER BY expires DESC").all(req.session.owner,Date.now());
    const families=new Map();
    for(const g of grants){const v=JSON.parse(g.value);if(!families.has(v.family))families.set(v.family,{id:v.family,clientId:g.client,name:store.getClient(g.client)?.client_name??'MCP Client',expires:g.expires});}
    res.json({authorizations:[...families.values()]});
  });
  app.post('/api/manage/authorizations/:id/revoke',requireSession,(req,res)=>{
    store.db.prepare("DELETE FROM grants WHERE json_extract(value,'$.ownerId')=? AND json_extract(value,'$.family')=?").run(req.session.owner,req.params.id);res.json({ok:true});
  });
  const pairingLimiter=rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
  app.post('/api/pair/start',pairingLimiter,(req,res)=>{
    if(store.db.prepare('SELECT count(*) AS n FROM pairings WHERE expires>?').get(Date.now()).n>=1000)return json(res,429,'配对繁忙，请稍后重试');
    const secret=opaque(),device=randomUUID();
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code='';for(let i=0;i<8;i++)code+=alphabet[randomInt(alphabet.length)];
    store.db.prepare('INSERT INTO pairings VALUES (?,?,?,?,?,?,?,?,?)').run(hash(secret),codeHash(code),device,String(req.body.name??'新电脑').slice(0,100),String(req.body.platform??'unknown').slice(0,60),String(req.body.version??'unknown').slice(0,40),null,'pending',Date.now()+600000);
    res.set('Cache-Control','no-store').json({deviceCode:secret,userCode:code.slice(0,4)+'-'+code.slice(4),verificationUri:new URL('/?pair='+code,config.baseUrl).href,expiresIn:600,interval:5});
  });
  app.post('/api/pair/poll',rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-8',legacyHeaders:false}),(req,res)=>{
    res.set('Cache-Control','no-store');
    const p=store.db.prepare('SELECT * FROM pairings WHERE hash=? AND expires>?').get(hash(String(req.body.deviceCode??'')),Date.now());
    if(!p||p.status==='claimed')return json(res,410,'配对已过期或已领取');
    if(p.status==='pending')return res.status(202).json({status:'pending'});
    if(p.status==='denied')return json(res,403,'配对已拒绝');
    if(p.status!=='approved'||!store.accountById(p.owner))return json(res,410,'配对已失效');
    const token=opaque();
    const claimed=store.transaction(()=>{
      const current=store.db.prepare("SELECT * FROM pairings WHERE hash=? AND expires>? AND status='approved'").get(p.hash,Date.now());
      const d=current&&store.device(current.device);
      if(!current||!d||d.owner!==current.owner||!store.accountById(current.owner))return false;
      store.db.prepare('UPDATE registry SET tokenHash=? WHERE id=?').run(hash(token),p.device);
      store.db.prepare("UPDATE pairings SET status='claimed' WHERE hash=?").run(p.hash);
      return true;
    });
    if(!claimed)return json(res,410,'配对设备已解绑，请重新配对');
    res.json({deviceId:p.device,deviceToken:token});
  });
  app.get('/api/manage/pair',requireSession,(req,res)=>{
    const p=store.db.prepare("SELECT name,platform,version,status FROM pairings WHERE userHash=? AND expires>? AND status='pending'").get(codeHash(req.query.code),Date.now());
    if(!p)return json(res,404,'配对码已过期或不存在');res.json(p);
  });
  app.post('/api/manage/pair',requireSession,loginLimiter,(req,res)=>{
    if(!['approve','deny'].includes(req.body.decision))return json(res,400,'无效的配对操作');
    const outcome=store.transaction(()=>{
      const p=store.db.prepare("SELECT * FROM pairings WHERE userHash=? AND expires>? AND status='pending'").get(codeHash(req.body.code),Date.now());
      if(!p)return {status:404,error:'配对码已过期或已使用'};
      if(req.body.decision==='deny'){store.db.prepare("UPDATE pairings SET status='denied' WHERE hash=?").run(p.hash);return;}
      const limit=store.deviceLimit(req.session.owner);
      if(store.devices(req.session.owner).length>=limit)return {status:409,error:'设备绑定已达到此账号的上限（'+limit+' 台）'};
      store.db.prepare('INSERT INTO registry(id,owner,name,version,platform) VALUES (?,?,?,?,?)').run(p.device,req.session.owner,p.name,p.version,p.platform);
      store.db.prepare("UPDATE pairings SET status='approved',owner=? WHERE hash=?").run(req.session.owner,p.hash);
    });
    if(outcome)return json(res,outcome.status,outcome.error);
    res.json({ok:true});
  });
  return {requireSession};
}

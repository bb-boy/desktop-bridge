import { randomUUID, createHash } from 'node:crypto';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { opaque, hash, cookieValue } from './security.mjs';

// These URLs are deliberately not configurable. Tests inject transport, never claims or keys.
const ISSUER='https://accounts.google.com';
const AUTHORIZE='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const KEYS='https://www.googleapis.com/oauth2/v3/certs';
const FLOW_TTL=10*60*1000;
const FLOW_KIND='google-login';

export const googleEnabled=config=>typeof config.google?.clientId==='string' && config.google.clientId.trim().length>0 && typeof config.google?.clientSecret==='string' && config.google.clientSecret.trim().length>0;

export function installGoogle(app,config,store,sessions,loginLimiter,dependencies={}) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS google_identities(
    issuer TEXT NOT NULL,subject TEXT NOT NULL,owner TEXT NOT NULL UNIQUE,email TEXT NOT NULL,created INTEGER NOT NULL,
    PRIMARY KEY(issuer,subject)
  )`);
  const enabled=googleEnabled(config);
  const transport=dependencies.fetch??globalThis.fetch;
  const keys=enabled?createRemoteJWKSet(new URL(KEYS),{[customFetch]:transport,timeoutDuration:5000,cacheMaxAge:600000}):null;
  const callbackUri=()=>new URL('/auth/google/callback',config.baseUrl).href;
  const flowCookie=state=>'bridge_google_'+hash(state).slice(0,16);
  const cookieOptions={httpOnly:true,secure:new URL(config.baseUrl).protocol==='https:',sameSite:'lax',path:'/auth/google',maxAge:FLOW_TTL};
  const json=(res,status,error)=>res.status(status).json({error});
  const identity=owner=>store.db.prepare('SELECT issuer,subject,email FROM google_identities WHERE owner=?').get(owner);
  const hasPassword=owner=>/^[A-Za-z0-9_-]+:[0-9a-f]{128}$/.test(store.db.prepare('SELECT password FROM accounts WHERE id=?').get(owner)?.password??'');
  const activeSession=(sessionHash,owner)=>store.db.prepare('SELECT hash FROM sessions WHERE hash=? AND owner=? AND expires>?').get(sessionHash,owner,Date.now());
  function requireEnabled(_req,res,next){if(!enabled)return json(res,503,'google_disabled');next();}
  function requireLoginCsrf(req,res,next) {
    if(sessions.session(req))return sessions.requireSession(req,res,next);
    return sessions.loginCsrf(req,res,next);
  }
  function returnPath(value='/') {
    if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20\x7f]/.test(value))return null;
    const url=new URL(value,config.baseUrl);
    return url.origin===new URL(config.baseUrl).origin?url.pathname+url.search+url.hash:null;
  }
  function begin(mode,req,res) {
    const returnTo=returnPath(req.body?.returnTo);
    if(!returnTo)return json(res,400,'invalid_return_path');
    const state=opaque(),browser=opaque(),nonce=opaque(),verifier=opaque();
    const current=sessions.session(req);
    const expires=Date.now()+FLOW_TTL;
    const flow={
      browserHash:hash(browser),nonceHash:hash(nonce),verifier,mode,returnTo,expires,
      ownerId:current?.owner??null,sessionHash:current?.hash??null
    };
    store.saveGrant(hash(state),FLOW_KIND,config.google.clientId,flow,expires);
    res.cookie(flowCookie(state),browser,cookieOptions);
    const url=new URL(AUTHORIZE);
    url.search=new URLSearchParams({
      client_id:config.google.clientId,redirect_uri:callbackUri(),response_type:'code',
      scope:'openid email',state,nonce,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method:'S256',prompt:'select_account'
    }).toString();
    res.json({url:url.href});
  }
  app.use(['/auth/google','/api/auth/google','/api/manage/google'],(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.get('/api/auth/google',(_req,res)=>res.json({enabled}));
  app.post('/auth/google/start',requireEnabled,loginLimiter,requireLoginCsrf,(req,res)=>begin('login',req,res));
  app.post('/auth/google/link',requireEnabled,loginLimiter,sessions.requireSession,(req,res)=>{
    if(identity(req.session.owner))return json(res,409,'google_already_linked');
    begin('link',req,res);
  });
  app.get('/api/manage/google',sessions.requireSession,(req,res)=>{
    const linked=identity(req.session.owner)??null;
    const password=hasPassword(req.session.owner);
    res.json({enabled,linked:!!linked,identity:linked,hasPassword:password,canUnlink:!!linked&&password});
  });
  app.post('/api/manage/google/unlink',sessions.requireSession,(req,res)=>{
    const owner=req.session.owner;
    const result=store.transaction(()=>{
      if(!identity(owner))return {error:'google_not_linked',status:404};
      if(!hasPassword(owner))return {error:'last_login_method',status:409};
      store.db.prepare('DELETE FROM google_identities WHERE owner=?').run(owner);
      store.db.prepare('DELETE FROM sessions WHERE owner=?').run(owner);
      store.db.prepare("DELETE FROM grants WHERE json_extract(value,'$.ownerId')=? AND kind IN ('access','refresh','code','google-login')").run(owner);
      return sessions.newSession(res,owner);
    });
    if(result.error)return json(res,result.status,result.error);
    res.json({ok:true,...result});
  });
  app.get('/auth/google/callback',requireEnabled,async(req,res)=>{
    const state=req.query.state;
    if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))return json(res,403,'invalid_google_state');
    const browser=cookieValue(req,flowCookie(state));
    const flow=store.transaction(()=>{
      const found=store.grant(hash(state),FLOW_KIND);
      if(!browser||!found||found.browserHash!==hash(browser))return null;
      store.deleteGrant(hash(state));
      return found;
    });
    if(!flow)return json(res,403,'invalid_google_state');
    res.clearCookie(flowCookie(state),{...cookieOptions,maxAge:undefined});
    if(req.query.error)return json(res,400,'google_login_cancelled');
    const code=req.query.code;
    if(typeof code!=='string'||!code||code.length>4096)return json(res,400,'invalid_google_code');
    try {
      const response=await transport(TOKEN,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
        headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({
          grant_type:'authorization_code',client_id:config.google.clientId,
          client_secret:config.google.clientSecret,code,redirect_uri:callbackUri(),code_verifier:flow.verifier
        })
      });
      if(!response.ok)throw new Error('Token exchange failed');
      const tokens=await response.json();
      if(typeof tokens.id_token!=='string'||tokens.id_token.length>32768)throw new Error('Missing ID token');
      const {payload}=await jwtVerify(tokens.id_token,keys,{
        algorithms:['RS256'],issuer:[ISSUER,'accounts.google.com'],audience:config.google.clientId,
        requiredClaims:['sub','exp','iat','nonce','email','email_verified'],maxTokenAge:'1h',clockTolerance:5
      });
      if(
        typeof payload.sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(payload.sub)||
        typeof payload.nonce!=='string'||hash(payload.nonce)!==flow.nonceHash||
        !['true',true].includes(payload.email_verified)||
        typeof payload.email!=='string'||payload.email.length>320||!payload.email.includes('@')||
        (payload.azp!==undefined&&payload.azp!==config.google.clientId)||
        (Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==config.google.clientId)
      )throw new Error('Invalid identity claims');
      const result=store.transaction(()=>{
        if(flow.expires<=Date.now())return {status:403,error:'google_flow_expired'};
        const linked=store.db.prepare('SELECT owner FROM google_identities WHERE issuer=? AND subject=?').get(ISSUER,payload.sub);
        let owner=linked?.owner;
        if(flow.mode==='link') {
          if(!activeSession(flow.sessionHash,flow.ownerId)||!store.accountById(flow.ownerId))return {status:403,error:'link_session_expired'};
          if((linked&&linked.owner!==flow.ownerId)||identity(flow.ownerId))return {status:409,error:'google_already_linked'};
          owner=flow.ownerId;
        } else if(flow.mode!=='login')return {status:403,error:'invalid_google_flow'};
        if(owner&&!store.accountById(owner))return {status:403,error:'google_account_missing'};
        if(!owner) {
          if(!store.registrationEnabled())return {status:403,error:'registration_disabled'};
          owner=randomUUID();
          // No usable local password; the subject, never the email, determines identity.
          store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(owner,'google_'+randomUUID(),'',0,Date.now());
        }
        if(!linked)store.db.prepare('INSERT INTO google_identities VALUES (?,?,?,?,?)').run(ISSUER,payload.sub,owner,payload.email,Date.now());
        else store.db.prepare('UPDATE google_identities SET email=? WHERE issuer=? AND subject=?').run(payload.email,ISSUER,payload.sub);
        if(flow.sessionHash)store.db.prepare('DELETE FROM sessions WHERE hash=?').run(flow.sessionHash);
        const previous=cookieValue(req,'bridge_session');
        if(previous)store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(previous));
        sessions.newSession(res,owner);
        return {owner};
      });
      if(result.error)return json(res,result.status,result.error);
      res.redirect(303,flow.returnTo);
    } catch {
      // Neither upstream responses nor JWTs contain information safe to echo or log.
      json(res,403,'google_verification_failed');
    }
  });
}

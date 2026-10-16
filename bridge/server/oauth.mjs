import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidTargetError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { opaque, hash, checkPassword, cookieValue, escapeHtml } from './security.mjs';
import { googleEnabled } from './google.mjs';

export function installOAuth(app, config, store, loginLimiter, sessions) {
  const loggedPaths=new Set(['/authorize','/oauth/consent','/oauth/approve','/token','/register']);
  app.use((req,res,next)=>{
    if(!loggedPaths.has(req.path)) return next();
    const requestPath=req.path;
    let oauthError;
    const originalJson=res.json;
    res.json=function(body){
      if(typeof body?.error==='string') oauthError=body.error;
      return originalJson.call(this,body);
    };
    res.on('finish',()=>console.log(JSON.stringify({event:'oauth_request',path:requestPath,method:req.method,status:res.statusCode,...(oauthError?{error:oauthError}:{})})));
    next();
  });
  const resource=new URL('/mcp',config.baseUrl).href;
  const normalize=s=>String(s).replace(/\/$/,'');
  const validateResource=value=>{
    if (value && normalize(value)!==normalize(resource)) throw new InvalidTargetError('Wrong resource');
  };
  function issue(client, ownerId, family=opaque()) {
    if (!store.accountById(ownerId)) throw new InvalidGrantError('Account no longer exists');
    const access=opaque(), refresh=opaque();
    const value={clientId:client,ownerId,family,resource,scopes:['desktop']};
    store.saveGrant(hash(access),'access',client,value,Date.now()+3600000);
    store.saveGrant(hash(refresh),'refresh',client,value,Date.now()+180*86400000);
    return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'desktop'};
  }
  const provider={
    clientsStore:{
      getClient:id=>store.getClient(id),
      registerClient(client) {
        if (store.clientCount()>=500) throw new InvalidClientMetadataError('Registration capacity reached');
        if (!client.redirect_uris?.length || client.redirect_uris.length>10) throw new InvalidClientMetadataError('Redirect URIs required');
        for (const value of client.redirect_uris) {
          let u;
          try {u=new URL(value);} catch {throw new InvalidClientMetadataError('Invalid redirect URI');}
          if (u.hash || u.username || u.password || (u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) {
            throw new InvalidClientMetadataError('Use an HTTPS or localhost redirect URI');
          }
        }
        const full={...client, client_id:opaque(),client_id_issued_at:Math.floor(Date.now()/1000)};
        store.putClient(full);
        return full;
      }
    },
    async authorize(client,params,res) {
      validateResource(params.resource);
      if ((params.scopes??[]).some(s=>s!=='desktop')) throw new InvalidScopeError('Unknown scope');
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidGrantError('S256 challenge required');
      const request=opaque(),csrf=opaque();
      const csrfCookie='bridge_csrf_'+hash(request).slice(0,16);
      store.saveGrant(hash(request),'consent',client.client_id,{
        clientId:client.client_id,clientName:String(client.client_name??'MCP Client').slice(0,120),
        redirectUri:params.redirectUri,state:params.state,challenge:params.codeChallenge,resource,csrf,csrfCookie
      },Date.now()+600000);
      res.cookie(csrfCookie,csrf,{httpOnly:true,secure:new URL(config.baseUrl).protocol==='https:',sameSite:'lax',maxAge:600000,path:'/oauth'});
      res.redirect(302,'/oauth/consent?request='+encodeURIComponent(request));
    },
    async challengeForAuthorizationCode(client,code) {
      const grant=store.grant(hash(code),'code');
      if (!grant || grant.clientId!==client.client_id) throw new InvalidGrantError('Code expired or already used');
      return grant.challenge;
    },
    async exchangeAuthorizationCode(client,code,_verifier,redirectUri,requestedResource) {
      validateResource(requestedResource);
      return store.transaction(()=>{
        const grant=store.grant(hash(code),'code');
        if (!grant || grant.clientId!==client.client_id || redirectUri!==grant.redirectUri) throw new InvalidGrantError('Invalid code or redirect URI');
        store.deleteGrant(hash(code));
        return issue(client.client_id,grant.ownerId);
      });
    },
    async exchangeRefreshToken(client,refresh,scopes,requestedResource) {
      validateResource(requestedResource);
      if (scopes?.some(s=>s!=='desktop')) throw new InvalidScopeError('Unknown scope');
      return store.transaction(()=>{
        const grant=store.grant(hash(refresh),'refresh');
        if (!grant || grant.clientId!==client.client_id) throw new InvalidGrantError('Refresh token expired or revoked');
        store.deleteGrant(hash(refresh));
        return issue(client.client_id,grant.ownerId,grant.family);
      });
    },
    async verifyAccessToken(token) {
      const grant=store.grant(hash(token),'access');
      if (!grant || !store.accountById(grant.ownerId)) throw new InvalidTokenError('Access token expired or revoked');
      const row=store.db.prepare('SELECT expires FROM grants WHERE hash=?').get(hash(token));
      return {token,clientId:grant.clientId,scopes:grant.scopes,expiresAt:Math.floor(row.expires/1000),resource:new URL(resource),extra:{ownerId:grant.ownerId}};
    },
    async revokeToken(client,{token}) {
      const grant=store.grant(hash(token),'access') ?? store.grant(hash(token),'refresh');
      if (grant?.clientId===client.client_id) store.db.prepare("DELETE FROM grants WHERE client=? AND json_extract(value,'$.ownerId')=? AND json_extract(value,'$.family')=?").run(client.client_id,grant.ownerId,grant.family);
    }
  };
  app.use(mcpAuthRouter({provider,issuerUrl:new URL(config.baseUrl),resourceServerUrl:new URL(resource),scopesSupported:['desktop'],resourceName:'Personal Desktop Bridge'}));
  // Some clients discover the root metadata URL before following the challenge.
  app.get('/.well-known/oauth-protected-resource',(_req,res)=>res.json({resource,authorization_servers:[new URL(config.baseUrl).href],scopes_supported:['desktop']}));

  function consentPage(req,res,error='') {
    const request=String(req.query.request??req.body?.request??'');
    const grant=store.grant(hash(request),'consent');
    if (!grant || grant.csrf!==cookieValue(req,grant.csrfCookie??'bridge_csrf')) return res.status(400).type('html').send('<p>授权页面已过期或不属于当前浏览器。请返回 ChatGPT，重新点击连接。</p>');
    res.set('Cache-Control','no-store');
    // Preserve the same-origin POST Origin while suppressing cross-origin referrers.
    res.set('Referrer-Policy','same-origin');
    res.set('Content-Security-Policy',`default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' ${new URL(grant.redirectUri).origin}`);
    const active=sessions?.session(req);
    const account=active&&store.accountById(active.owner);
    const credentials=account?`<p>当前账号：<strong>${escapeHtml(account.username)}</strong></p><input type="hidden" name="authMode" value="session"><input type="hidden" name="ownerId" value="${escapeHtml(account.id)}"><input type="hidden" name="sessionCsrf" value="${escapeHtml(active.csrf)}">`:`<label>账号<input name="username" maxlength="48" value="owner" required autocomplete="username"></label><label>账号密码<input name="password" type="password" maxlength="256" required autocomplete="current-password" autofocus></label>`;
    const google=!account&&googleEnabled(config)?'<button id="google-consent-login" type="button">使用 Google 登录</button><script defer src="/oauth-google.js"></script>':'';
    res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>连接你的电脑</title><link rel="stylesheet" href="/style.css"><main class="card"><p class="eyebrow">DESKTOP BRIDGE</p><h1>连接你的电脑</h1><p>正在为 <strong>${escapeHtml(grant.clientName)}</strong> 授权。</p><p>授权后，此客户端可调用已绑定电脑上的文件和终端工具。只会连接你当前账号绑定的设备。可在设备管理页撤销授权。</p><p class="error">${escapeHtml(error)}</p><form method="post" action="/oauth/approve"><input type="hidden" name="request" value="${escapeHtml(request)}"><input type="hidden" name="csrf" value="${escapeHtml(grant.csrf)}">${credentials}<button name="decision" value="approve">授权连接</button><button class="secondary" name="decision" value="deny" formnovalidate>取消</button></form>${google}</main></html>`);
  }
  app.get('/oauth/consent',(req,res)=>consentPage(req,res));
  app.post('/oauth/approve',loginLimiter,async(req,res)=>{
    const request=String(req.body?.request??'');
    const grant=store.grant(hash(request),'consent');
    const origin=req.get('origin');
    const foreignOrigin=(origin && origin!=='null' && origin!==new URL(config.baseUrl).origin) || req.get('sec-fetch-site')==='cross-site';
    // Browsers can send a null Origin for form navigations under no-referrer.
    // The unpredictable form token must still match the HttpOnly browser cookie.
    const validCsrf=grant && grant.csrf===req.body?.csrf && grant.csrf===cookieValue(req,grant.csrfCookie??'bridge_csrf');
    if (!grant || foreignOrigin || !validCsrf) {
      console.warn(JSON.stringify({event:'authorization_rejected',reason:!grant?'expired_request':foreignOrigin?'foreign_origin':'csrf_mismatch'}));
      return res.status(403).type('html').send('<p>本次授权页面已失效或浏览器校验未通过。请返回 ChatGPT，重新点击连接，使用新打开的页面授权。</p>');
    }
    const redirect=new URL(grant.redirectUri);
    if (grant.state) redirect.searchParams.set('state',grant.state);
    if (req.body.decision==='deny') {
      store.deleteGrant(hash(request));
      redirect.searchParams.set('error','access_denied');
      return res.redirect(303,redirect.href);
    }
    if (req.body.decision!=='approve') return res.status(400).type('html').send('<p>无效的授权操作。</p>');
    const browserSession=req.body.authMode==='session'?sessions?.session(req):null;
    let account;
    if(req.body.authMode==='session') {
      if(!browserSession||browserSession.csrf!==req.body.sessionCsrf||browserSession.owner!==req.body.ownerId)return res.status(403).type('html').send('<p>登录状态已变更，请刷新后重新授权。</p>');
      account=store.db.prepare('SELECT * FROM accounts WHERE id=?').get(browserSession.owner);
      if(!account)return res.status(403).type('html').send('<p>请重新登录。</p>');
    } else {
      account=store.account(String(req.body.username??'owner'));
      const valid=await checkPassword(req.body.password,account?.password??config.ownerPasswordHash);
      if (!account || !valid) return consentPage(req,res,'账号或密码不正确，请重试。');
    }
    const code=opaque();
    const issued=store.transaction(()=>{
      // Password verification yields to other requests; consume only a still-live request.
      const current=store.grant(hash(request),'consent');
      const currentAccount=store.account(account.username);
      const active=browserSession&&sessions.session(req);
      const authenticated=browserSession?active?.hash===browserSession.hash&&active.csrf===req.body.sessionCsrf:currentAccount?.password===account.password;
      if (!current || current.csrf!==grant.csrf || currentAccount?.id!==account.id || !authenticated) return false;
      store.deleteGrant(hash(request));
      store.saveGrant(hash(code),'code',grant.clientId,{...grant,ownerId:account.id},Date.now()+60000);
      return true;
    });
    if (!issued) return res.status(403).type('html').send('<p>本次授权已过期或已使用，请重新连接。</p>');
    redirect.searchParams.set('code',code);
    res.clearCookie(grant.csrfCookie??'bridge_csrf',{path:'/oauth'});
    res.redirect(303,redirect.href);
  });
  return provider;
}

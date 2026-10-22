'use strict';
const $=s=>document.querySelector(s),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let csrf,account,refreshing=false,googleEnabled=false,registrationEnabled=true;
const query=new URLSearchParams(location.search),invitation=query.get('invite');
const healthLabels={ready:'工具可用',offline:'离线',paused:'已暂停',unverified:'网络已连接 · 待检查',local_unavailable:'网络已连接 · 工具异常'};
const statusLabels={executing:'执行中',awaiting_result:'等待设备补交',unknown:'结果未知',completed:'已完成',failed:'执行失败'};
const time=value=>value?new Date(value).toLocaleString():'尚未连接';
function message(text){$('#message').textContent=text;}
async function api(url,data) {
  const r=await fetch(url,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json','x-csrf-token':csrf??''},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await r.json().catch(()=>({error:'服务暂时不可用'}));
  if(!r.ok){if(r.status===401&&account){account=null;await boot();}throw new Error(result.error??'操作失败');}return result;
}
async function action(fn){try{message('');await fn();}catch(e){message(e.message);}}
function button(text,fn,cls='secondary'){const b=el('button',text,cls);b.type='button';b.classList.add('nes-btn');if(cls==='danger')b.classList.add('is-error');if(cls==='success')b.classList.add('is-success');b.onclick=()=>action(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}});return b;}
function empty(parent,text){parent.replaceChildren(el('p',text,'empty'));}
async function boot(){const [s,g,r]=await Promise.all([api('/api/session'),api('/api/auth/google').catch(()=>({enabled:false})),api('/api/registration')]);csrf=s.csrf;account=s.account;googleEnabled=g.enabled===true;registrationEnabled=r.enabled===true;const googleButton=$('#google-login');googleButton.hidden=false;googleButton.disabled=!googleEnabled;googleButton.querySelector('.google-text').textContent='使用 Google 登录';const googleAvailability=$('#google-availability');googleAvailability.hidden=googleEnabled;if(googleEnabled)googleButton.removeAttribute('aria-describedby');else googleButton.setAttribute('aria-describedby','google-availability');$('#login-panel').hidden=!!account;$('#app-panel').hidden=!account;$('#account-menu').hidden=!account;$('#admin-entry').hidden=!account?.admin;if(!account&&$('#account-dialog').open)$('#account-dialog').close();if(!account&&$('#admin-dialog').open)$('#admin-dialog').close();setAccountProfile();closeAccountMenu();$('#invite-panel').hidden=!account?.admin;if(account){history.replaceState(null,'',query.has('pair')?'/?pair='+encodeURIComponent(query.get('pair')):'/');await refresh();if(query.has('pair')){$('#pair-code').value=query.get('pair');await previewPair();}}else{$('#signup-unavailable').hidden=!(invitation&&!registrationEnabled);$('#login-form').hidden=false;$('#signup-form').hidden=true;$('#toggle-login').hidden=true;if(invitation&&registrationEnabled){$('#login-form').hidden=true;$('#signup-form').hidden=false;$('#toggle-login').hidden=false;}}}
$('#toggle-login').onclick=()=>{$('#login-form').hidden=!$('#login-form').hidden;$('#signup-form').hidden=!$('#signup-form').hidden;};
$('#login-form').onsubmit=e=>{e.preventDefault();action(async()=>{const s=await api('/api/login',Object.fromEntries(new FormData(e.target)));csrf=s.csrf;account=s.account;e.target.reset();await boot();});};
$('#signup-form').onsubmit=e=>{e.preventDefault();action(async()=>{const s=await api('/api/signup',{...Object.fromEntries(new FormData(e.target)),invitation});csrf=s.csrf;account=s.account;e.target.reset();await boot();});};
function setAccountProfile(google=null){
 const linked=google?.linked===true;
 const email=linked&&typeof google.identity?.email==='string'&&google.identity.email.trim()
  ?google.identity.email.trim():null;
 const shown=email??account?.username??'';
 const label=Array.from(shown.split('@')[0]).slice(0,2).join('').toUpperCase()||'--';
 $('#account-initials').textContent=label;
 $('#account-email').textContent=shown;
 $('#account-provider').textContent=email?'Signed in with Google':'账号密码登录';
 $('#account-trigger').setAttribute('aria-label','账号：'+shown+'，查看账号信息');
}
function closeAccountMenu(restoreFocus=false){
 const trigger=$('#account-trigger');
 $('#account-popover').hidden=true;
 trigger.setAttribute('aria-expanded','false');
 if(restoreFocus&&account&&!$('#account-menu').hidden)trigger.focus();
}
$('#account-trigger').onclick=()=>{
 if(!account)return;
 const opening=$('#account-popover').hidden;
 if(opening){
  $('#account-popover').hidden=false;
  $('#account-trigger').setAttribute('aria-expanded','true');
 }else closeAccountMenu();
};
document.addEventListener('pointerdown',event=>{
 if(!$('#account-menu').contains(event.target))closeAccountMenu();
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!$('#account-popover').hidden)closeAccountMenu(true);
});

$('#logout').onclick=()=>action(async()=>{await api('/api/logout',{});account=null;await boot();});
$('#refresh').onclick=()=>action(refresh);
const tabs=[...document.querySelectorAll('[data-tab]')];
function selectTab(tab){
 for(const b of tabs){
  const active=b===tab;
  b.classList.toggle('active',active);
  b.setAttribute('aria-selected',String(active));
  b.tabIndex=active?0:-1;
  $('#'+b.dataset.tab+'-tab').hidden=!active;
 }
 action(refresh);
}
for(const tab of tabs){
 tab.onclick=()=>selectTab(tab);
 tab.onkeydown=e=>{
  const delta=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
  if(!delta&&e.key!=='Home'&&e.key!=='End')return;
  e.preventDefault();
  const index=e.key==='Home'?0:e.key==='End'?tabs.length-1:(tabs.indexOf(tab)+delta+tabs.length)%tabs.length;
  tabs[index].focus();selectTab(tabs[index]);
 };
}
for(const tab of tabs)tab.tabIndex=tab.classList.contains('active')?0:-1;
async function accountAction(fn){const feedback=$('#account-feedback');feedback.hidden=true;try{await fn();}catch(e){feedback.textContent=e.message;feedback.hidden=false;}}
$('#account-settings').onclick=()=>{
 if(!account)return;
 closeAccountMenu();
 const dialog=$('#account-dialog');
 $('#account-feedback').hidden=true;
 if(!dialog.open)dialog.showModal();
 if(googleEnabled)void accountAction(renderGoogle);
};
$('#close-account-dialog').onclick=()=>$('#account-dialog').close();

async function adminAction(fn){
 const feedback=$('#admin-feedback');feedback.hidden=true;
 try{await fn();}catch(error){feedback.textContent=error.message;feedback.hidden=false;}
}
async function renderAdmin(){
 const data=await api('/api/manage/admin');
 $('#registration-enabled').checked=data.registrationEnabled;
 $('#admin-user-count').textContent='('+data.users.length+')';
 const parent=$('#admin-users');parent.replaceChildren();
 if(!data.users.length){empty(parent,'暂无用户');return;}
 for(const user of data.users){
  const row=el('article',undefined,'row nes-container admin-user-row');
  const info=el('div',undefined,'grow');
  const display=user.email||user.username;
  info.append(el('strong',display));
  if(user.email)info.append(el('p','登录账号：'+user.username,'muted'));
  info.append(el('p','创建时间：'+time(user.created)+' · 设备：'+user.deviceCount+' / '+user.deviceLimit+(user.deviceCount>user.deviceLimit?' · 已超出上限':''),'muted'));
  const role=el('span',user.admin?'管理员':'用户','badge '+(user.admin?'ready':''));
  const controls=el('form',undefined,'admin-limit-controls');
  const limitLabel=el('label','设备上限');
  const limitInput=el('input',undefined,'nes-input');
  limitInput.type='number';limitInput.min='0';limitInput.max='1000';limitInput.step='1';limitInput.required=true;
  limitInput.value=String(user.deviceLimit);
  limitInput.setAttribute('aria-label',display+' 的设备上限');
  limitLabel.append(limitInput);
  const save=el('button','保存','nes-btn is-primary');save.type='submit';
  controls.append(limitLabel,save);
  controls.onsubmit=event=>{event.preventDefault();void adminAction(async()=>{
    const limit=Number(limitInput.value);
    if(!Number.isSafeInteger(limit)||limit<0||limit>1000)throw new Error('设备上限必须为 0–1000 的整数');
    save.disabled=true;
    try{await api('/api/manage/admin/users/'+encodeURIComponent(user.id)+'/device-limit',{limit});await renderAdmin();}
    finally{save.disabled=false;}
  });};
  row.append(info,role,controls);
  if(!user.admin&&user.id!==account?.id)row.append(button('删除账户',()=>adminAction(async()=>{
   if(prompt('删除账户将撤销会话、授权及设备绑定且不可恢复。请输入“'+display+'”确认：')!==display)return;
   await api('/api/manage/admin/users/'+encodeURIComponent(user.id)+'/delete',{});
   await renderAdmin();
  }),'danger'));
  parent.append(row);
 }
}
$('#admin-entry').onclick=()=>{if(!account?.admin)return;closeAccountMenu();void adminAction(async()=>{
 await renderAdmin();
 const dialog=$('#admin-dialog');if(!dialog.open)dialog.showModal();
});};
$('#close-admin-dialog').onclick=()=>$('#admin-dialog').close();
$('#admin-refresh').onclick=()=>void adminAction(renderAdmin);
$('#registration-enabled').onchange=()=>void adminAction(async()=>{
 const control=$('#registration-enabled'),enabled=control.checked;control.disabled=true;
 try{await api('/api/manage/admin/registration',{enabled});registrationEnabled=enabled;await renderAdmin();}
 catch(error){control.checked=!enabled;throw error;}
 finally{control.disabled=false;}
});

async function refresh(){if(!account||refreshing)return;refreshing=true;try{const [d,c,a]=await Promise.all([api('/api/manage/devices'),api('/api/manage/calls'),api('/api/manage/authorizations')]);renderDevices(d.devices);renderCalls(c.calls);renderAuth(a.authorizations);if(googleEnabled)await renderGoogle();$('#stat-total').textContent=d.devices.length;$('#stat-ready').textContent=d.readyDevices;$('#stat-tools').textContent=d.toolCount;$('#stat-waiting').textContent=c.calls.filter(x=>['executing','awaiting_result'].includes(x.status)).length;}finally{refreshing=false;}}
function platformInfo(platform){
 const raw=String(platform??'').toLowerCase();
 const kind=/darwin|mac|osx/.test(raw)?'macos':/win/.test(raw)?'windows':/linux/.test(raw)?'linux':'generic';
 const name={windows:'Windows',macos:'macOS',linux:'Linux'}[kind]??String(platform??'未知');
 return {kind,name};
}
function osIcon(platform){
 const {kind,name}=platformInfo(platform);
 const label=name;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.classList.add('os-icon',kind);svg.setAttribute('viewBox','0 0 48 48');
 svg.setAttribute('aria-label',label);svg.setAttribute('role','img');
 const use=document.createElementNS('http://www.w3.org/2000/svg','use');
 use.setAttribute('href','#os-'+kind);svg.append(use);return svg;
}
function renderDevices(devices){
 const parent=$('#devices');
 if(!devices.length)return empty(parent,'暂无设备');
 parent.replaceChildren();
 for(const d of devices){
  const card=el('article',undefined,'device nes-container');
  const open=el('button',undefined,'device-open');
  open.type='button';
  open.title=d.name+' · '+(healthLabels[d.health]??d.health);
  open.setAttribute('aria-label','查看 '+d.name+' 的设备详情，'+(d.networkConnected?'在线':'离线'));
  const dot=el('span',undefined,'device-status-dot '+(d.networkConnected?'online':'offline'));
  dot.setAttribute('aria-hidden','true');
  open.append(osIcon(d.platform),el('span',d.name,'device-name'),dot);
  open.onclick=()=>showDeviceDetails(d);
  card.append(open);parent.append(card);
 }
}
function showDeviceDetails(d){
 const dialog=$('#device-dialog'),content=$('#device-detail-content');
 $('#device-detail-heading').textContent=d.name;
 const status=el('span',healthLabels[d.health]??d.health,'badge '+(d.toolsAvailable?'ready':d.networkConnected?'warn':''));
 const intro=el('div',undefined,'device-detail-top');
 intro.append(osIcon(d.platform),status);
 const dl=el('dl');
 for(const [k,v] of [['设备编号',d.id],['客户端版本',d.clientVersion??'未知'],['系统',platformInfo(d.platform).name],['最后在线',time(d.lastSeen)],['密钥轮换',d.rotationPending?'等待设备确认':'已同步']]){
  dl.append(el('dt',k),el('dd',v));
 }
 const actions=el('div',undefined,'actions');
 const run=async(operation)=>{
  await api('/api/manage/devices/'+encodeURIComponent(d.id)+'/'+operation,{});
  dialog.close();
  await refresh();
 };
 actions.append(
  button(d.paused?'恢复':'暂停',()=>run(d.paused?'resume':'pause')),
  button('轮换密钥',async()=>{
   if(confirm('轮换这台设备的连接密钥？设备会自动保存新密钥。'))await run('rotate');
  }),
  button('解绑',async()=>{
   if(confirm('解绑“'+d.name+'”？它需要重新配对才能连接，正在运行的操作可能继续执行。'))await run('unlink');
  },'danger')
 );
 content.replaceChildren(intro,dl,actions);
 if(!dialog.open)dialog.showModal();
}
function renderCalls(calls){const parent=$('#calls'),recent=[...calls].sort((a,b)=>b.started-a.started).slice(0,100);if(!recent.length)return empty(parent,'暂无任务');parent.replaceChildren();for(const c of recent){const row=el('article',undefined,'row nes-container'),info=el('div',undefined,'grow');info.append(el('strong',c.tool),el('p',c.id,'muted'),el('p',time(c.started),'muted'));row.append(info,el('span',statusLabels[c.status]??c.status,'badge '+(c.status==='completed'?'ready':'')),button('查看结果',async()=>{const r=await api('/api/manage/calls/'+encodeURIComponent(c.id));$('#result-content').textContent=JSON.stringify(r,null,2);$('#result-dialog').showModal();}));parent.append(row);}}
function renderAuth(items){const parent=$('#authorizations');if(!items.length)return empty(parent,'暂无授权');parent.replaceChildren();for(const a of items){const row=el('article',undefined,'row nes-container'),info=el('div',undefined,'grow');info.append(el('strong',a.name),el('p','授权有效至 '+time(a.expires),'muted'));row.append(info,button('撤销授权',async()=>{if(confirm('撤销该客户端的本次授权？')){await api('/api/manage/authorizations/'+encodeURIComponent(a.id)+'/revoke',{});await refresh();}},'danger'));parent.append(row);}}
async function previewPair(){const code=$('#pair-code').value,p=await api('/api/manage/pair?code='+encodeURIComponent(code)),preview=$('#pair-preview');preview.hidden=false;const detail=el('p',undefined,'pair-platform');detail.append(osIcon(p.platform),document.createTextNode(platformInfo(p.platform).name+' · 客户端 '+p.version));preview.replaceChildren(el('h3',p.name),detail);preview.append(button('确认绑定到 '+account.username,async()=>{await api('/api/manage/pair',{code,decision:'approve'});preview.replaceChildren(el('p','已绑定'));history.replaceState(null,'','/');query.delete('pair');$('#pair-code').value='';await refresh();},'success'),button('拒绝',async()=>{await api('/api/manage/pair',{code,decision:'deny'});preview.hidden=true;query.delete('pair');history.replaceState(null,'','/');},'secondary'));}
$('#pair-form').onsubmit=e=>{e.preventDefault();action(previewPair);};
$('#close-dialog').onclick=()=>$('#result-dialog').close();
$('#close-device-dialog').onclick=()=>$('#device-dialog').close();
$('#invite').onclick=()=>action(async()=>{const r=await api('/api/invitations',{}),link=el('a',r.url);link.href=r.url;$('#invite-link').replaceChildren(link);});
$('#password-form').onsubmit=e=>{e.preventDefault();void accountAction(async()=>{await api('/api/password',Object.fromEntries(new FormData(e.target)));e.target.reset();const feedback=$('#account-feedback');feedback.textContent='密码已更新。其他浏览器会话已退出，客户端授权需要重新关联。';feedback.hidden=false;await refresh();});};
setInterval(()=>{if(!document.hidden&&account)action(refresh);},10000);
action(boot);

async function googleStart(link=false){const r=await api(link?'/auth/google/link':'/auth/google/start',{returnTo:location.pathname+location.search});location.assign(r.url);}
$('#google-login').onclick=()=>action(()=>googleStart());
$('#google-link').onclick=()=>{void accountAction(()=>googleStart(true));};
$('#google-unlink').onclick=()=>{void accountAction(async()=>{if(confirm('解除 Google 绑定？今后只能使用已有账号密码登录；其他浏览器会话与客户端授权也会失效，但设备绑定不会被删除。')){const r=await api('/api/manage/google/unlink',{});if(r.csrf)csrf=r.csrf;await renderGoogle();const feedback=$('#account-feedback');feedback.textContent='Google 账号已解除绑定。请使用账号密码登录。';feedback.hidden=false;}});};
async function renderGoogle(){const g=await api('/api/manage/google');$('#google-panel').hidden=!g.enabled;$('#google-status').textContent=g.linked?'已绑定：'+(g.identity?.email??'Google 账号'):'未绑定';$('#google-link').hidden=!!g.linked;$('#google-unlink').hidden=!g.linked;$('#google-unlink').disabled=!g.canUnlink;$('#google-unlink-hint').hidden=!g.linked||g.canUnlink;setAccountProfile(g);}

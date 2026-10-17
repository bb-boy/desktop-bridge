'use strict';
const $=s=>document.querySelector(s),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let csrf,account,refreshing=false,googleEnabled=false;
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
function button(text,fn,cls='secondary'){const b=el('button',text,cls);b.type='button';b.onclick=()=>action(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}});return b;}
function empty(parent,text){parent.replaceChildren(el('p',text,'empty'));}
async function boot(){const [s,g]=await Promise.all([api('/api/session'),api('/api/auth/google').catch(()=>({enabled:false}))]);csrf=s.csrf;account=s.account;googleEnabled=g.enabled===true;$('#google-login').hidden=!googleEnabled;$('#login-panel').hidden=!!account;$('#app-panel').hidden=!account;$('#logout').hidden=!account;$('#account-name').textContent=account?.username??'';$('#invite-panel').hidden=!account?.admin;if(account){history.replaceState(null,'',query.has('pair')?'/?pair='+encodeURIComponent(query.get('pair')):'/');await refresh();if(query.has('pair')){$('#pair-code').value=query.get('pair');await previewPair();}}else if(invitation){$('#login-form').hidden=true;$('#signup-form').hidden=false;$('#toggle-login').hidden=false;}}
$('#toggle-login').onclick=()=>{$('#login-form').hidden=!$('#login-form').hidden;$('#signup-form').hidden=!$('#signup-form').hidden;};
$('#login-form').onsubmit=e=>{e.preventDefault();action(async()=>{const s=await api('/api/login',Object.fromEntries(new FormData(e.target)));csrf=s.csrf;account=s.account;e.target.reset();await boot();});};
$('#signup-form').onsubmit=e=>{e.preventDefault();action(async()=>{const s=await api('/api/signup',{...Object.fromEntries(new FormData(e.target)),invitation});csrf=s.csrf;account=s.account;e.target.reset();await boot();});};
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
async function refresh(){if(!account||refreshing)return;refreshing=true;try{const [d,c,a]=await Promise.all([api('/api/manage/devices'),api('/api/manage/calls'),api('/api/manage/authorizations')]);renderDevices(d.devices);renderCalls(c.calls);renderAuth(a.authorizations);if(googleEnabled)await renderGoogle();$('#stat-total').textContent=d.devices.length;$('#stat-ready').textContent=d.devices.filter(x=>x.toolsAvailable).length;$('#stat-waiting').textContent=c.calls.filter(x=>['executing','awaiting_result'].includes(x.status)).length;}finally{refreshing=false;}}
function renderDevices(devices){const parent=$('#devices');if(!devices.length)return empty(parent,'暂无设备');if(parent.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;parent.replaceChildren();for(const d of devices){const card=el('article',undefined,'device'),title=el('div',undefined,'section-title');title.append(el('h3',d.name),el('span',healthLabels[d.health]??d.health,'badge '+(d.toolsAvailable?'ready':d.networkConnected?'warn':'')));card.append(title);const dl=el('dl');for(const [k,v]of [['设备编号',d.id],['客户端版本',d.clientVersion??'未知'],['系统',d.platform??'未知'],['最后在线',time(d.lastSeen)],['密钥轮换',d.rotationPending?'等待设备确认':'已同步']])dl.append(el('dt',k),el('dd',v));card.append(dl);const actions=el('div',undefined,'actions');const run=async(action,body={})=>{await api('/api/manage/devices/'+encodeURIComponent(d.id)+'/'+action,body);await refresh();};actions.append(button('重命名',()=>{const form=el('form'),input=el('input');input.value=d.name;input.required=true;input.maxLength=100;input.setAttribute('aria-label','设备新名称');const save=el('button','保存');form.append(input,save);card.prepend(form);input.focus();form.onsubmit=e=>{e.preventDefault();action(async()=>{await run('rename',{name:input.value});form.remove();});};}),button(d.paused?'恢复':'暂停',()=>run(d.paused?'resume':'pause')),button('轮换密钥',async()=>{if(confirm('轮换这台设备的连接密钥？设备会自动保存新密钥。'))await run('rotate');}),button('解绑',async()=>{if(confirm('解绑“'+d.name+'”？它需要重新配对才能连接，正在运行的操作可能继续执行。'))await run('unlink');},'danger'));card.append(actions);parent.append(card);}}
function renderCalls(calls){const parent=$('#calls');if(!calls.length)return empty(parent,'暂无任务');parent.replaceChildren();for(const c of calls){const row=el('article',undefined,'row'),info=el('div',undefined,'grow');info.append(el('strong',c.tool),el('p',c.id,'muted'),el('p',time(c.started),'muted'));row.append(info,el('span',statusLabels[c.status]??c.status,'badge '+(c.status==='completed'?'ready':'')),button('查看结果',async()=>{const r=await api('/api/manage/calls/'+encodeURIComponent(c.id));$('#result-content').textContent=JSON.stringify(r,null,2);$('#result-dialog').showModal();}));parent.append(row);}}
function renderAuth(items){const parent=$('#authorizations');if(!items.length)return empty(parent,'暂无授权');parent.replaceChildren();for(const a of items){const row=el('article',undefined,'row'),info=el('div',undefined,'grow');info.append(el('strong',a.name),el('p','授权有效至 '+time(a.expires),'muted'));row.append(info,button('撤销授权',async()=>{if(confirm('撤销该客户端的本次授权？')){await api('/api/manage/authorizations/'+encodeURIComponent(a.id)+'/revoke',{});await refresh();}},'danger'));parent.append(row);}}
async function previewPair(){const code=$('#pair-code').value,p=await api('/api/manage/pair?code='+encodeURIComponent(code)),preview=$('#pair-preview');preview.hidden=false;preview.replaceChildren(el('h3',p.name),el('p',p.platform+' · 客户端 '+p.version));preview.append(button('确认绑定到 '+account.username,async()=>{await api('/api/manage/pair',{code,decision:'approve'});preview.replaceChildren(el('p','已绑定'));history.replaceState(null,'','/');query.delete('pair');$('#pair-code').value='';await refresh();}),button('拒绝',async()=>{await api('/api/manage/pair',{code,decision:'deny'});preview.hidden=true;query.delete('pair');history.replaceState(null,'','/');}));}
$('#pair-form').onsubmit=e=>{e.preventDefault();action(previewPair);};
$('#close-dialog').onclick=()=>$('#result-dialog').close();
$('#invite').onclick=()=>action(async()=>{const r=await api('/api/invitations',{}),link=el('a',r.url);link.href=r.url;$('#invite-link').replaceChildren(link);});
$('#password-form').onsubmit=e=>{e.preventDefault();action(async()=>{await api('/api/password',Object.fromEntries(new FormData(e.target)));e.target.reset();message('密码已更新。其他浏览器已退出，客户端需要重新关联。');await refresh();});};
setInterval(()=>{if(!document.hidden&&account)action(refresh);},10000);
action(boot);

async function googleStart(link=false){const r=await api(link?'/auth/google/link':'/auth/google/start',{returnTo:location.pathname+location.search});location.assign(r.url);}
$('#google-login').onclick=()=>action(()=>googleStart());
$('#google-link').onclick=()=>action(()=>googleStart(true));
$('#google-unlink').onclick=()=>action(async()=>{if(confirm('解除 Google 绑定？之后可继续用已有密码登录。')){const r=await api('/api/manage/google/unlink',{});if(r.csrf)csrf=r.csrf;await renderGoogle();}});
async function renderGoogle(){const g=await api('/api/manage/google');$('#google-panel').hidden=!g.enabled;$('#google-status').textContent=g.linked?'已绑定：'+(g.identity?.email??'Google 账号'):'未绑定';$('#google-link').hidden=!!g.linked;$('#google-unlink').hidden=!g.linked;$('#google-unlink').disabled=!g.canUnlink;}

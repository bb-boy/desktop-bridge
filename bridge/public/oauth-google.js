'use strict';
const button=document.querySelector('#google-consent-login');
if(button)button.addEventListener('click',async()=>{
  button.disabled=true;
  try {
    const s=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json());
    const response=await fetch('/auth/google/start',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({returnTo:location.pathname+location.search})});
    const result=await response.json();if(!response.ok)throw new Error(result.error??'Google 登录暂不可用');
    location.assign(result.url);
  }catch(e){button.disabled=false;const p=document.querySelector('.error');if(p)p.textContent=e.message;}
});

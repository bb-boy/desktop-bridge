import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root=fileURLToPath(new URL('../',import.meta.url));
const component=fs.readFileSync(path.join(root,'public','gui-permissions.html'),'utf8');
const host=fs.readFileSync(path.join(root,'test','permissions-host.fixture.html'),'utf8');
const browsers=[
 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];
const chrome=browsers.find(p=>fs.existsSync(p));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function unusedPort(){
 const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');
 const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;
}
async function json(url,method='GET'){
 const response=await fetch(url,{method,signal:AbortSignal.timeout(1500)});
 if(!response.ok)throw new Error('DevTools HTTP '+response.status);
 return response.json();
}
async function wait(fn,ms=12000){
 const end=Date.now()+ms;let last;
 while(Date.now()<end){
   try{const v=await fn();if(v)return v;}catch(e){last=e;}
   await sleep(85);
 }
 throw new Error('Timed out'+(last?' '+last.message:''));
}
function connect(wsUrl){
 return new Promise((resolve,reject)=>{
   const ws=new WebSocket(wsUrl);
   const pending=new Map();let next=0;
   ws.once('error',reject);
   ws.once('open',()=>{
     ws.on('message',b=>{
       const msg=JSON.parse(String(b));const p=pending.get(msg.id);
       if(p){pending.delete(msg.id);if(msg.error)p.reject(new Error(msg.error.message));else p.resolve(msg.result);}
     });
     resolve({
       ws,
       cmd(method,params={}){
         return new Promise((resolve,reject)=>{
           const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
         });
       },
       async evaluate(expression){
         const r=await this.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
         if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,600));
         return r.result?.value;
       }
     });
   });
 });
}

test('Chromium runs embedded MCP Apps permissions: device switching, allowlist, deny and save', {
 skip:!chrome&&'Chrome/Edge not installed',
 timeout:45000
},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-mcp-browser-'));
 const server=http.createServer((req,res)=>{
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
   res.end(req.url==='/ui'?component:host);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port;
 const port=await unusedPort();
 const child=spawn(chrome,[
   '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
   '--disable-background-networking','--disable-extensions','--remote-debugging-address=127.0.0.1',
   '--remote-debugging-port='+port,'--user-data-dir='+path.join(temp,'profile'),'about:blank'
 ],{stdio:'ignore',windowsHide:true});
 let devtools;
 t.after(async()=>{
   try{await devtools?.cmd('Browser.close');}catch{}
   try{devtools?.ws.close();}catch{}
   if(child.exitCode===null)child.kill();
   await new Promise(resolve=>server.close(resolve));
   try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:12,retryDelay:200});}catch{}
 });
 await wait(()=>json('http://127.0.0.1:'+port+'/json/version'));
 const page=await json('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(url),'PUT');
 devtools=await connect(page.webSocketDebuggerUrl);
 await devtools.cmd('Runtime.enable');
 await wait(()=>devtools.evaluate("(()=>{const f=document.querySelector('iframe');return !!(f?.contentDocument?.querySelector('#save')&&!f.contentDocument.querySelector('#save').disabled)})()"));
 const initial=await devtools.evaluate("(()=>{const f=document.querySelector('iframe').contentDocument;return {title:f.querySelector('h2').textContent,device:f.querySelector('#device').value,mode:f.querySelector('input[name=mode]:checked').value,hidden:f.querySelector('#catalog').hidden}})()");
 assert.match(initial.title,/Desktop Bridge/);
 assert.deepEqual([initial.device,initial.mode,initial.hidden],['p111','full',true]);

 // Save explicit Desktop Commander and Cua tool allowlist using the actual HTML controls.
 await devtools.evaluate("(()=>{const f=document.querySelector('iframe').contentDocument;f.querySelector('input[name=mode][value=custom]').click();f.querySelector('input[data-tool=read_file]').click();f.querySelector('input[data-tool=cua_click]').click();f.querySelector('#save').click()})()");
 await wait(()=>devtools.evaluate("(()=>{const p=window._policies.p111;return p.mode==='custom'&&p.allowed_tools.includes('cua_click')&&p.allowed_tools.includes('read_file')})()"));
 const after=await devtools.evaluate("(()=>{const f=document.querySelector('iframe').contentDocument;return {mode:f.querySelector('input[name=mode]:checked').value,visible:!f.querySelector('#catalog').hidden,cua:!!f.querySelector('#cua-tools input[data-tool=cua_click]'),desktop:!!f.querySelector('#desktop-tools input[data-tool=read_file]'),status:f.querySelector('#status').textContent}})()");
 assert.equal(after.mode,'custom');
 assert.equal(after.visible,true);assert.equal(after.cua,true);assert.equal(after.desktop,true);
 assert.match(after.status,/已保存/);

 // Switch to another device; a backend denial must not change saved permissions.
 await devtools.evaluate("(()=>{const f=document.querySelector('iframe').contentDocument;f.querySelector('#device').value='mac';f.querySelector('#device').dispatchEvent(new Event('change',{bubbles:true}))})()");
 await wait(()=>devtools.evaluate("(()=>{const f=document.querySelector('iframe').contentDocument;return f.querySelector('#device').value==='mac'&&f.querySelector('input[name=mode]:checked').value==='read_only'})()"));
 await devtools.evaluate("(()=>{window._rejectNext=true;const f=document.querySelector('iframe').contentDocument;f.querySelector('input[name=mode][value=full]').click();f.querySelector('#save').click()})()");
 const error=await wait(()=>devtools.evaluate("(()=>{const f=document.querySelector('iframe').contentDocument;return f.querySelector('#status').dataset.error==='true'&&f.querySelector('#status').textContent})()"));
 assert.match(error,/Permission denied/);
 assert.equal(await devtools.evaluate("window._policies.mac.mode"),'read_only');
 await devtools.evaluate("document.querySelector('iframe').contentDocument.querySelector('#save').click()");
 await wait(()=>devtools.evaluate("window._policies.mac.mode==='full'"));
 assert.equal(await devtools.evaluate("(()=>{const r=window._requests;return r.some(x=>x.method==='ui/initialize')&&r.some(x=>x.method==='tools/call'&&x.params.name==='set_device_permissions')})()"),true);
 console.log('CHROMIUM_MCP_APPS_UI_E2E_PASS=true');
});

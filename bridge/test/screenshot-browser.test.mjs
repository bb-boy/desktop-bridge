import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';

const chrome=[process.env.CHROME_PATH,
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',
 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(p=>p&&fs.existsSync(p));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){
 const until=Date.now()+10000;
 while(Date.now()<until){if(await fn())return;await sleep(40);}
 throw new Error('Browser condition timed out');
}
async function connect(url){
 const ws=new WebSocket(url);await once(ws,'open');
 let next=0;const pending=new Map();
 ws.on('message',b=>{
  const m=JSON.parse(String(b)),p=pending.get(m.id);
  if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
 });
 return {ws,cmd(method,params={}){
  return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 },async evaluate(expression){
  const r=await this.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
 }};
}
const imageId='11111111-1111-4111-8111-111111111111';
const fileId='22222222-2222-4222-8222-222222222222';
// Actual decodable 1px PNG; the regression concerns task identity, not image size.
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const image={content:[{type:'image',mimeType:'image/png',data:png}],structuredContent:{desktopBridgeCallId:imageId,screenshot_width:1,screenshot_height:1}};
const file={content:[{type:'text',text:'Screenshot saved'}],structuredContent:{desktopBridgeCallId:fileId,screenshot_file_path:'C:\\Temp\\screen.png',screenshot_width:1,screenshot_height:1}};

const fixture=`<!doctype html><script>
window.state=null;window.recovered=[];window.current=null;window.initialized=0;window.modes=[];window.denyMode=false;
window.imageResult=${JSON.stringify(image)};window.fileResult=${JSON.stringify(file)};
window.mount=(result)=>{
 window.current=result;document.querySelector('iframe')?.remove();
 const f=document.createElement('iframe');f.style='width:760px;height:600px;border:0';f.src='/ui';document.body.append(f);
};
window.deliver=(result)=>{
 window.current=result;
 const f=document.querySelector('iframe');f.contentWindow.openai.toolOutput=result.structuredContent;
 f.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');
};
window.addEventListener('message',e=>{
 const m=e.data;if(e.source!==document.querySelector('iframe')?.contentWindow||!m.id)return;
 let result={};
 if(m.method==='ui/initialize'){
  window.initialized++;
  result={protocolVersion:'2026-01-26',hostCapabilities:{serverTools:{}},hostInfo:{name:'regression-host',version:'1'}};
 }else if(m.method==='ui/request-display-mode'){
  window.modes.push(m.params.mode);
  if(window.denyMode){e.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Not supported'}},'*');return;}
  result={mode:m.params.mode};
 }else if(m.method==='tools/call'){
  window.recovered.push(m.params.arguments.call_id);
  const id=m.params.arguments.call_id;
  const r=id===${JSON.stringify(imageId)}?window.imageResult:window.fileResult;
  result={content:[{type:'text',text:JSON.stringify({id,tool:'cua_get_desktop_state',status:'completed',result:r})}]};
 }
 e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
 if(m.method==='ui/initialize')window.deliver(window.current);
});
</script><body></body>`;

test('Chromium screenshot viewer supports zoom, pan, fullscreen fallback and task recovery',{
 skip:!chrome&&'Chrome/Chromium not installed',timeout:40000
},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-screenshot-browser-'));
 let devtools,child;
 const component=fs.readFileSync(new URL('../public/screenshot.html',import.meta.url),'utf8');
 const bootstrap=`<script>window.openai={widgetState:parent.state,toolOutput:parent.current?.structuredContent,
 setWidgetState:s=>{parent.state=JSON.parse(JSON.stringify(s))}};<\/script>`;
 const server=http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'});
  res.end(req.url==='/ui'?component.replace('<script type="module">',bootstrap+'<script type="module">'):fixture);
 });
 t.after(async()=>{
  try{await devtools?.cmd('Browser.close');}catch{}
  devtools?.ws.close();
  // On Windows Chromium may still hold its user-data directory after CDP closes.
  // Wait for the browser process to exit before attempting profile removal.
  if(child?.exitCode===null){
   const exited=once(child,'exit').catch(()=>{});
   child.kill();
   await Promise.race([exited,sleep(5000)]);
  }
  await new Promise(r=>server.close(r));
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:20,retryDelay:300});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 child=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+temp,'about:blank'],{stdio:'ignore'});
 const endpoint='http://127.0.0.1:'+port;
 await wait(async()=>{try{return (await fetch(endpoint+'/json/version')).ok;}catch{return false;}});
 const page=await (await fetch(endpoint+'/json/new?'+encodeURIComponent('http://127.0.0.1:'+server.address().port),{method:'PUT'})).json();
 devtools=await connect(page.webSocketDebuggerUrl);await devtools.cmd('Runtime.enable');
 await wait(()=>devtools.evaluate('typeof mount==="function"'));
 const rendered=`(()=>{const d=document.querySelector('iframe')?.contentDocument;const i=d?.querySelector('#screenshot');return !!(i?.naturalWidth&&!d.querySelector('#image-frame').hidden&&d.querySelector('#status').hidden)})()`;
 await devtools.evaluate('mount(imageResult)');await wait(()=>devtools.evaluate(rendered));
 assert.equal(await devtools.evaluate('state.desktopBridgeCallId'),imageId);
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#image-hint")'),null,'screenshot preview should have no explanatory hint');
 await devtools.evaluate('recovered=[]');
 // Exercise the real image viewer with a desktop-sized, locally generated image.
 await devtools.evaluate(`(()=>{
  const c=document.createElement('canvas');c.width=1600;c.height=900;
  const g=c.getContext('2d');g.fillStyle='#e8eef6';g.fillRect(0,0,1600,900);
  g.fillStyle='#203652';g.font='48px sans-serif';g.fillText('Desktop Bridge screenshot viewer',80,130);
  imageResult.content[0].data=c.toDataURL('image/png').split(',')[1];
  document.querySelector('iframe').contentDocument.querySelector('#screenshot').src=c.toDataURL('image/png');
 })()`);
 await wait(()=>devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#screenshot").naturalWidth===1600'));
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#open-viewer").click()');
 await wait(()=>devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-image").naturalWidth===1600&&modes.includes("fullscreen")'));
 await devtools.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const zoomWidth=()=>devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-image").getBoundingClientRect().width');
 const fitWidth=await zoomWidth();
 assert.ok(fitWidth<1600&&fitWidth>0);
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-in").click()');
 assert.ok(await zoomWidth()>fitWidth);
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-out").click()');
 assert.ok(Math.abs(await zoomWidth()-fitWidth)<1);
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-actual").click()');
 assert.equal(await zoomWidth(),1600);
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-level").textContent'),'100%');
 // Wheel zoom is confined to the viewer; large images remain scrollable.
 await devtools.evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow;w.document.querySelector('#zoom-viewport').dispatchEvent(new w.WheelEvent('wheel',{deltaY:-100,cancelable:true}))})()`);
 assert.ok(await zoomWidth()>1600);
 assert.equal(await devtools.evaluate('(()=>{const v=document.querySelector("iframe").contentDocument.querySelector("#zoom-viewport");return v.scrollWidth>v.clientWidth})()'),true);
 // Use actual browser mouse input to drag the enlarged image.
 const point=await devtools.evaluate('(()=>{const f=document.querySelector("iframe"),r=f.contentDocument.querySelector("#zoom-viewport").getBoundingClientRect(),b=f.getBoundingClientRect();return {x:b.left+r.left+200,y:b.top+r.top+200}})()');
 const beforePan=await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-viewport").scrollLeft');
 await devtools.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
 await devtools.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-80,y:point.y,button:'left',buttons:1});
 await devtools.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-80,y:point.y,button:'left',clickCount:1});
 assert.ok(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-viewport").scrollLeft')>beforePan);
 await devtools.evaluate('(()=>{const b=document.querySelector("iframe").contentDocument.querySelector("#zoom-in");for(let i=0;i<25;i++)b.click()})()');
 assert.equal(await zoomWidth(),6400);
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-in").disabled'),true);
 await devtools.evaluate('(()=>{const b=document.querySelector("iframe").contentDocument.querySelector("#zoom-out");for(let i=0;i<30;i++)b.click()})()');
 assert.equal(await zoomWidth(),160);
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-out").disabled'),true);
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-fit").click()');
 assert.ok(Math.abs(await zoomWidth()-fitWidth)<1);
 if(process.env.SCREENSHOT_PREVIEW_PATH){
  const preview=await devtools.cmd('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(process.env.SCREENSHOT_PREVIEW_PATH,Buffer.from(preview.data,'base64'));
 }
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#viewer-close").click()');
 await wait(()=>devtools.evaluate('modes.at(-1)==="inline"'));
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#image-viewer").open'),false);
 assert.equal(await devtools.evaluate('state.desktopBridgeCallId'),imageId);
 assert.deepEqual(await devtools.evaluate('recovered'),[],'zoom must not retrieve or recapture a screenshot');
 // Fullscreen rejection must leave a usable in-card viewer, including narrow layouts.
 await devtools.evaluate('denyMode=true;document.querySelector("iframe").style.width="360px";document.querySelector("iframe").contentDocument.querySelector("#open-viewer").click()');
 await wait(()=>devtools.evaluate('modes.length===3'));
 await devtools.evaluate('new Promise(r=>setTimeout(r,80))');
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#image-viewer").open'),true);
 assert.ok(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-viewport").clientHeight')>200);
 await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#zoom-in").focus()');
 await devtools.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await devtools.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await wait(()=>devtools.evaluate('!document.querySelector("iframe").contentDocument.querySelector("#image-viewer").open'));
 await devtools.evaluate('denyMode=false;document.querySelector("iframe").style.width="760px"');
 await devtools.evaluate('deliver(fileResult)');
 await wait(()=>devtools.evaluate('current.structuredContent.desktopBridgeCallId===fileResult.structuredContent.desktopBridgeCallId'));
 // Let postMessage reach the component before reading persisted state.
 await devtools.evaluate('new Promise(r=>setTimeout(r,100))');
 assert.equal(await devtools.evaluate('state.desktopBridgeCallId'),imageId,'file-only call must not replace image identity');
 assert.equal(await devtools.evaluate(rendered),true);
 await devtools.evaluate('mount(fileResult)');await wait(()=>devtools.evaluate(rendered));
 assert.deepEqual(await devtools.evaluate('recovered'),[imageId]);
 // A brand-new file-only widget must be informational, not attempt to recover missing bytes.
 await devtools.evaluate('state=null;mount(fileResult)');
 await wait(()=>devtools.evaluate('initialized===3'));
 await devtools.evaluate('new Promise(r=>setTimeout(r,100))');
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#status").dataset.error'),'false');
 assert.match(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#status").textContent'),/保存/);
 assert.deepEqual(await devtools.evaluate('recovered'),[imageId]);
 // Delayed globals, as on a restored ChatGPT page, must also recover the image.
 await devtools.evaluate('state=null;mount({content:[],structuredContent:{}})');
 await wait(()=>devtools.evaluate('initialized===4'));
 await devtools.evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow;w.openai.toolOutput=imageResult.structuredContent;w.dispatchEvent(new Event('openai:set_globals'))})()`);
 await wait(()=>devtools.evaluate(rendered));
 assert.equal(await devtools.evaluate('state.desktopBridgeCallId'),imageId);
 assert.deepEqual(await devtools.evaluate('recovered'),[imageId,imageId]);
 // Older v3 widgets may already have persisted the wrong, file-only task ID.
 await devtools.evaluate('state={desktopBridgeCallId:fileResult.structuredContent.desktopBridgeCallId};mount(fileResult)');
 await wait(()=>devtools.evaluate('state.desktopBridgeCallId===null'));
 assert.equal(await devtools.evaluate('document.querySelector("iframe").contentDocument.querySelector("#status").dataset.error'),'false');
 assert.equal(await devtools.evaluate('recovered.at(-1)'),fileId);
});

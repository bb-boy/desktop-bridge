import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/screenshot.html',import.meta.url),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

function createView(){
  assert.ok(script,'Screenshot widget script exists');
  const elements=new Map([
    ['#status',{hidden:false,dataset:{},textContent:'正在接收截图…'}],
    ['#image-frame',{hidden:true}],
    ['#screenshot',{removeAttribute(name){if(name==='src')delete this.src;}}],
    ['#details',{textContent:''}]
  ]);
  const sent=[];
  let onMessage;
  const parent={postMessage(message){
    sent.push(message);
    if(message.method==='ui/initialize'){
      queueMicrotask(()=>onMessage({source:parent,data:{
        jsonrpc:'2.0',id:message.id,result:{}
      }}));
    }
  }};
  const window={parent,addEventListener(kind,callback){
    if(kind==='message')onMessage=callback;
  }};
  vm.runInNewContext(script,{window,document:{querySelector:selector=>elements.get(selector)},
    Map,Number,Promise}, {filename:'screenshot.html'});
  return {elements,sent,notify(result){onMessage({source:parent,data:{
    jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result
  }});}};
}

test('screenshot widget initializes over MCP Apps and renders a returned PNG',async()=>{
 const ui=createView();
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(ui.sent.some(message=>message.method==='ui/notifications/initialized'));
 const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9AFxkAAAAASUVORK5CYII=';
 ui.notify({content:[{type:'image',mimeType:'image/png',data:encoded}],
   structuredContent:{screenshot_width:1200,screenshot_height:675}});
 const img=ui.elements.get('#screenshot');
 assert.equal(img.src,'data:image/png;base64,'+encoded);
 img.onload();
 assert.equal(ui.elements.get('#image-frame').hidden,false);
 assert.equal(ui.elements.get('#status').hidden,true);
 assert.equal(ui.elements.get('#details').textContent,'1200 × 675 px');
});

test('screenshot widget rejects missing/invalid images without creating a URL',()=>{
 const ui=createView();
 ui.notify({content:[{type:'text',text:'No screenshot'}],structuredContent:{}});
 assert.match(ui.elements.get('#status').textContent,/未收到可显示/);
 const img=ui.elements.get('#screenshot');
 assert.equal(img.src,undefined);
 ui.notify({content:[{type:'image',mimeType:'text/html',data:'PHNjcmlwdD4='}]});
 assert.equal(img.src,undefined);
 ui.notify({isError:true,content:[{type:'text',text:'Capture unavailable'}]});
 assert.equal(ui.elements.get('#status').textContent,'Capture unavailable');
});

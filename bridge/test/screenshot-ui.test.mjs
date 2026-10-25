import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/screenshot.html',import.meta.url),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

function createView({savedCallId='',recoveredRecord=null,hostMetadata=null}={}){
  assert.ok(script,'Screenshot widget script exists');
  const elements=new Map([
    ['#status',{hidden:false,dataset:{},textContent:'正在接收截图…'}],
    ['#image-frame',{hidden:true}],
    ['#screenshot',{removeAttribute(name){if(name==='src')delete this.src;}}],
    ['#details',{textContent:''}],
    ['main',{getBoundingClientRect(){return {height:elements.get('#image-frame').hidden?120:520,width:1000};}}]
  ]);
  const sent=[];
  let onMessage;
  let onGlobals;
  const parent={postMessage(message){
    sent.push(message);
    if(message.method==='ui/initialize'){
      queueMicrotask(()=>onMessage({source:parent,data:{
        jsonrpc:'2.0',id:message.id,result:{}
      }}));
    }
    if(message.method==='tools/call'&&recoveredRecord){
      queueMicrotask(()=>onMessage({source:parent,data:{
        jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:JSON.stringify(recoveredRecord)}]}
      }}));
    }
  }};
  const window={parent,openai:{widgetState:savedCallId?{desktopBridgeCallId:savedCallId}:null,
    toolResponseMetadata:hostMetadata,
    setWidgetState(state){this.widgetState=state;}},addEventListener(kind,callback){
    if(kind==='message')onMessage=callback;
    if(kind==='openai:set_globals')onGlobals=callback;
  }};
  vm.runInNewContext(script,{window,document:{querySelector:selector=>elements.get(selector)},
    Map,Number,Promise}, {filename:'screenshot.html'});
  return {elements,sent,getState(){return window.openai.widgetState;},setHostMetadata(value){
    window.openai.toolResponseMetadata=value;
    onGlobals?.({detail:{globals:{toolResponseMetadata:value}}});
  },notify(result){onMessage({source:parent,data:{
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
 const resize=ui.sent.find(message=>message.method==='ui/notifications/size-changed');
 assert.equal(resize?.params?.height,544);
 ui.notify({content:[{type:'text',text:'metadata update'}],structuredContent:{}});
 assert.equal(ui.elements.get('#image-frame').hidden,false,'later metadata-only notification must preserve screenshot');
 assert.equal(img.src,'data:image/png;base64,'+encoded);
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


test('screenshot widget restores persisted capture from an existing task without taking another screenshot',async()=>{
 const id='c324c779-b030-4f2f-8e80-da3bf9e9bde2';
 const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9AFxkAAAAASUVORK5CYII=';
 const record={id,tool:'cua_get_desktop_state',status:'completed',result:{
   content:[{type:'image',mimeType:'image/png',data:encoded}],
   structuredContent:{screenshot_width:800,screenshot_height:450}
 }};
 const ui=createView({savedCallId:id,recoveredRecord:record});
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 const calls=ui.sent.filter(message=>message.method==='tools/call');
 assert.equal(calls.length,1);
 assert.equal(calls[0].params.name,'get_call_result');
 assert.equal(calls[0].params.arguments.call_id,id);
 assert.equal(ui.elements.get('#screenshot').src,'data:image/png;base64,'+encoded);
 ui.elements.get('#screenshot').onload();
 assert.equal(ui.elements.get('#image-frame').hidden,false);
 assert.equal(ui.elements.get('#status').hidden,true);
});

test('screenshot widget remembers task ID even when host omits image from first result',async()=>{
 const ui=createView();
 const id='c324c779-b030-4f2f-8e80-da3bf9e9bde2';
 ui.notify({content:[],structuredContent:{desktopBridgeCallId:id}});
 assert.equal(ui.getState()?.desktopBridgeCallId,id);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.sent.some(message=>message.method==='tools/call'&&message.params.name==='get_call_result'),true);
});

test('widget rehydrates directly from ChatGPT mcp_tool_result without a second tool call',async()=>{
 const id='c324c779-b030-4f2f-8e80-da3bf9e9bde2';
 const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9AFxkAAAAASUVORK5CYII=';
 const mcp={content:[{type:'image',mimeType:'image/png',data:encoded}],
   structuredContent:{screenshot_width:1600,screenshot_height:900,desktopBridgeCallId:id}};
 const ui=createView({savedCallId:id,hostMetadata:{status:'success',mcp_tool_result:mcp}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.elements.get('#screenshot').src,'data:image/png;base64,'+encoded);
 assert.equal(ui.sent.filter(message=>message.method==='tools/call').length,0);
 ui.elements.get('#screenshot').onload();
 assert.equal(ui.elements.get('#image-frame').hidden,false);
 assert.equal(ui.elements.get('#details').textContent,'1600 × 900 px');
});

test('widget reads nested call_tool_result and late-arriving host metadata',async()=>{
 const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9AFxkAAAAASUVORK5CYII=';
 const ui=createView();
 await new Promise(resolve=>setImmediate(resolve));
 ui.notify({content:[{type:'text',text:'metadata-only'}]});
 assert.equal(ui.elements.get('#image-frame').hidden,true);
 ui.setHostMetadata({call_tool_result:{result:{content:[{type:'image',mimeType:'image/png',data:encoded}],
  structuredContent:{screenshot_width:1200,screenshot_height:675}}}});
 assert.equal(ui.elements.get('#screenshot').src,'data:image/png;base64,'+encoded);
 ui.elements.get('#screenshot').onload();
 assert.equal(ui.elements.get('#image-frame').hidden,false);
 assert.equal(ui.elements.get('#status').hidden,true);
 assert.equal(ui.sent.filter(message=>message.method==='tools/call').length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {savedCallResult,deliverImages,resultDiagnostics} from '../server/call-results.mjs';

test('multi-megabyte recovered images remain native content, not text or structured JSON',()=>{
 const data='A'.repeat(3_538_284);
 const picture={type:'image',mimeType:'image/png',data};
 const call={id:'task',tool:'cua_get_desktop_state',status:'completed',result:{content:[picture,{type:'text',text:'desktop screenshot'}],structuredContent:{screenshot_width:1600,screenshot_height:900},_meta:{privateSecret:'hidden'}}};
 const response=savedCallResult(call);
 assert.ok(response.content[0].text.length<1000);
 assert.ok(!response.content[0].text.includes(data.slice(0,100)));
 assert.ok(!response.content[0].text.includes('privateSecret'));
 assert.equal(JSON.parse(response.content[0].text).result.content[0].dataOmitted,true);
 assert.ok(response.content[1].data===data);
 assert.deepEqual(call.result.content[0],picture,'saved database result is never modified');
 assert.equal(resultDiagnostics('get_call_result',response,call.id,Date.now()).imageDataChars,data.length);
});

test('text, failed and unfinished records retain their recoverable status and results',()=>{
 for(const status of ['completed','failed','unknown','executing']){
  const call={id:'task',status,result:status==='executing'?null:{isError:status==='failed',content:[{type:'text',text:'saved output'}]}};
  assert.deepEqual(JSON.parse(savedCallResult(call).content[0].text),call);
 }
});

test('diagnostics record only counts and task identity, never arguments or captured data',()=>{
 const diagnostic=resultDiagnostics('cua_get_desktop_state',{
  content:[{type:'text',text:'sensitive text'},{type:'image',mimeType:'image/png',data:'private-image-data'}],
  structuredContent:{privatePath:'sensitive path'},_meta:{token:'secret'}
 },'sensitive-argument-that-is-not-a-task-id',Date.now());
 assert.equal(diagnostic.textChars,14);
 assert.equal(diagnostic.imageCount,1);
 assert.equal(diagnostic.taskId,null);
 const encoded=JSON.stringify(diagnostic);
 for(const secret of ['sensitive text','private-image-data','sensitive path','secret'])assert.ok(!encoded.includes(secret));
});

test('display-only images are private metadata, with explicit native-image opt-in',()=>{
 const data='A'.repeat(3_538_284),picture={type:'image',mimeType:'image/png',data};
 const source={content:[picture,{type:'text',text:'screenshot captured'}],structuredContent:{screenshot_width:1600},_meta:{desktopBridge:{callId:'task'}}};
 const descriptor={url:'https://bridge.example/api/screenshots/task',token:'x'.repeat(43),expiresAt:Date.now()+300000};
 const ui=deliverImages(source,'ui',descriptor);
 assert.equal(ui.content.length,1);
 assert.equal(ui._meta.desktopBridge.screenshot,descriptor);
 assert.ok(JSON.stringify(ui).length<1000,'entire MCP response, including metadata, must stay small');
 const {_meta,...modelVisible}=ui;
 assert.ok(JSON.stringify(modelVisible).length<200);
 assert.equal(ui._meta.desktopBridge.callId,'task');
 assert.equal(deliverImages(source,'model'),source);
 assert.throws(()=>deliverImages(source,'invalid'),/image_delivery/);
 assert.equal(source.content[0],picture);
});

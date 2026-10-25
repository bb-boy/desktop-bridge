import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startServer} from '../server/index.mjs';
import {opaque,hash,passwordHash} from '../server/security.mjs';

test('MCP distinguishes inline screenshot results from file-only results and serves all widget versions',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-screenshot-mcp-'));
 const server=await startServer({baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,ownerPasswordHash:await passwordHash('test-password'),devices:[]});
 const token=opaque();
 server.store.saveGrant(hash(token),'access','screenshot-test',{clientId:'screenshot-test',ownerId:'owner',scopes:['desktop']},Date.now()+90000);
 const client=new Client({name:'screenshot-test',version:'1'},{capabilities:{}});
 t.after(async()=>{await client.close();await server.close();fs.rmSync(directory,{recursive:true,force:true});});
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.httpServer.address().port+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+token}}}));
 server.broker.tools=()=>[{name:'cua_get_desktop_state',inputSchema:{type:'object',properties:{}}}];
 const catalog=await client.listTools();
 assert.equal(catalog.tools.find(t=>t.name==='cua_get_desktop_state')._meta.ui.resourceUri,'ui://desktop-bridge/screenshot-v5.html');
 for(const version of [1,2,3,4,5]){
  const r=await client.readResource({uri:'ui://desktop-bridge/screenshot-v'+version+'.html'});
  assert.match(r.contents[0].text,/Persist the identity of the picture/);
  assert.deepEqual(r.contents[0]._meta['openai/ui'],{availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'inline'});
 }
 const id='11111111-1111-4111-8111-111111111111';
 server.broker.call=async()=>({content:[{type:'image',mimeType:'image/png',data:'AAAA'}],_meta:{desktopBridge:{callId:id}},structuredContent:{screenshot_width:1600,screenshot_height:900}});
 const picture=await client.callTool({name:'cua_get_desktop_state',arguments:{}});
 assert.equal(picture.structuredContent.desktopBridgeScreenshotAvailable,true);
 assert.equal(picture.structuredContent.desktopBridgeCallId,id);
 assert.equal(picture.content[0].data,'AAAA');
 server.broker.call=async()=>({content:[{type:'text',text:'Screenshot saved'}],_meta:{desktopBridge:{callId:id}},structuredContent:{screenshot_file_path:'C:\\Temp\\screen.png'}});
 const file=await client.callTool({name:'cua_get_desktop_state',arguments:{}});
 assert.equal(file.structuredContent.desktopBridgeScreenshotAvailable,false);
 assert.equal(file.content.some(c=>c.type==='image'),false);
 server.broker.call=async()=>({isError:true,content:[{type:'text',text:'Capture failed'}]});
 const failed=await client.callTool({name:'cua_get_desktop_state',arguments:{}});
 assert.equal(failed.isError,true);
 assert.equal(failed.structuredContent,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startServer} from '../server/index.mjs';
import {opaque,hash,passwordHash} from '../server/security.mjs';

test('authenticated MCP exposes ChatGPT web permission UI resource and persists selection',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-permissions-mcp-'));
 const config={baseUrl:'http://127.0.0.1:9876',port:0,dataDir:directory,
   ownerPasswordHash:await passwordHash('test-password'),
   devices:[{id:'p111',name:'Windows P111',tokenHash:hash(opaque())}]};
 const server=await startServer(config);
 const token=opaque();
 server.store.saveGrant(hash(token),'access','perm-test',{clientId:'perm-test',ownerId:'owner',family:opaque(),scopes:['desktop']},Date.now()+90000);
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 const client=new Client({name:'permission-ui-e2e',version:'0.1'},{capabilities:{}});
 t.after(async()=>{await client.close().catch(()=>{});await server.close();fs.rmSync(directory,{recursive:true,force:true});});
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{
   requestInit:{headers:{authorization:'Bearer '+token}}
 }));
 const catalog=await client.listTools();
 const names=catalog.tools.map(t=>t.name);
 assert.ok(names.includes('get_device_permissions'));
 assert.ok(names.includes('set_device_permissions'));
 const openTool=catalog.tools.find(t=>t.name==='get_device_permissions');
 assert.equal(openTool._meta.ui.resourceUri,'ui://desktop-bridge/permissions-v1.html');
 const saveTool=catalog.tools.find(t=>t.name==='set_device_permissions');
 assert.deepEqual(saveTool._meta.ui.visibility,['app']);
 assert.equal(catalog.tools.find(t=>t.name==='start_process').annotations.destructiveHint,true);
 assert.equal(catalog.tools.find(t=>t.name==='read_file').annotations.readOnlyHint,true);
 const resources=await client.listResources();
 assert.ok(resources.resources.some(r=>r.uri==='ui://desktop-bridge/permissions-v1.html'&&r.mimeType==='text/html;profile=mcp-app'));
 const resource=await client.readResource({uri:'ui://desktop-bridge/permissions-v1.html'});
 assert.match(resource.contents[0].text,/Desktop Commander/);
 assert.match(resource.contents[0].text,/tools\/call/);
 const initial=await client.callTool({name:'get_device_permissions',arguments:{device_id:'p111'}});
 assert.equal(initial.structuredContent.mode,'full');
 assert.equal(initial.structuredContent.devices[0].name,'Windows P111');
 const updated=await client.callTool({name:'set_device_permissions',arguments:{device_id:'p111',mode:'read_only'}});
 assert.equal(updated.structuredContent.mode,'read_only');
 const again=await client.callTool({name:'get_device_permissions',arguments:{device_id:'p111'}});
 assert.equal(again.structuredContent.mode,'read_only');
 const invalid=await client.callTool({name:'set_device_permissions',arguments:{device_id:'nope',mode:'full'}});
 assert.equal(invalid.isError,true);
 const reset=await client.callTool({name:'set_device_permissions',arguments:{device_id:'p111',mode:'full'}});
 assert.equal(reset.structuredContent.mode,'full');
});

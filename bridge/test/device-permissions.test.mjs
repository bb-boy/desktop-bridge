import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';
import {Broker} from '../server/broker.mjs';
import {riskForTool,annotateTool} from '../server/tool-risk.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));

const tools=[
 {name:'read_file',description:'Read',inputSchema:{type:'object',properties:{}}},
 {name:'write_file',description:'Write',inputSchema:{type:'object',properties:{}}},
 {name:'start_process',description:'Shell',inputSchema:{type:'object',properties:{}}},
 {name:'cua_list_windows',description:'Windows',inputSchema:{type:'object',properties:{}}},
 {name:'cua_click',description:'Click',inputSchema:{type:'object',properties:{}}},
 {name:'new_unknown_tool',description:'Unclassified',inputSchema:{type:'object',properties:{}}}
];

function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-tool-permissions-'));
 const store=openStore(dir);
 store.migrate({ownerPasswordHash:'test-hash',devices:[{id:'p111',name:'Windows',tokenHash:'hash'}]});
 store.saveTools('p111',tools,'owner');
 const httpServer=http.createServer();
 const broker=new Broker(httpServer,{baseUrl:'http://127.0.0.1:9876'},store);
 t.after(async()=>{await broker.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let sent=0;
 const conn={
  device:{id:'p111',owner:'owner'},
  ready:true,healthAt:Date.now(),healthOk:true,stopRequested:false,ws:{
   readyState:1,
   send(raw,cb) {
    const m=JSON.parse(raw);
    if(m.type==='call'){
      sent++;
      queueMicrotask(()=>{
        store.finishCall(m.id,'completed',{content:[{type:'text',text:'ok'}]});
        broker.settle(m.id,{content:[{type:'text',text:'ok'}]});
      });
    }
    cb?.();
   },
   terminate(){this.readyState=3;},
   close(){this.readyState=3;}
  }
 };
 broker.connections.set('p111',conn);
 return {store,broker,dir,get sent(){return sent;}};
}

test('risk annotations classify Desktop Commander, Cua, shell and unknown tools conservatively',()=>{
 assert.equal(riskForTool('read_file').readOnlyHint,true);
 assert.equal(riskForTool('start_process').destructiveHint,true);
 assert.equal(riskForTool('cua_list_windows').readOnlyHint,true);
 assert.equal(riskForTool('cua_click').destructiveHint,true);
 assert.equal(riskForTool('unknown_tool').destructiveHint,true);
 assert.equal(riskForTool('cua_browser_navigate').openWorldHint,true);
 const malicious=annotateTool({...tools[1],annotations:{readOnlyHint:true}});
 assert.equal(malicious.annotations.readOnlyHint,false,'Client-provided fake read-only hints must not be trusted');
});

test('default policy is full access and Broker advertises trusted annotations',async t=>{
 const f=fixture(t);
 const initial=f.broker.devicePermissions({device_id:'p111'});
 assert.equal(initial.mode,'full');
 assert.equal(initial.updated,null);
 assert.equal(initial.tools.length,tools.length+1);
 const definitions=f.broker.tools('owner');
 assert.equal(definitions.find(t=>t.name==='start_process').annotations.destructiveHint,true);
 assert.equal(definitions.find(t=>t.name==='cua_list_windows').annotations.readOnlyHint,true);
 assert.equal((await f.broker.call('cua_click',{device_id:'p111',x:0,y:0})).content[0].text,'ok');
 assert.equal(f.sent,1);
});

test('read_only allows only conservative reads; rejects file write, shell, click, unknown and shutdown',async t=>{
 const f=fixture(t);
 f.broker.setDevicePermissions({device_id:'p111',mode:'read_only'});
 for(const name of ['read_file','cua_list_windows'])
   assert.equal((await f.broker.call(name,{device_id:'p111'})).content[0].text,'ok');
 for(const name of ['write_file','start_process','cua_click','new_unknown_tool','shutdown'])
   await assert.rejects(()=>f.broker.call(name,{device_id:'p111'}),/permission denied/);
 assert.equal(f.sent,2,'Only the two allowlisted reads should reach Windows');
});

test('custom explicitly allows only named tools and defaults new tools to denied',async t=>{
 const f=fixture(t);
 const policy=f.broker.setDevicePermissions({device_id:'p111',mode:'custom',allowed_tools:['read_file','cua_click']});
 assert.equal(policy.mode,'custom');
 assert.deepEqual(policy.allowed_tools,['read_file','cua_click']);
 await f.broker.call('cua_click',{device_id:'p111'});
 await assert.rejects(()=>f.broker.call('cua_list_windows',{device_id:'p111'}),/permission denied/);
 await assert.rejects(()=>f.broker.call('new_unknown_tool',{device_id:'p111'}),/permission denied/);
 assert.equal(f.sent,1);
});

test('policy updates enforce owner, known tool, distinct names and malformed input',t=>{
 const f=fixture(t);
 assert.throws(()=>f.broker.devicePermissions({device_id:'p111'},'other'),/not found/i);
 assert.throws(()=>f.broker.setDevicePermissions({device_id:'p111',mode:'full'},'other'),/not found/i);
 assert.throws(()=>f.broker.setDevicePermissions({device_id:'p111',mode:'custom',allowed_tools:['unexpected']}),/Unknown device tool/);
 assert.throws(()=>f.broker.setDevicePermissions({device_id:'p111',mode:'custom',allowed_tools:['read_file','read_file']}),/Invalid allowed tools/);
 assert.throws(()=>f.broker.setDevicePermissions({device_id:'p111',mode:'invalid'}),/Invalid permission mode/);
 assert.throws(()=>f.broker.setDevicePermissions({device_id:'p111',mode:'full',bogus:true}),/Invalid permission arguments/);
 assert.equal(f.broker.devicePermissions({device_id:'p111'}).mode,'full');
});

test('saved custom policy survives reopening SQLite and is scoped per owner and device',t=>{
 const f=fixture(t);
 f.broker.setDevicePermissions({device_id:'p111',mode:'custom',allowed_tools:['cua_list_windows']});
 const readback=openStore(f.dir);
 assert.deepEqual(readback.devicePolicy('owner','p111').allowed_tools,['cua_list_windows']);
 assert.throws(()=>readback.devicePolicy('another','p111'),/not found/i);
 readback.db.prepare("INSERT INTO registry(id,owner,name,tokenHash) VALUES ('p222','owner','Other PC','test')").run();
 assert.equal(readback.devicePolicy('owner','p222').mode,'full');
 readback.close();
});

test('HTML MCP Apps component is web-only and invokes tools through the host bridge',()=>{
 const html=fs.readFileSync(path.join(root,'public','gui-permissions.html'),'utf8');
 assert.match(html,/ui\/initialize/);
 assert.match(html,/tools\/call/);
 assert.match(html,/get_device_permissions/);
 assert.match(html,/set_device_permissions/);
 assert.match(html,/Desktop Commander/);
 assert.match(html,/Cua Driver/);
 assert.doesNotMatch(html,/localhost:\d+/i);
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,'Expected inline MCP Apps JavaScript');
 assert.doesNotThrow(()=>new Function(script));
});

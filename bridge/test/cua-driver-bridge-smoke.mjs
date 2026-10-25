import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {McpToolManager} from '../agent/mcp-manager.mjs';

const fixture=fileURLToPath(new URL('./fixture-mcp.mjs',import.meta.url));
const driver=process.env.LOCALAPPDATA+'\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe';
const manager=new McpToolManager({
  Client,StdioClientTransport,
  backends:[
    {id:'desktop',command:process.execPath,args:[fixture],cwd:process.cwd(),env:{...process.env}},
    {id:'cua',prefix:'cua_',command:driver,args:['mcp'],cwd:process.cwd(),env:{...process.env},optional:true}
  ],
  log:(event,payload)=>console.log('EVENT='+event+' BACKEND='+payload.backend)
});
try{
  await manager.start();
  const names=manager.tools.map(t=>t.name);
  console.log('COMBINED_TOOL_COUNT='+names.length);
  console.log('DESKTOP_TOOL_PRESERVED='+names.includes('increment'));
  console.log('CUA_WINDOW_TOOL='+names.includes('cua_list_windows'));
  const res=await manager.callTool({name:'cua_list_windows',arguments:{}},undefined,{timeout:9000,maxTotalTimeout:9000});
  console.log('CUA_WINDOW_RESULT_OK='+(!res.isError));
  console.log('WINDOWS_HEADLINE='+String(res.content?.[0]?.text||'').split('\\n')[0].slice(0,220));
}catch(error){
  console.log('BRIDGE_SMOKE_ERROR='+String(error.message??error).slice(0,500));
  process.exitCode=1;
}finally{await manager.close().catch(()=>{});}

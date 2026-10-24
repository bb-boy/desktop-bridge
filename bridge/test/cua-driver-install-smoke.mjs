import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const binary = process.env.LOCALAPPDATA + '\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe';
const client = new Client({name:'desktop-bridge-install-smoke',version:'0.1'},{capabilities:{}});
const transport = new StdioClientTransport({command:binary,args:['mcp'],stderr:'pipe'});
try {
  await client.connect(transport, {timeout:10000});
  transport.stderr?.on('data',()=>{});
  const tools=[];
  let cursor;
  do {
    const response = await client.listTools(cursor ? {cursor} : {}, {timeout:10000});
    tools.push(...response.tools);
    cursor = response.nextCursor;
  } while(cursor);
  console.log('MCP_CONNECTED=true');
  console.log('MCP_TOOL_COUNT='+tools.length);
  console.log('HAS_GUI_TOOLS='+['list_windows','get_window_state','click'].every(name=>tools.some(t=>t.name===name)));
  const windows = await client.callTool({name:'list_windows',arguments:{}},undefined,{timeout:9000,maxTotalTimeout:9000});
  console.log('WINDOWS_CALL_ERROR='+!!windows.isError);
  console.log('WINDOWS_PREVIEW='+JSON.stringify(windows).slice(0,1600));
} catch(error) {
  console.log('MCP_SMOKE_FAILED='+String(error.message??error).slice(0,450));
  process.exitCode=1;
} finally {
  await client.close().catch(()=>{});
}

import fs from 'node:fs';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'increment',description:'Increment a test counter',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async()=>{
  let n=0;try{n=Number(fs.readFileSync('counter.txt','utf8'));}catch{}
  fs.writeFileSync('counter.txt',String(++n));
  return {content:[{type:'text',text:String(n)}]};
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>process.exit(0));

import fs from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server=new Server({name:'delayed-side-effect-fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'increment',description:'Increment, then delay the reply',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async()=>{
  let count=0;try{count=Number(fs.readFileSync('counter.txt','utf8'));}catch{}
  fs.writeFileSync('counter.txt',String(++count));
  await setTimeout(250);
  return {content:[{type:'text',text:String(count)}]};
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>process.exit(0));

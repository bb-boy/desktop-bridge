import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { openStore } from './store.mjs';
import { installOAuth } from './oauth.mjs';
import { Broker } from './broker.mjs';
import { createSessions, installManagement } from './management.mjs';
import { installGoogle } from './google.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function startServer(config,dependencies={}) {
  if(!config.baseUrl || !config.ownerPasswordHash || !Array.isArray(config.devices??[])) throw new Error('Missing server configuration');
  const base=new URL(config.baseUrl);
  if(base.pathname!=='/' || base.search || base.hash || base.username || base.password) throw new Error('baseUrl must be an origin');
  const app=express();
  app.disable('x-powered-by'); app.set('trust proxy','loopback');
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','no-referrer');
    res.set('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({limit:'1mb'}));
  app.use(express.urlencoded({extended:false,limit:'16kb'}));
  const loginLimiter=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
  const store=openStore(config.dataDir??path.join(root,'data'));
  store.migrate(config);
  const sessions=createSessions(config,store);
  const provider=installOAuth(app,config,store,loginLimiter,sessions);
  const httpServer=http.createServer(app);
  const broker=new Broker(httpServer,config,store);
  installManagement(app,config,store,broker,loginLimiter,sessions);
  installGoogle(app,config,store,sessions,loginLimiter,{fetch:dependencies.googleFetch});
  const auth=requireBearerAuth({verifier:provider,requiredScopes:['desktop'],expectedResource:new URL('/mcp',base),resourceMetadataUrl:new URL('/.well-known/oauth-protected-resource/mcp',base).href});
  app.get('/healthz',(_req,res)=>res.json({status:'ok',version:'0.2.0'}));
  app.get('/api/devices',auth,(req,res)=>res.json({devices:broker.devices(req.auth.extra.ownerId)}));
  app.use('/mcp',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false}));
  app.all('/mcp',auth,async(req,res)=>{
    if(req.method!=='POST') {res.set('Allow','POST'); return res.status(405).json({error:'Use Streamable HTTP POST'});}
    if(req.get('origin') && req.get('origin')!==base.origin && !['https://chatgpt.com','https://chat.openai.com'].includes(req.get('origin'))) return res.status(403).json({error:'Origin not allowed'});
    const owner=req.auth.extra.ownerId;
    const server=new Server({name:'personal-desktop-bridge',version:'0.2.0'},{capabilities:{tools:{}},instructions:'Use list_devices to identify available computers. Tools execute on the chosen computer. Check toolsAvailable separately from networkConnected. Use list_calls and get_call_result to recover results after interruptions. Never retry a side effect until its outcome is known.'});
    server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{
      name:'list_devices',description:'List your configured computers and their current connection status. Use before operating on a computer.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
    },{name:'list_calls',description:'List your last 100 task IDs and states. Use after a timeout or disconnect.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},{name:'get_call_result',description:'Retrieve a task status and saved result by call_id. Never repeats the operation.',inputSchema:{type:'object',properties:{call_id:{type:'string'}},required:['call_id'],additionalProperties:false},annotations:{readOnlyHint:true}},...broker.tools(owner)]}));
    server.setRequestHandler(CallToolRequestSchema,async(request)=>{
      await provider.verifyAccessToken(req.auth.token);
      if(request.params.name==='list_devices') return {content:[{type:'text',text:JSON.stringify(broker.devices(owner))}]};
      try {
        if(request.params.name==='list_calls')return {content:[{type:'text',text:JSON.stringify(store.recentCalls(owner))}]};
        if(request.params.name==='get_call_result'){const call=broker.recover(String(request.params.arguments?.call_id??''),owner);if(!call)throw new Error('Task not found');return {content:[{type:'text',text:JSON.stringify(call)}]};}
        return await broker.call(request.params.name,request.params.arguments,owner);
      }
      catch(e) {return {isError:true,content:[{type:'text',text:e.message}]};}
    });
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    let closed=false;
    res.on('close',()=>{if(!closed){closed=true;void server.close();}});
    try {await server.connect(transport); await transport.handleRequest(req,res,req.body);}
    catch {if(!res.headersSent) res.status(500).json({error:'MCP request failed'});}
  });
  app.use(express.static(path.join(root,'public'),{dotfiles:'deny',maxAge:0}));
  app.use((_req,res)=>res.status(404).json({error:'Not found'}));
  app.use((error,_req,res,_next)=>{
    console.error(JSON.stringify({event:'http_error',type:error.name}));
    if(!res.headersSent) res.status(error.status===413?413:400).json({error:'Invalid request'});
  });
  const cleanup=setInterval(()=>store.cleanup(),600000); cleanup.unref();
  store.cleanup();
  await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(config.port??8787,'127.0.0.1',resolve);});
  console.log(JSON.stringify({event:'listening',port:httpServer.address().port,origin:base.origin}));
  return {app,broker,store,provider,httpServer,async close(){clearInterval(cleanup);await broker.close();await new Promise(r=>httpServer.close(r));store.close();}};
}

if(process.argv[1] && fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))) {
  const filename=process.env.BRIDGE_CONFIG??path.join(root,'server-config.json');
  const config=JSON.parse(fs.readFileSync(filename,'utf8'));
  const running=await startServer(config);
  let stopping=false;
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{
    if(stopping)return;stopping=true;
    const watchdog=setTimeout(()=>process.exit(1),10000);watchdog.unref();
    await running.close();process.exit(0);
  });
}

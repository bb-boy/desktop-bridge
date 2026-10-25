import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { riskForTool,annotateTool } from './tool-risk.mjs';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { openStore } from './store.mjs';
import { installOAuth } from './oauth.mjs';
import {remoteTools,accountInfo,validateDeviceArgs} from './remote-tools.mjs';
import { Broker } from './broker.mjs';
import { createSessions, installManagement } from './management.mjs';
import { installGoogle } from './google.mjs';
import { installAdmin } from './admin.mjs';
import { installerDownload } from './downloads.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PERMISSION_UI_URI='ui://desktop-bridge/permissions-v1.html';
const PERMISSION_UI_MIME='text/html;profile=mcp-app';
const SCREENSHOT_UI_URI='ui://desktop-bridge/screenshot-v3.html';
const PREVIOUS_SCREENSHOT_UI_URI='ui://desktop-bridge/screenshot-v2.html';
const LEGACY_SCREENSHOT_UI_URI='ui://desktop-bridge/screenshot-v1.html';
const permissionsTool={
  name:'get_device_permissions',
  description:'Open a ChatGPT web permission panel to view and select Desktop Commander and Cua Driver permissions for your paired devices. All devices default to full access at the Desktop Bridge layer. This setting does not override ChatGPT or Windows security.',
  inputSchema:{type:'object',properties:{device_id:{type:'string',description:'Optional paired device ID'}},additionalProperties:false},
  annotations:riskForTool('get_device_permissions'),
  _meta:{ui:{resourceUri:PERMISSION_UI_URI}}
};
const setPermissionsTool={
  name:'set_device_permissions',
  description:'Save Desktop Bridge tool restrictions for a device owned by your account. Accepts full (default), read_only, or custom allowlist. This changes device authorization; it cannot bypass Cua or Windows permissions.',
  inputSchema:{type:'object',properties:{
    device_id:{type:'string'},mode:{type:'string',enum:['full','read_only','custom']},
    allowed_tools:{type:'array',items:{type:'string'},maxItems:128}
  },required:['device_id','mode'],additionalProperties:false},
  annotations:riskForTool('set_device_permissions'),
  _meta:{ui:{visibility:['app']}}
};
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
  installAdmin(app,store,broker,sessions);
  const auth=requireBearerAuth({verifier:provider,requiredScopes:['desktop'],expectedResource:new URL('/mcp',base),resourceMetadataUrl:new URL('/.well-known/oauth-protected-resource/mcp',base).href});
  app.get('/healthz',(_req,res)=>res.json({status:'ok',version:'0.2.6'}));
  app.get('/api/devices',auth,(req,res)=>res.json({devices:broker.devices(req.auth.extra.ownerId)}));
  app.use('/mcp',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false}));
  app.all('/mcp',auth,async(req,res)=>{
    if(req.method!=='POST') {res.set('Allow','POST'); return res.status(405).json({error:'Use Streamable HTTP POST'});}
    if(req.get('origin') && req.get('origin')!==base.origin && !['https://chatgpt.com','https://chat.openai.com'].includes(req.get('origin'))) return res.status(403).json({error:'Origin not allowed'});
    const owner=req.auth.extra.ownerId;
    const server=new Server({name:'personal-desktop-bridge',version:'0.2.6'},{capabilities:{tools:{},resources:{}},instructions:'Use list_devices to identify available computers. The standard tool catalog is available before pairing; visibility does not mean a device is ready. Tools execute on the chosen computer. Check toolsAvailable separately from networkConnected. Use list_calls and get_call_result to recover results after interruptions. Never retry a side effect until its outcome is known.'});
    server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{
      name:'list_devices',description:'List your configured computers and their current connection status. Use before operating on a computer.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:riskForTool('list_devices')
    },{name:'list_calls',description:'List your last 100 task IDs and states. Use after a timeout or disconnect.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:riskForTool('list_calls')},{name:'get_call_result',description:'Retrieve a task status and saved result by call_id. Never repeats the operation.',inputSchema:{type:'object',properties:{call_id:{type:'string'}},required:['call_id'],additionalProperties:false},annotations:riskForTool('get_call_result')},...remoteTools.map(annotateTool),permissionsTool,setPermissionsTool,...broker.tools(owner).map(tool=>tool.name==='cua_get_desktop_state'?{
      ...tool,_meta:{...(tool._meta??{}),ui:{...(tool._meta?.ui??{}),resourceUri:SCREENSHOT_UI_URI}}
    }:tool)]}));
    server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[
      {uri:PERMISSION_UI_URI,name:'Desktop Bridge device permissions',mimeType:PERMISSION_UI_MIME,description:'Device permission controls inside ChatGPT web chat'},
      {uri:SCREENSHOT_UI_URI,name:'Desktop Bridge desktop screenshot',mimeType:PERMISSION_UI_MIME,description:'Show a screenshot from a paired computer in ChatGPT'},
      {uri:LEGACY_SCREENSHOT_UI_URI,name:'Desktop Bridge desktop screenshot (legacy)',mimeType:PERMISSION_UI_MIME,description:'Compatible URL for previously displayed screenshots'},
      {uri:PREVIOUS_SCREENSHOT_UI_URI,name:'Desktop Bridge desktop screenshot (previous)',mimeType:PERMISSION_UI_MIME,description:'Compatible URL for previous screenshot widgets'}
    ]}));
    server.setRequestHandler(ReadResourceRequestSchema,async(request)=>{
      const uiFiles={
        [PERMISSION_UI_URI]:'gui-permissions.html',
        [SCREENSHOT_UI_URI]:'screenshot.html',
        [LEGACY_SCREENSHOT_UI_URI]:'screenshot.html',
        [PREVIOUS_SCREENSHOT_UI_URI]:'screenshot.html'
      };
      const filename=uiFiles[request.params.uri];
      if(!filename)throw new Error('Unknown UI resource');
      return {contents:[{uri:request.params.uri,mimeType:PERMISSION_UI_MIME,text:fs.readFileSync(path.join(root,'public',filename),'utf8')}]};
    });
    server.setRequestHandler(CallToolRequestSchema,async(request)=>{
      await provider.verifyAccessToken(req.auth.token);
      store.recordToolCall(owner);
      if(request.params.name==='list_devices') return {content:[{type:'text',text:JSON.stringify(broker.devices(owner))}]};
      if(request.params.name==='get_device_permissions'){
        try {const result=broker.devicePermissions(request.params.arguments??{},owner);return {content:[{type:'text',text:'Device permission settings loaded.'}],structuredContent:result};}
        catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
      }
      if(request.params.name==='set_device_permissions'){
        try {const result=broker.setDevicePermissions(request.params.arguments??{},owner);return {content:[{type:'text',text:'Device permissions saved.'}],structuredContent:result};}
        catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
      }
      try {
        if(request.params.name==='who_am_i')return {content:[{type:'text',text:JSON.stringify(accountInfo(store,broker,owner))}]};
        if(request.params.name==='ping')return {content:[{type:'text',text:JSON.stringify(await broker.ping(validateDeviceArgs(request.params.arguments),owner))}]};
        if(request.params.name==='shutdown')validateDeviceArgs(request.params.arguments);
        if(request.params.name==='list_calls')return {content:[{type:'text',text:JSON.stringify(store.recentCalls(owner))}]};
        if(request.params.name==='get_call_result'){const call=broker.recover(String(request.params.arguments?.call_id??''),owner);if(!call)throw new Error('Task not found');return {content:[{type:'text',text:JSON.stringify(call)}]};}
        const result=await broker.call(request.params.name,request.params.arguments,owner);
        // The host may omit image content when restoring a widget. Expose only the
        // owner-scoped task ID so the UI can recover the saved result without recapturing.
        if(request.params.name==='cua_get_desktop_state'&&!result.isError){
          const callId=result?._meta?.desktopBridge?.callId;
          if(typeof callId==='string')return {...result,structuredContent:{...(result.structuredContent??{}),desktopBridgeCallId:callId}};
        }
        return result;
      }
      catch(e) {return {isError:true,content:[{type:'text',text:e.message}]};}
    });
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    let closed=false;
    res.on('close',()=>{if(!closed){closed=true;void server.close();}});
    try {await server.connect(transport); await transport.handleRequest(req,res,req.body);}
    catch {if(!res.headersSent) res.status(500).json({error:'MCP request failed'});}
  });
  app.use('/downloads',installerDownload);
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

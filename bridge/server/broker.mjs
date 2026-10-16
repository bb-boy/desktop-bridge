import { randomUUID } from 'node:crypto';
import { WebSocketServer,WebSocket } from 'ws';
import { hash,opaque } from './security.mjs';
export const bridgeToolNames=new Set(['list_devices','list_calls','get_call_result']);
export class Broker {
  constructor(httpServer,config,store) {
    this.config=config;this.store=store;this.connections=new Map();this.pending=new Map();this.closing=false;
    this.wss=new WebSocketServer({noServer:true,maxPayload:10*1024*1024,perMessageDeflate:false});
    httpServer.on('upgrade',(req,socket,head)=>{
      const credential=(req.headers.authorization??'').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const digest=credential&&hash(credential);
      const device=digest&&store.db.prepare('SELECT * FROM registry WHERE revoked=0 AND paused=0 AND (tokenHash=? OR pendingHash=?)').get(digest,digest);
      if(new URL(req.url,'http://localhost').pathname!=='/agent'||!device||(req.headers.origin&&req.headers.origin!==new URL(config.baseUrl).origin))return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      if(this.connections.has(device.id))return socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
      if(this.closing)return socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      this.wss.handleUpgrade(req,socket,head,ws=>this.connect(device,ws,digest));
    });
    this.heartbeat=setInterval(()=>{
      for(const conn of this.connections.values()) {
        if(!this.authorized(conn)||!conn.alive){conn.ws.terminate();continue;}
        conn.alive=false;conn.ws.ping();
        if(conn.protocol>=2&&conn.ready)this.send(conn,{type:'health_check'});
      }
    },20000);this.heartbeat.unref();
  }
  connect(device,ws,credentialHash) {
    const conn={ws,device,alive:true,ready:false,protocol:1,healthOk:false,healthAt:0,connectedAt:new Date().toISOString()};
    this.connections.set(device.id,conn);
    const seen=()=>this.store.db.prepare('UPDATE registry SET lastSeen=? WHERE id=? AND owner=? AND revoked=0').run(Date.now(),device.id,device.owner);
    seen();
    const helloTimeout=setTimeout(()=>{if(!conn.ready)ws.close(1008,'Tool catalog required');},15000);
    ws.on('pong',()=>{conn.alive=true;seen();});ws.on('error',()=>{});
    ws.on('message',buffer=>{
      try {
        const m=JSON.parse(buffer.toString());
        if(m.type==='hello') {
          const registered=this.store.device(device.id);
          if(!this.authorized(conn)||![registered.tokenHash,registered.pendingHash].includes(credentialHash))throw new Error('Device authorization changed');
          if(conn.ready||m.deviceId!==device.id||!Array.isArray(m.tools)||m.tools.length>128)throw new Error('Invalid catalog');
          const names=new Set();
          const tools=m.tools.map(t=>{
            if(!/^[A-Za-z0-9_.-]{1,128}$/.test(t.name)||names.has(t.name)||bridgeToolNames.has(t.name)||t.inputSchema?.type!=='object')throw new Error('Invalid tool definition');
            names.add(t.name);return {name:t.name,description:String(t.description??'').slice(0,16000),inputSchema:t.inputSchema,...(t.annotations?{annotations:t.annotations}:{}),...(t.outputSchema?{outputSchema:t.outputSchema}:{})};
          });
          // A successful handshake with the pending key proves the client saved it.
          if(registered.pendingHash===credentialHash)this.store.db.prepare('UPDATE registry SET tokenHash=pendingHash,pendingHash=NULL WHERE id=? AND pendingHash=?').run(device.id,credentialHash);
          this.store.saveTools(device.id,tools,device.owner);conn.protocol=m.protocol===2?2:1;conn.ready=true;clearTimeout(helloTimeout);
          this.store.db.prepare('UPDATE registry SET version=?,platform=? WHERE id=?').run(String(m.version??'legacy').slice(0,40),String(m.platform??'unknown').slice(0,60),device.id);
          const recover=this.store.db.prepare("SELECT id FROM calls WHERE device=? AND owner=? AND status IN ('executing','awaiting_result','unknown') ORDER BY started DESC LIMIT 256").all(device.id,device.owner).map(r=>r.id);
          this.send(conn,{type:'welcome',heartbeatSeconds:20,...(conn.protocol>=2?{recover}:{} )});
          if(conn.protocol>=2){this.send(conn,{type:'health_check'});const d=this.store.device(device.id);if(d.pendingHash){const token=opaque();this.store.db.prepare('UPDATE registry SET pendingHash=? WHERE id=?').run(hash(token),device.id);this.send(conn,{type:'rotate',token});}}
        } else if(m.type==='health'&&conn.ready&&conn.protocol>=2) {
          conn.healthOk=m.ok===true;conn.healthAt=Date.now();seen();
        } else if(m.type==='rotate_ack'&&conn.ready&&conn.protocol>=2) {
          const d=this.store.device(device.id);
          if(this.authorized(conn)&&d?.pendingHash&&m.tokenHash===d.pendingHash)this.store.db.prepare('UPDATE registry SET tokenHash=pendingHash,pendingHash=NULL WHERE id=?').run(device.id);
        } else if(m.type==='result'&&conn.ready) {
          const registered=this.store.device(device.id);
          if(!registered||registered.owner!==device.owner||this.connections.get(device.id)!==conn)return;
          const row=this.store.call(String(m.id),device.owner);
          if(!row||row.device!==device.id)return;
          // Only fill uncertain outcomes. Repeated result delivery is idempotent.
          if(['completed','failed'].includes(row.status))return;
          if(m.status==='executing'){this.store.db.prepare("UPDATE calls SET status='executing' WHERE id=?").run(m.id);return;}
          let result=null,error=null,status;
          if(m.error){error=String(m.error).slice(0,1000);status=m.status==='unknown'?'unknown':'failed';}
          else if(m.result&&Array.isArray(m.result.content)){result=m.result;status=result.isError?'failed':'completed';}
          else throw new Error('Invalid device result');
          this.store.finishCall(m.id,status,result,error);
          this.settle(m.id,result,error);
        } else throw new Error('Unsupported message');
      } catch(error){console.error(JSON.stringify({event:'device_protocol_error',device:device.id,message:String(error.message).slice(0,200)}));ws.close(1008,'Invalid agent message');}
    });
    ws.on('close',()=>{
      clearTimeout(helloTimeout);seen();
      if(this.connections.get(device.id)===conn)this.connections.delete(device.id);
      for(const [id,call]of this.pending)if(call.connection===conn)this.uncertain(id,'设备连接已断开，任务可能仍在执行。重连后用 get_call_result 查询结果，请勿重复执行。');
    });
  }
  authorized(conn) {
    const device=this.store.device(conn.device.id);
    return !!device&&!device.paused&&device.owner===conn.device.owner&&this.connections.get(device.id)===conn;
  }
  send(conn,message,onError=()=>{}) {
    if(conn.ws.readyState!==WebSocket.OPEN){onError(new Error('Device disconnected'));return false;}
    try {conn.ws.send(JSON.stringify(message),error=>{if(error)onError(error);});return true;}
    catch(error){onError(error);return false;}
  }
  settle(id,result,error) {
    const pending=this.pending.get(id);
    if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(id);
    pending.resolve(this.envelope(id,result,error));
  }
  uncertain(id,message) {
    if(!this.pending.has(id))return;
    this.store.finishCall(id,'awaiting_result');
    this.settle(id,null,message);
  }
  disconnect(id,reason){this.connections.get(id)?.ws.close(1008,reason);}
  devices(owner='owner') {
    return this.store.devices(owner).map(d=>{
      const candidate=this.connections.get(d.id),c=candidate?.device.owner===d.owner?candidate:undefined;
      const networkConnected=!!c?.ready&&c.ws.readyState===WebSocket.OPEN;
      const fresh=!!c?.healthAt&&Date.now()-c.healthAt<(this.config.healthStaleMs??50000);
      const toolsAvailable=networkConnected&&fresh&&c.healthOk&&!d.paused;
      return {id:d.id,name:d.name,online:networkConnected,networkConnected,toolsAvailable,health:d.paused?'paused':!networkConnected?'offline':!fresh?'unverified':c.healthOk?'ready':'local_unavailable',clientVersion:d.version,lastSeen:d.lastSeen,platform:d.platform,paused:!!d.paused,rotationPending:!!d.pendingHash,connectedAt:c?.connectedAt??null};
    });
  }
  tools(owner='owner') {
    const catalog=new Map();
    for(const device of this.store.devices(owner))for(const tool of this.store.tools(device.id,owner))if(!catalog.has(tool.name)&&!bridgeToolNames.has(tool.name))catalog.set(tool.name,{
      ...tool,description:tool.description+'\nRuns on your paired computer. Check list_devices.toolsAvailable. Every sent call has a task ID; use get_call_result after interruption before retrying.',
      inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,device_id:{type:'string',description:'Device ID from list_devices. Optional with one device.'}}}
    });return [...catalog.values()];
  }
  recover(id,owner) {
    const call=this.store.call(id,owner);
    if(call&&['unknown','awaiting_result','executing'].includes(call.status)) {
      const conn=this.connections.get(call.device);
      if(conn?.ready&&conn.protocol>=2&&conn.device.owner===owner&&this.authorized(conn))this.send(conn,{type:'recover',ids:[id]});
    }
    return call;
  }
  envelope(id,result,error) {
    return {...(result??{isError:true,content:[{type:'text',text:error??'结果未知，请查询任务状态。'}]}),_meta:{...(result?._meta??{}),desktopBridge:{callId:id}},content:[...(result?.content??[{type:'text',text:error??'结果未知，请查询任务状态。'}]),{type:'text',text:'任务编号: '+id+'；可用 get_call_result 查询。'}]};
  }
  async call(name,args={},owner='owner') {
    if(this.closing)throw new Error('Relay is stopping; no command was sent.');
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Tool arguments must be an object');
    const devices=this.store.devices(owner),deviceId=args.device_id??(devices.length===1?devices[0].id:undefined);
    const device=devices.find(d=>d.id===deviceId);
    if(!device)throw new Error('Unknown device. Call list_devices first.');
    const conn=this.connections.get(device.id);
    if(device.paused)throw new Error('设备已暂停，没有发送命令。');
    if(!conn?.ready||!this.authorized(conn)||conn.ws.readyState!==WebSocket.OPEN)throw new Error('Device is offline; no command was sent.');
    if(!this.devices(owner).find(d=>d.id===deviceId).toolsAvailable)throw new Error('网络已连接，但本地工具尚未通过健康检查；没有发送命令。请更新或检查客户端。');
    if(!this.store.tools(device.id,owner).some(t=>t.name===name))throw new Error('Unknown device tool');
    if([...this.pending.values()].filter(c=>c.deviceId===deviceId).length>=4)throw new Error('Device is busy; wait for existing calls.');
    const id=randomUUID(),toolArgs={...args};delete toolArgs.device_id;
    this.store.beginCall(id,deviceId,name,owner);
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.uncertain(id,'等待已结束，任务可能仍在执行。请用 get_call_result 查询，勿重复执行。'),this.config.callTimeoutMs??25000);
      this.pending.set(id,{deviceId,connection:conn,resolve,timer});
      this.send(conn,{type:'call',id,name,arguments:toolArgs},()=>this.uncertain(id,'发送时设备连接中断，任务结果未知。请用 get_call_result 查询，勿重复执行。'));
    });
  }
  async close() {
    this.closing=true;clearInterval(this.heartbeat);
    for(const id of this.pending.keys())this.uncertain(id,'服务正在重启，任务可能仍在执行。请用 get_call_result 查询，勿重复执行。');
    for(const c of this.connections.values())c.ws.terminate();
    await new Promise(r=>this.wss.close(r));
  }
}

import {opaque,hash} from './security.mjs';

function pictureFor(store,owner,id){
  const call=store.call(id,owner);
  const device=call&&store.device(call.device);
  if(!call||call.status!=='completed'||!device||device.owner!==owner)return null;
  const image=call.result?.content?.find(c=>c.type==='image'&&['image/png','image/jpeg','image/webp'].includes(c.mimeType)&&typeof c.data==='string');
  return image&&image.data.length<=12*1024*1024?image:null;
}

export function issueScreenshot(store,base,auth,id){
  const sourceHash=hash(auth.token),grant=store.grant(sourceHash,'access');
  if(!grant||grant.ownerId!==auth.extra.ownerId||!pictureFor(store,grant.ownerId,id))throw new Error('Screenshot unavailable');
  const token=opaque();
  const source=store.db.prepare('SELECT expires FROM grants WHERE hash=?').get(sourceHash);
  const expiresAt=Math.min(Date.now()+300000,source.expires);
  store.saveGrant(hash(token),'screenshot',grant.clientId,{ownerId:grant.ownerId,callId:id,sourceHash,family:grant.family},expiresAt);
  return {url:new URL('/api/screenshots/'+encodeURIComponent(id),base).href,token,expiresAt};
}

export function installScreenshotDelivery(app,store){
  const cors=(req,res,next)=>{
    res.set('Access-Control-Allow-Origin','*');
    res.set('Access-Control-Allow-Headers','Authorization');
    res.set('Access-Control-Allow-Methods','GET, OPTIONS');
    res.set('Cache-Control','no-store');
    res.set('Cross-Origin-Resource-Policy','cross-origin');
    next();
  };
  app.options('/api/screenshots/:id',cors,(_req,res)=>res.status(204).end());
  app.get('/api/screenshots/:id',cors,(req,res)=>{
    res.on('finish',()=>console.log(JSON.stringify({event:'screenshot_fetch',
      taskId:/^[0-9a-f-]{36}$/i.test(req.params.id)?req.params.id:null,
      status:res.statusCode,bytes:Number(res.getHeader('content-length')??0)})));
    const token=req.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const grant=token&&store.grant(hash(token),'screenshot');
    const source=grant&&store.grant(grant.sourceHash,'access');
    if(!grant||grant.callId!==req.params.id||source?.ownerId!==grant.ownerId||!store.accountById(grant.ownerId))return res.status(404).end();
    const image=pictureFor(store,grant.ownerId,grant.callId);
    if(!image)return res.status(404).end();
    res.type(image.mimeType).send(Buffer.from(image.data,'base64'));
  });
}

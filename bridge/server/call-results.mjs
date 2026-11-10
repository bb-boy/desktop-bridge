// A saved MCP result must not turn binary content into model-visible JSON text.
// Keep the task-record JSON for existing text consumers, with binary descriptors
// in place of data, and return the original binary blocks as native MCP content.
export function savedCallResult(call,delivery='model',screenshot){
  const result=call.result;
  const binaries=(result?.content??[]).filter(item=>['image','audio'].includes(item.type));
  const {_meta:privateMeta,...publicResult}=result??{};
  const record={...call,result:result?{...publicResult,content:(result.content??[]).map(item=>
    ['image','audio'].includes(item.type)?{type:item.type,mimeType:item.mimeType,dataOmitted:true}:item
  )}:null};
  return deliverImages({content:[{type:'text',text:JSON.stringify(record)},...binaries]},delivery,screenshot);
}

// Display-only captures are private widget data. A model must explicitly ask for
// native image content when it needs to inspect the screen or choose coordinates.
export function deliverImages(result,delivery='ui',screenshot){
  if(!['ui','model'].includes(delivery))throw new Error('image_delivery must be ui or model');
  if(delivery==='model')return result;
  const images=(result.content??[]).filter(item=>item.type==='image');
  if(!images.length)return result;
  if(!screenshot)throw new Error('Screenshot delivery descriptor required');
  return {...result,content:result.content.filter(item=>item.type!=='image'),
    _meta:{...(result._meta??{}),desktopBridge:{...(result._meta?.desktopBridge??{}),screenshot}}};
}

export function resultDiagnostics(tool,result,taskId,started,error){
  const content=result?.content??[];
  return {event:'mcp_tool_result',tool:String(tool).slice(0,128),
    taskId:typeof taskId==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskId)?taskId:null,
    elapsedMs:Date.now()-started,isError:!!(error||result?.isError),
    textChars:content.reduce((n,item)=>n+(item.type==='text'?item.text.length:0),0),
    imageCount:content.filter(item=>item.type==='image').length,
    imageDataChars:content.reduce((n,item)=>n+(item.type==='image'?item.data.length:0),0),
    widgetImageCount:result?._meta?.desktopBridge?.images?.length??0,
    hasImageDelivery:!!result?._meta?.desktopBridge?.screenshot,
    widgetImageDataChars:(result?._meta?.desktopBridge?.images??[]).reduce((n,item)=>n+item.data.length,0),
    structuredChars:JSON.stringify(result?.structuredContent??{}).length,
    metaChars:JSON.stringify(result?._meta??{}).length,
    ...(error?{errorType:error.name}:{} )};
}

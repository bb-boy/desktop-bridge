import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {McpToolManager} from '../agent/mcp-manager.mjs';

const driver=process.env.LOCALAPPDATA+'\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe';
const fixture=fileURLToPath(new URL('./fixture-mcp.mjs',import.meta.url));
const manager=new McpToolManager({
 Client,StdioClientTransport,
 backends:[
  {id:'desktop',command:process.execPath,args:[fixture],cwd:process.cwd(),env:{...process.env}},
  {id:'cua',command:driver,args:['mcp'],cwd:process.cwd(),env:{...process.env},prefix:'cua_',optional:false}
 ]
});
const session='desktop-bridge-calculator-smoke';
async function cua(name,args) {
 const result=await manager.callTool({name:'cua_'+name,arguments:args},undefined,{timeout:18000,maxTotalTimeout:18000});
 if(result.isError||result.structuredContent?.status==='refused')throw new Error(name+' refused: '+String(result.content?.[0]?.text??JSON.stringify(result.structuredContent)).slice(0,1000));
 return result.structuredContent??result;
}
function indexFor(tree,id) {
 const pattern=new RegExp('\\[([0-9]+)\\] Button [^\\n]*\\[id='+id+'(?: |\\])');
 const found=tree.match(pattern);
 if(!found)throw new Error('Calculator UI element not found: '+id);
 return Number(found[1]);
}
try {
 await manager.start();
 console.log('DRIVER_VIA_DESKTOP_BRIDGE=true');
 const launch=await cua('launch_app',{aumid:'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',session});
 const pid=launch.pid;
 const window_id=launch.windows?.find(w=>w.title?.includes('计算器')||w.title?.includes('Calculator'))?.window_id??launch.windows?.[0]?.window_id;
 assert.ok(pid&&window_id,'Calculator PID/window not returned');
 console.log('CALCULATOR_READY=true');
 async function read(){return await cua('get_window_state',{pid,window_id,include_screenshot:false,max_elements:160,session});}
 async function clickButton(id){
  const state=await read();
  const index=indexFor(state.tree_markdown,id);
  const receipt=await cua('click',{target:{kind:'window',pid,window_id},element_token:state.snapshot_id+':'+index,delivery_mode:'background',session});
  console.log('CLICK='+id+' RECEIPT='+JSON.stringify(receipt).slice(0,170));
 }
 await clickButton('clearButton');
 await clickButton('num6Button');
 await clickButton('multiplyButton');
 await clickButton('num7Button');
 await clickButton('equalButton');
 const final=await read();
 const line=final.tree_markdown.split('\n').find(row=>row.includes('CalculatorResults'))??'';
 console.log('RESULT_LINE='+line.trim());
 assert.match(line,/显示为 42|Display is 42|Displays 42|42/,'Expected Calculator UI to show 42');
 const capture=await manager.callTool({
  name:'cua_get_window_state',
  arguments:{pid,window_id,include_accessibility_tree:false,include_screenshot:true,max_image_dimension:800,display_only:true,session}
 },undefined,{timeout:18000,maxTotalTimeout:18000});
 const images=(capture.content??[]).filter(item=>item.type==='image');
 const bytes=images.reduce((sum,item)=>sum+Math.ceil((item.data?.length??0)*3/4),0);
 console.log('WINDOW_SCREENSHOT_IMAGE_COUNT='+images.length);
 console.log('WINDOW_SCREENSHOT_BYTES='+bytes);
 assert.ok(!capture.isError&&images.length>0&&bytes>0,'Expected screenshot image through MCP');
 assert.ok(bytes < 8*1024*1024,'Screenshot exceeds bridge size bound');
 console.log('CALCULATOR_E2E_PASS=true');
} catch(error) {
 console.error('CALCULATOR_E2E_FAIL='+String(error.stack??error).slice(0,1400));
 process.exitCode=1;
} finally {await manager.close().catch(()=>{});}

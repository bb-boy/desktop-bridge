import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {run} from './lifecycle.mjs';
export function capture(command,args,{timeout=15000,...options}={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(path.basename(command)+' 检查超时'));},timeout);
  child.stdout.on('data',chunk=>{if(stdout.length<65536)stdout+=chunk;});child.stderr.on('data',chunk=>{if(stderr.length<65536)stderr+=chunk;});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve(stdout.trim()):reject(new Error(path.basename(command)+' 检查失败 ('+(signal??code)+'): '+stderr.slice(0,300)));});
 });
}
export async function runtimeReady(node,npm) {
 try{return await capture(node,['--version'])==='v24.19.0'&&/^\d+\.\d+\.\d+$/.test(await capture(node,[npm,'--version']));}catch{return false;}
}
export async function ensureRuntime(root,source,{runtimeSource=process.platform==='win32'?path.dirname(process.execPath):path.dirname(path.dirname(process.execPath))}={}) {
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'node-runtime.json'),'utf8'));
 const runtime=path.join(root,'runtime',`node-v${manifest.version}-${process.platform}-${process.arch}`);
 const node=path.join(runtime,process.platform==='win32'?'node.exe':'bin/node');
 const npm=path.join(runtime,process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'lib/node_modules/npm/bin/npm-cli.js');
 if(await runtimeReady(node,npm)){console.log('环境检查：私有 Node.js / npm 正常。');return {runtime,node,npm};}
 console.log('环境检查：正在自动补齐私有 Node.js / npm，不修改系统环境。');
 const sourceNode=path.join(runtimeSource,process.platform==='win32'?'node.exe':'bin/node');
 const sourceNpm=path.join(runtimeSource,process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'lib/node_modules/npm/bin/npm-cli.js');
 const same=fs.existsSync(runtime)&&fs.realpathSync(runtimeSource)===fs.realpathSync(runtime);
 if(!same&&await runtimeReady(sourceNode,sourceNpm)){
  fs.mkdirSync(path.dirname(runtime),{recursive:true,mode:0o700});fs.cpSync(runtimeSource,runtime,{recursive:true,force:true,verbatimSymlinks:true});
 }else{
  const key=(process.platform==='win32'?'win':process.platform)+'-'+process.arch,target=manifest.platforms[key];
  if(!target)throw new Error('不支持的系统或处理器：'+key);
  const temporary=fs.mkdtempSync(path.join(root,'.runtime-repair-'));
  try{
   const archive=path.join(temporary,target.filename),url=`https://nodejs.org/dist/v${manifest.version}/${target.filename}`;
   const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok||!response.body)throw new Error('官方下载失败 HTTP '+response.status);
   await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(archive,{mode:0o600}));
   const hash=createHash('sha256');for await(const data of fs.createReadStream(archive))hash.update(data);
   if(hash.digest('hex')!==target.sha256)throw new Error('Node.js 官方运行环境校验失败，请检查网络后重试。');
   if(process.platform==='win32'){
    const ps=value=>"'"+value.replace(/'/g,"''")+"'";
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${ps(archive)} -DestinationPath ${ps(temporary)} -Force`]);
   }else await run('tar',['-xzf',archive,'-C',temporary]);
   const extracted=path.join(temporary,target.filename.replace(/\.zip$|\.tar\.gz$/,''));
   fs.mkdirSync(path.dirname(runtime),{recursive:true,mode:0o700});
   const activeNode=process.platform==='win32'&&fs.existsSync(node)&&fs.realpathSync(node)===fs.realpathSync(process.execPath);
   fs.cpSync(extracted,runtime,{recursive:true,force:true,verbatimSymlinks:true,filter:file=>!activeNode||path.resolve(file)!==path.join(extracted,'node.exe')});
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 }
 if(!await runtimeReady(node,npm))throw new Error('无法准备私有 Node.js/npm。请检查可写权限与 nodejs.org 网络访问后重试。');
 return {runtime,node,npm};
}
export async function probeModules(release) {
 const require=createRequire(path.join(release,'package.json'));
 const entry=path.join(release,'node_modules','@wonderwhy-er','desktop-commander','dist','index.js');if(!fs.existsSync(entry))throw new Error('Desktop Commander 入口缺失');
 for(const name of ['@modelcontextprotocol/sdk/client/index.js','@modelcontextprotocol/sdk/client/stdio.js','ws','@vscode/ripgrep'])if(!fs.existsSync(require.resolve(name)))throw new Error(name+' 文件缺失');
 const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
 const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
 const WebSocket=require('ws');if(typeof Client!=='function'||typeof StdioClientTransport!=='function'||typeof WebSocket!=='function')throw new Error('SDK/WebSocket 依赖异常');
 const {rgPath}=await import(pathToFileURL(require.resolve('@vscode/ripgrep')));
 if(!/^ripgrep\s/.test(await capture(rgPath,['--version'])))throw new Error('平台搜索工具 ripgrep 不可执行');
 return {Client,StdioClientTransport,entry};
}
export async function prepareDependencies({node,npm,release,force=false}) {
 const hash=createHash('sha256').update(fs.readFileSync(path.join(release,'package.json'))).update(fs.readFileSync(path.join(release,'package-lock.json'))).digest('hex');
 const marker=path.join(release,'.dependencies.sha256');let previous;try{previous=fs.readFileSync(marker,'utf8');}catch{}
 let needsInstall=force||hash!==previous;
 if(!needsInstall)try{await probeDependencyProcess(node,release);}catch{needsInstall=true;}
 if(needsInstall){
  console.log('环境检查：自动安装或修复本地工具依赖，首次运行需要联网……');
  try{await run(node,[npm,'ci','--omit=dev','--ignore-scripts','--no-fund','--no-audit'],{cwd:release,env:{...process.env,PATH:path.dirname(node)+path.delimiter+(process.env.PATH??'')}});}
  catch{throw new Error('依赖自动安装失败。请确认安装目录可写，并能访问 registry.npmjs.org，然后重试。');}
 }
 await probeDependencyProcess(node,release);fs.writeFileSync(marker,hash,{mode:0o600});
 console.log('环境检查：SDK、WebSocket、Desktop Commander 和本机搜索工具正常。');
 return {installed:needsInstall};
}
const probePath=fileURLToPath(new URL('./environment-probe.mjs',import.meta.url));
async function probeDependencyProcess(node,release){await capture(node,[probePath,'dependencies',release],{timeout:30000});}
export async function verifyLocalTools({node,release,workingDirectory}){
 const output=await capture(node,[probePath,'tools',release,workingDirectory],{timeout:70000});console.log(output);return Number(output.match(/(\d+) 个工具/)?.[1]);
}
export async function verifyLocalToolsInProcess({node,release,workingDirectory}) {
 console.log('正在验证本地工具可以实际执行……');
 const {Client,StdioClientTransport,entry}=await probeModules(release);
 const client=new Client({name:'desktop-bridge-install-check',version:'0.2.2'},{capabilities:{}});
 const transport=new StdioClientTransport({command:node,args:[entry],cwd:workingDirectory,stderr:'pipe'});
 try{
  const connecting=client.connect(transport,{timeout:30000});transport.stderr?.on('data',()=>{});await connecting;
  const listed=await client.listTools({}, {timeout:15000});if(!listed.tools.length)throw new Error('本地工具列表为空');
  const probe=listed.tools.find(tool=>['get_config','list_sessions'].includes(tool.name));if(!probe)throw new Error('本地工具缺少安全健康检查接口');
  const result=await client.callTool({name:probe.name,arguments:{}},undefined,{timeout:15000});if(result.isError)throw new Error('本地工具执行检查未通过');
  console.log('本地工具验证通过：'+listed.tools.length+' 个工具，实际调用正常。');return listed.tools.length;
 }finally{await client.close();}
}

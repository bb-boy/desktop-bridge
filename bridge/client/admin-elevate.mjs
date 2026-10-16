// The only user-facing elevation helper. Never elevates without a requested action.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {protectedRoot} from './admin-runtime.mjs';
const folder=path.dirname(fileURLToPath(import.meta.url));
export function psQuote(s){return "'"+String(s).replace(/'/g,"''")+"'";}
export function elevationRequest(action,{source,mode,purge=false,root=protectedRoot(),platform=process.platform}={}) {
  if(!['install','start','stop','status','mode','uninstall'].includes(action))throw new Error('Unknown administrator action.');
  if(action==='install'&&(!source||!['manual','background'].includes(mode)))throw new Error('Installation needs a paired source and an explicit mode.');
  if(action==='mode'&&!['manual','background'].includes(mode))throw new Error('Mode must be manual or background.');
  if(purge&&action!=='uninstall')throw new Error('--purge requires uninstall.');
  const installer=action==='install'?path.join(source,'admin-service.mjs'):path.join(root,'admin-service.mjs');
  const node=action==='install'?process.execPath:JSON.parse(fs.readFileSync(path.join(root,'launch.json'),'utf8')).node;
  // launch.json uses the original private node when installed by a normal user,
  // so for privileged operations always choose the copy inside the protected root.
  let safeNode=node;
  if(action!=='install') {
    const entries=fs.readdirSync(path.join(root,'runtime')).filter(x=>/^node-v24\./.test(x));
    if(entries.length!==1)throw new Error('Cannot resolve a single protected Node runtime.');
    safeNode=path.join(root,'runtime',entries[0],platform==='win32'?'node.exe':'bin/node');
  }
  const args=[installer,action];
  if(action==='install')args.push(source,mode);
  if(action==='mode')args.push(mode);
  if(purge)args.push('--purge');
  if(platform==='win32') {
    // Windows UAC is shown through the OS; exit code is propagated to the caller.
    const windowsArg=x=>'"'+String(x).replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
    const list=psQuote(args.map(windowsArg).join(' '));
    const script='$ErrorActionPreference="Stop"; $p=Start-Process -FilePath '+psQuote(safeNode)+
      ' -ArgumentList '+list+' -Verb RunAs -Wait -PassThru; exit $p.ExitCode';
    return {command:'powershell.exe',args:['-NoProfile','-Command',script]};
  }
  if(!['darwin','linux'].includes(platform))throw new Error('Unsupported platform.');
  return {command:'sudo',args:['--',safeNode,...args]};
}
function run(command,args) {
 return new Promise((resolve,reject)=>{
   const child=spawn(command,args,{stdio:'inherit'});
   child.once('error',reject);
   child.once('exit',(code,signal)=>code===0?resolve():reject(new Error('Administrator authorization or operation failed: '+(signal??code))));
 });
}
const argv=process.argv.slice(2);
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,...args]=argv;
 const opts=action==='install'?{source:args[0],mode:args[1]}:action==='mode'?{mode:args[0]}:action==='uninstall'?{purge:args[0]==='--purge'}:{};
 if((action==='install'&&args.length!==2)||(action==='mode'&&args.length!==1)||(action==='uninstall'&&args.length>1)||(action!=='install'&&action!=='mode'&&action!=='uninstall'&&args.length))throw new Error('Unexpected administrative arguments.');
 const request=elevationRequest(action,opts);
 console.log('Administrator authorization will be requested by the operating system. This does not grant Google, ChatGPT or macOS privacy permissions.');
 await run(request.command,request.args);
}

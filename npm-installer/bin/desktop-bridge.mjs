#!/usr/bin/env node
/** CLI does not start a service during npm install; explicit setup is required. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const clientRoot=path.join(packageRoot,'dist','client');
const installer=path.join(clientRoot,'install.mjs');
const controller=path.join(clientRoot,'control.mjs');
const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
const commands=new Set(['setup','start','stop','restart','status','pair','mode','repair','uninstall']);

export function clientDataRoot(platform=process.platform,env=process.env,home=os.homedir()){
  return platform==='win32'?path.win32.join(env.LOCALAPPDATA??path.win32.join(home,'AppData','Local'),'DesktopBridgeClient')
    :platform==='darwin'?path.posix.join(home,'Library','Application Support','DesktopBridge')
      :path.posix.join(env.XDG_DATA_HOME??path.posix.join(home,'.local','share'),'desktop-bridge');
}

export function parse(argv){
  const [command='help',...args]=argv;
  if(['help','--help','-h'].includes(command))return {command:'help'};
  if(['version','--version','-v'].includes(command))return {command:'version'};
  if(!commands.has(command))throw new Error('Unknown command: '+command);
  let customRoot;
  const remainder=[];
  for(let i=0;i<args.length;i++){
    if(args[i]==='--root'){
      const value=args[++i];
      if(!value||value.startsWith('--')||customRoot)throw new Error('--root requires exactly one directory');
      customRoot=path.resolve(value);
    }else remainder.push(args[i]);
  }
  const control=['start','stop','status','pair','mode','restart'].includes(command);
  if(control){
    if(command==='mode'){
      if(remainder.length!==1||!['manual','background'].includes(remainder[0]))throw new Error('Usage: desktop-bridge mode manual|background');
    }else if(remainder.length)throw new Error(command+' does not accept extra arguments');
  }else if(command==='uninstall'){
    if(remainder.some(x=>x!=='--purge')||remainder.filter(x=>x==='--purge').length>1)throw new Error('Usage: desktop-bridge uninstall [--purge]');
  }else if(command==='repair'){
    if(remainder.length)throw new Error('Usage: desktop-bridge repair [--root directory]');
  }else{
    for(let i=0;i<remainder.length;i++){
      const a=remainder[i];
      if(a==='--mode'){
        if(!['manual','background'].includes(remainder[++i]))throw new Error('Use --mode manual or --mode background');
      }else if(!['--administrator','--no-browser','--no-start'].includes(a))throw new Error('Unknown setup option: '+a);
    }
  }
  return {command,args:remainder,root:customRoot};
}

function usage(){
  return 'Desktop Bridge '+manifest.version+'\n\n'+
    'Usage: desktop-bridge <command> [options]\n\n'+
    '  setup [--mode manual|background] [--administrator]  Install and pair\n'+
    '  start | stop | restart                           Manage local agent\n'+
    '  status                                           Show local connection status\n'+
    '  pair                                             Re-pair in your browser\n'+
    '  mode manual|background                           Change startup mode\n'+
    '  repair                                           Repair (re-pairs in browser)\n'+
    '  uninstall [--purge]                              Remove local agent\n'+
    '  version | help                                   Show CLI info\n\n'+
    'All commands except help/version accept --root <directory>.\n'+
    'No service is installed automatically by npm install.\n'+
    'npm update -g '+manifest.name+' updates the CLI; run setup to apply the client release.\n'+
    'Device unlink/revocation: https://mcp.ilovestudy.de/start.html\n';
}

async function childRun(script,args){
  if(!fs.existsSync(script))throw new Error('Packaged client is missing. Reinstall the npm package.');
  const child=spawn(process.execPath,[script,...args],{stdio:'inherit',windowsHide:false});
  return await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>resolve(signal?128:code??1));
  });
}

export async function main(argv=process.argv.slice(2)){
  const parsed=parse(argv);
  if(parsed.command==='help'){console.log(usage());return 0;}
  if(parsed.command==='version'){console.log(manifest.version);return 0;}
  if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Desktop Bridge needs Node.js 24. Install Node.js 24 before using this CLI.');
  const root=parsed.root??clientDataRoot();
  const rootArgs=parsed.root?['--root',root]:[];
  if(parsed.command==='setup')return childRun(installer,[...parsed.args,...rootArgs]);
  if(!fs.existsSync(path.join(root,'launch.json')))throw new Error('Client is not installed at '+root+'. Run desktop-bridge setup first.');
  if(parsed.command==='repair'){
    console.log('Repair also requires browser re-pairing approval.');
    return childRun(installer,['--repair',...rootArgs]);
  }
  if(parsed.command==='uninstall'){
    const status=await childRun(installer,['--uninstall',...parsed.args,...rootArgs]);
    if(status===0)console.log('To also remove the npm CLI: npm uninstall -g '+manifest.name);
    return status;
  }
  if(parsed.command==='restart'){
    const status=await childRun(controller,['stop',...rootArgs]);
    return status===0?childRun(controller,['start',...rootArgs]):status;
  }
  return childRun(controller,[parsed.command,...parsed.args,...rootArgs]);
}
if(process.argv[1]&&fs.realpathSync(path.resolve(process.argv[1]))===fs.realpathSync(fileURLToPath(import.meta.url))){
  main().then(code=>{process.exitCode=code;},error=>{
    console.error('Desktop Bridge:',error.message);
    process.exitCode=1;
  });
}

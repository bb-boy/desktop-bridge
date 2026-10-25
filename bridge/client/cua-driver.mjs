/** Install the pinned, upstream-signed Cua Driver separately from the npm CLI.
 * A checksum-pinned official release installer verifies its own downloaded
 * release artifacts. Never run a mutable curl|shell URL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {capture} from './environment.mjs';
import {run} from './lifecycle.mjs';

export const CUA_VERSION='0.38.0';
const RELEASE='https://github.com/trycua/cua/releases/download/cua-driver-rs-v'+CUA_VERSION+'/';
const INSTALLERS={
  win32:{file:'install.ps1',sha256:'31ff35434433d511457bac9638d568a7151a517bc613f478c29d52670a307727'},
  darwin:{file:'_install-rust.sh',sha256:'0be0bd269056a7c0c5b15e77ff6c64c880267d091957c97efc19103380e4aeb7'},
  linux:{file:'_install-rust.sh',sha256:'0be0bd269056a7c0c5b15e77ff6c64c880267d091957c97efc19103380e4aeb7'}
};
export function installedDriverPath(platform=process.platform,env=process.env,home=os.homedir()){
  return platform==='win32'
    ? path.win32.join(env.LOCALAPPDATA??path.win32.join(home,'AppData','Local'),'Programs','Cua','cua-driver','bin','cua-driver.exe')
    : path.posix.join(home,'.local','bin','cua-driver');
}
function semver(value){
  const m=String(value).match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  return m?[+m[1],+m[2],+m[3]]:null;
}
export function acceptableVersion(actual,required=CUA_VERSION){
  const a=semver(actual),b=semver(required);
  if(!a||!b)return false;
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}
  return true;
}
async function verifiedInstaller(root,platform,{fetchImpl=fetch}={}){
  const meta=INSTALLERS[platform];
  if(!meta)throw new Error('Cua Driver is unsupported on '+platform);
  const dir=fs.mkdtempSync(path.join(root,'.cua-install-'));
  const file=path.join(dir,meta.file);
  try{
    const response=await fetchImpl(RELEASE+meta.file,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('Cua installer download HTTP '+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length<1024||bytes.length>2*1024*1024)throw new Error('Unexpected Cua installer size');
    const hash=createHash('sha256').update(bytes).digest('hex');
    if(hash!==meta.sha256)throw new Error('Cua installer SHA-256 verification failed; will not execute');
    fs.writeFileSync(file,bytes,{mode:0o600});
    return {dir,file};
  }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
async function inspectDriver(executable,{captureImpl=capture}={}){
  if(!fs.existsSync(executable))return null;
  try {
    const version=await captureImpl(executable,['--version'],{timeout:12000});
    return acceptableVersion(version)?version.trim():null;
  }catch{return null;}
}
/** Set up the native Cua Driver before stopping or replacing the existing Agent.
 * Returns config only after the installed executable and MCP catalog are valid.
 */
export async function ensureCuaDriver({
  root,platform=process.platform,env=process.env,home=os.homedir(),
  fetchImpl=fetch,runImpl=run,captureImpl=capture,existingCommand
}={}){
  if(!root||!path.isAbsolute(root))throw new Error('Cua installer requires an absolute client data root');
  if(!INSTALLERS[platform])throw new Error('Cua Driver is unsupported on '+platform);
  const fallback=installedDriverPath(platform,env,home);
  const candidates=[existingCommand,fallback].filter(p=>typeof p==='string'&&path.isAbsolute(p));
  let executable,version;
  for(const candidate of candidates){
    version=await inspectDriver(candidate,{captureImpl});
    if(version){executable=candidate;break;}
  }
  if(!executable){
    console.log('Installing verified Cua Driver '+CUA_VERSION+' for '+platform+'...');
    const {dir,file}=await verifiedInstaller(root,platform,{fetchImpl});
    try {
      const installEnv={
        ...env,CUA_DRIVER_RS_VERSION:CUA_VERSION,CUA_DRIVER_RS_NO_MODIFY_PATH:'1',
        CUA_DRIVER_NO_MODIFY_PATH:'1'
      };
      if(platform==='win32'){
        await runImpl('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,'-NoAutoStart'],{env:installEnv});
      }else{
        await runImpl('/bin/bash',[file,'--no-modify-path'],{env:installEnv});
      }
    }finally{
      fs.rmSync(dir,{recursive:true,force:true});
    }
    executable=fallback;
    version=await inspectDriver(executable,{captureImpl});
    if(!version)throw new Error('Cua Driver install did not produce a verified version at '+executable);
  }
  // Check that the backend actually advertises desktop tools before Agent activation.
  const catalog=await captureImpl(executable,['list-tools'],{timeout:30000});
  if(!/get_desktop_state|list_windows|health_report/.test(catalog))
    throw new Error('Cua Driver does not expose the required desktop MCP tools');
  console.log('Cua Driver ready: '+version+' ('+executable+')');
  return {enabled:true,command:executable,args:['mcp']};
}

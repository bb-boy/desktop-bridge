import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

export const SERVICE_ID='de.desktopbridge.admin';
export const WINDOWS_TASK='DesktopBridgeAdministrator';

export function protectedRoot(platform=process.platform) {
  if(platform==='win32') {
    const programData=process.env.ProgramData??'C:\\ProgramData';
    return path.win32.join(programData,'DesktopBridge','Administrator');
  }
  if(platform==='darwin')return '/Library/Application Support/DesktopBridge/Administrator';
  if(platform==='linux')return '/var/lib/desktop-bridge-administrator';
  throw new Error('Unsupported platform: '+platform);
}
export function quoteXml(value) {
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
export function serviceSpec(platform,root,node) {
  if(platform==='darwin')return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
    '<plist version="1.0"><dict><key>Label</key><string>'+SERVICE_ID+'</string>'+
    '<key>ProgramArguments</key><array>'+[node,path.join(root,'runner.mjs'),root].map(s=>'<string>'+quoteXml(s)+'</string>').join('')+
    '</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>'+
    '<key>WorkingDirectory</key><string>'+quoteXml(root)+'</string>'+
    '<key>StandardErrorPath</key><string>'+quoteXml(path.join(root,'service.stderr.log'))+'</string>'+
    '</dict></plist>\n';
  if(platform==='linux') {
    const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%').replace(/\n/g,'');
    return '[Unit]\nDescription=Desktop Bridge administrator agent (explicit opt-in)\nAfter=network-online.target\nWants=network-online.target\n\n'+
      '[Service]\nType=simple\nUser=root\nGroup=root\nWorkingDirectory="'+escape(root)+'"\nExecStart="'+escape(node)+'" "'+escape(path.join(root,'runner.mjs'))+'" "'+escape(root)+'"\n'+
      'Restart=always\nRestartSec=10\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\n\n[Install]\nWantedBy=multi-user.target\n';
  }
  throw new Error('No text service specification for '+platform);
}
export function isAdministrator(platform=process.platform) {
  if(platform==='win32') {
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8'});
    return result.status===0&&result.stdout.trim()==='True';
  }
  return typeof process.getuid==='function'&&process.getuid()===0;
}
export function assertProtectedParents(root,platform=process.platform) {
  const absolute=path.resolve(root);
  if(absolute!==path.resolve(protectedRoot(platform)))throw new Error('Administrative directory must be the fixed protected path.');
  if(platform!=='win32'){
    let current=absolute,checked=0;
    // The dedicated installation and its own parent must be protected.
    // macOS may legitimately mark /Library/Application Support group-admin writable.
    while(current!==path.dirname(current)&&checked++<2){
      if(!fs.existsSync(current)){current=path.dirname(current);continue;}
      const st=fs.lstatSync(current);
      if(st.isSymbolicLink()||!st.isDirectory())throw new Error('Administrative directory contains an unsafe symlink.');
      if(st.uid!==0||(st.mode&0o022)!==0)throw new Error('Administrative path must be root-owned and not group/world writable: '+current);
      current=path.dirname(current);
    }
  }
}
export function validateSource(source) {
  const base=fs.realpathSync(source);
  const required=['.desktop-bridge-client','launch.json','agent-config.json','runner.mjs','lifecycle.mjs','releases','runtime'];
  for(const name of required)if(!fs.existsSync(path.join(base,name)))throw new Error('Missing installed client component: '+name);
  const marker=fs.readFileSync(path.join(base,'.desktop-bridge-client'),'utf8');
  if(marker.trim()!=='desktop-bridge-client')throw new Error('Unrecognized installation marker.');
  const config=JSON.parse(fs.readFileSync(path.join(base,'agent-config.json'),'utf8'));
  if(!/^https:\/\//.test(config.serverUrl)||!config.deviceId||!config.deviceToken)throw new Error('Pair the client over HTTPS before installing administrator mode.');
  const launch=JSON.parse(fs.readFileSync(path.join(base,'launch.json'),'utf8'));
  if(!path.resolve(launch.agent).startsWith(base+path.sep)||!path.resolve(launch.config).startsWith(base+path.sep))throw new Error('Unsafe launch manifest.');
  for(const name of ['runtime','releases','agent-config.json','launch.json','runner.mjs']){
    const entry=fs.lstatSync(path.join(base,name));if(entry.isSymbolicLink())throw new Error('Top-level symlink not allowed: '+name);
  }
  return {base,config,launch};
}
export function copyTreeSafe(source,destination) {
  const base=fs.realpathSync(source);
  const boundary=fs.statSync(base).isDirectory()?base:path.dirname(base);
  fs.cpSync(source,destination,{recursive:true,force:true,errorOnExist:false,dereference:true,filter:(entry)=>{
    const resolved=fs.realpathSync(entry);
    if(resolved!==boundary&&!resolved.startsWith(boundary+path.sep))throw new Error('Symlink escapes administrative payload: '+entry);
    const lstat=fs.lstatSync(entry);
    if(lstat.isSymbolicLink()&&fs.statSync(entry).isDirectory())throw new Error('Symlinked directories not allowed: '+entry);
    return true;
  }});
}
export function rewritePaths(value,oldRoot,newRoot) {
  if(typeof value==='string') {
    return value===oldRoot?newRoot:value.startsWith(oldRoot+path.sep)?newRoot+value.slice(oldRoot.length):value;
  }
  if(Array.isArray(value))return value.map(x=>rewritePaths(x,oldRoot,newRoot));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,x])=>[key,rewritePaths(x,oldRoot,newRoot)]));
  return value;
}
export function secureTree(root,platform=process.platform) {
  if(platform==='win32') {
    const result=spawnSync('icacls.exe',[root,'/inheritance:r','/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F','/T','/Q'],{encoding:'utf8'});
    if(result.status!==0)throw new Error('Failed to protect Windows administrative files: '+result.stderr);
  } else {
    for(const entry of fs.readdirSync(root,{withFileTypes:true})){
      const filename=path.join(root,entry.name);
      const st=fs.lstatSync(filename);
      if(st.isSymbolicLink())throw new Error('Unexpected symlink in privileged tree.');
      fs.chownSync(filename,0,0);
      if(st.isDirectory()){fs.chmodSync(filename,0o700);secureTree(filename,platform);}
      else fs.chmodSync(filename,(st.mode&0o111)?0o700:0o600);
    }
    fs.chownSync(root,0,0);fs.chmodSync(root,0o700);
    for(const bin of findNodeBinaries(root))fs.chmodSync(bin,0o700);
  }
}
function findNodeBinaries(root) {
  const runtime=path.join(root,'runtime');if(!fs.existsSync(runtime))return [];
  const out=[];
  for(const entry of fs.readdirSync(runtime)){const candidate=path.join(runtime,entry,'bin','node');if(fs.existsSync(candidate))out.push(candidate);}
  return out;
}
export function writePrivateJson(file,data){fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600,flag:'w'});if(process.platform!=='win32')fs.chmodSync(file,0o600);}

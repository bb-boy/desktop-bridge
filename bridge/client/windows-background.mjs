import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const ps=value=>"'"+String(value).replace(/'/g,"''")+"'";
const quote=value=>'"'+String(value).replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
export function backgroundTaskName(root){
  return 'DesktopBridge-User-'+createHash('sha256').update(path.win32.resolve(root).toLowerCase()).digest('hex').slice(0,20);
}
export function backgroundTaskScript(action,root,node){
  if(!['register','start','remove'].includes(action))throw new Error('Invalid background task action');
  const name=ps(backgroundTaskName(root));
  const preamble="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';"+
    "$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent();$sid=$identity.User.Value;"+
    `$task=Get-ScheduledTask -TaskName ${name} -ErrorAction SilentlyContinue;`+
    // A deterministic name must never let one user replace another user's task.
    "if($task){$owner=$task.Principal.UserId;if($owner -notmatch '^S-1-'){$owner=([System.Security.Principal.NTAccount]$owner).Translate([System.Security.Principal.SecurityIdentifier]).Value};"+
    "if($owner -ne $sid){throw 'Background task belongs to another Windows account'}};";
  if(action==='remove')return preamble+`if($task){Stop-ScheduledTask -TaskName ${name};Unregister-ScheduledTask -TaskName ${name} -Confirm:$false};exit 0`;
  const args=[path.win32.join(root,'runner.mjs'),root].map(quote).join(' ');
  const register=`$a=New-ScheduledTaskAction -Execute ${ps(node)} -Argument ${ps(args)} -WorkingDirectory ${ps(root)};`+
    "$p=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited;"+
    "$t=New-ScheduledTaskTrigger -AtLogOn -User $sid;"+
    "$s=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;"+
    `Register-ScheduledTask -TaskName ${name} -Action $a -Trigger $t -Principal $p -Settings $s -Force|Out-Null;`;
  // Refresh the action on installation; ordinary start reuses the registered task.
  if(action==='register')return preamble+register;
  return preamble+`if(-not $task){${register}}Start-ScheduledTask -TaskName ${name}`;
}
export async function windowsBackground(action,root,node){
  const canonical=fs.realpathSync(root);
  const script=backgroundTaskScript(action,canonical,node);
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  try{
    await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  }catch(error){
    throw new Error('Windows background task '+action+' failed: '+String(error.stderr||error.message).slice(0,1500));
  }
}

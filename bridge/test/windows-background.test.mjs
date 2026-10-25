import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {backgroundTaskName,backgroundTaskScript} from '../client/windows-background.mjs';
import {startBackground,registerStartup} from '../client/startup.mjs';
import {stopClient,removeStartup,livePid,sleep} from '../client/lifecycle.mjs';
const execute=promisify(execFile);

test('user tasks isolate installations and preserve literal Windows paths',()=>{
 const root="C:\\Users\\Test\\data ' %TEMP% & $literal";
 assert.equal(backgroundTaskName(root),backgroundTaskName(root.toUpperCase()+'\\'));
 assert.notEqual(backgroundTaskName(root),backgroundTaskName(root+'2'));
 const script=backgroundTaskScript('register',root,'C:\\Program Files\\node.exe');
 assert.ok(script.includes("data '' %TEMP% & $literal"));
 assert.match(script,/-RunLevel Limited/);assert.match(script,/-LogonType Interactive/);
 assert.match(script,/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
 assert.match(script,/-MultipleInstances IgnoreNew/);
 assert.match(script,/-AtLogOn -User \$sid/);
 assert.match(script,/\$link.Arguments -eq/);assert.match(script,/\$link.WorkingDirectory -eq/);
 assert.doesNotMatch(script,/SYSTEM|ServiceAccount|cmd\.exe/);
 assert.throws(()=>backgroundTaskScript('anything',root,'node'));
});

test('reinstall keeps an already-matching Windows user task without unregistering it',()=>{
 const script=backgroundTaskScript('register','C:\\Users\\Test\\DesktopBridgeClient','C:\\Users\\Test\\node.exe');
 assert.match(script,/\$sameTask=/);
 assert.match(script,/if\(\$sameTask\)\{/);
 assert.match(script,/\$task\.Settings\.Enabled/);
 assert.match(script,/\$task\.Principal\.RunLevel -eq 'Limited'/);
 assert.match(script,/\$triggers\[0\]\.CimClass\.CimClassName/);
 assert.match(script,/exit 0\}/);
 assert.doesNotMatch(script,/Stop-ScheduledTask|Unregister-ScheduledTask/);
 assert.ok(script.indexOf('if($sameTask)')<script.indexOf('Register-ScheduledTask'));
});

test('matching scheduled task bypasses registration even when mutation is denied',
 {skip:process.platform!=='win32',timeout:15000},async()=>{
  const root='C:\\Test Data\\DesktopBridgeClient';
  const node='C:\\Private Node\\node.exe';
  const literal=s=>"'"+s.replace(/'/g,"''")+"'";
  const args=`"${path.win32.join(root,'runner.mjs')}" "${root}"`;
  const mock=`function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName) `+
    `[pscustomobject]@{Principal=[pscustomobject]@{UserId=([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value;RunLevel='Limited';LogonType='Interactive'};`+
    `Actions=@([pscustomobject]@{Execute=${literal(node)};Arguments=${literal(args)};WorkingDirectory=${literal(root)}});`+
    `Triggers=@([pscustomobject]@{CimClass=[pscustomobject]@{CimClassName='MSFT_TaskLogonTrigger'}});Settings=[pscustomobject]@{Enabled=$true}} };`+
    `function Register-ScheduledTask { throw 'MUTATION_WAS_ATTEMPTED' };`;
  const actual=backgroundTaskScript('register',root,node);
  const encoded=Buffer.from(mock+actual,'utf16le').toString('base64');
  const appData=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-reuse-test-'));
  try {
    await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],
      {env:{...process.env,APPDATA:appData},timeout:10000});
  } finally { fs.rmSync(appData,{recursive:true,force:true}); }
 });

test('Windows task survives its launching process and remains stoppable and removable', {skip:process.platform!=='win32',timeout:90000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bridge-task ' & %literal%-"));
 const originalAppData=process.env.APPDATA;
 process.env.APPDATA=path.join(root,'appdata');
 const shortcut=path.join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs','Startup','Desktop Bridge.lnk');
 fs.mkdirSync(path.dirname(shortcut),{recursive:true});
 const foreignRoot=path.join(root,'another-client');fs.mkdirSync(foreignRoot);
 const ps=s=>"'"+s.replace(/'/g,"''")+"'";
 const foreignScript=`$l=(New-Object -ComObject WScript.Shell).CreateShortcut(${ps(shortcut)});$l.TargetPath=${ps(process.execPath)};$l.Arguments='foreign-client';$l.WorkingDirectory=${ps(foreignRoot)};$l.Save()`;
 await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(foreignScript,'utf16le').toString('base64')]);
 const agent=path.join(root,'agent.mjs');
 fs.copyFileSync(new URL('../client/runner.mjs',import.meta.url),path.join(root,'runner.mjs'));
 fs.copyFileSync(new URL('../client/lifecycle.mjs',import.meta.url),path.join(root,'lifecycle.mjs'));
 fs.writeFileSync(agent,"import fs from 'node:fs';fs.writeFileSync('agent.lock',String(process.pid));setInterval(()=>{},1000);process.on('message',m=>{if(m?.type==='stop'){fs.rmSync('agent.lock',{force:true});process.exit(0)}});");
 fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({agent,config:'unused'}));
 t.after(async()=>{try{await stopClient(root);await removeStartup(root);fs.rmSync(root,{recursive:true,force:true});}finally{process.env.APPDATA=originalAppData;}});
 await registerStartup(process.execPath,root);
 assert.equal(fs.existsSync(shortcut),true,'custom installation must preserve another installation\'s login shortcut');
 const startUrl=new URL('../client/startup.mjs',import.meta.url).href;
 const source=`import {startBackground} from ${JSON.stringify(startUrl)};await startBackground(${JSON.stringify(root)},${JSON.stringify(process.execPath)});`;
 await execute(process.execPath,['--input-type=module','-e',source],{timeout:45000});
 await sleep(1500);
 assert.equal(livePid(path.join(root,'runner-lock','pid')),true,'runner must survive the launching CLI exiting');
 await startBackground(root,process.execPath);
 await stopClient(root);assert.equal(livePid(path.join(root,'runner-lock','pid')),false);
 await startBackground(root,process.execPath);
 await stopClient(root);await removeStartup(root);
 assert.equal(fs.existsSync(shortcut),true,'removal must not delete another installation\'s shortcut');
 const encoded=Buffer.from(`$ProgressPreference='SilentlyContinue';$t=Get-ScheduledTask -TaskName '${backgroundTaskName(fs.realpathSync(root))}' -ErrorAction SilentlyContinue;if($t){exit 1};exit 0`,'utf16le').toString('base64');
 await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded]);
});

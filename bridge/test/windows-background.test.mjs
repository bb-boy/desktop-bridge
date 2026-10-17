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
 assert.doesNotMatch(script,/SYSTEM|ServiceAccount|cmd\.exe/);
 assert.throws(()=>backgroundTaskScript('anything',root,'node'));
});

test('Windows task survives its launching process and remains stoppable and removable', {skip:process.platform!=='win32',timeout:90000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bridge-task ' & %literal%-"));
 const agent=path.join(root,'agent.mjs');
 fs.copyFileSync(new URL('../client/runner.mjs',import.meta.url),path.join(root,'runner.mjs'));
 fs.copyFileSync(new URL('../client/lifecycle.mjs',import.meta.url),path.join(root,'lifecycle.mjs'));
 fs.writeFileSync(agent,"import fs from 'node:fs';fs.writeFileSync('agent.lock',String(process.pid));setInterval(()=>{},1000);process.on('message',m=>{if(m?.type==='stop'){fs.rmSync('agent.lock',{force:true});process.exit(0)}});");
 fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({agent,config:'unused'}));
 t.after(async()=>{await stopClient(root);await removeStartup(root);fs.rmSync(root,{recursive:true,force:true});});
 await registerStartup(process.execPath,root);
 const startUrl=new URL('../client/startup.mjs',import.meta.url).href;
 const source=`import {startBackground} from ${JSON.stringify(startUrl)};await startBackground(${JSON.stringify(root)},${JSON.stringify(process.execPath)});`;
 await execute(process.execPath,['--input-type=module','-e',source],{timeout:45000});
 await sleep(1500);
 assert.equal(livePid(path.join(root,'runner-lock','pid')),true,'runner must survive the launching CLI exiting');
 await startBackground(root,process.execPath);
 await stopClient(root);assert.equal(livePid(path.join(root,'runner-lock','pid')),false);
 await startBackground(root,process.execPath);
 await stopClient(root);await removeStartup(root);
 const encoded=Buffer.from(`$ProgressPreference='SilentlyContinue';$t=Get-ScheduledTask -TaskName '${backgroundTaskName(fs.realpathSync(root))}' -ErrorAction SilentlyContinue;if($t){exit 1};exit 0`,'utf16le').toString('base64');
 await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {protectedRoot,quoteXml,serviceSpec,validateSource,copyTreeSafe,rewritePaths,isAdministrator} from '../client/admin-runtime.mjs';
import {elevationRequest} from '../client/admin-elevate.mjs';

test('administrator roots are fixed machine-protected paths',()=>{
 assert.equal(protectedRoot('darwin'),'/Library/Application Support/DesktopBridge/Administrator');
 assert.equal(protectedRoot('linux'),'/var/lib/desktop-bridge-administrator');
 assert.match(protectedRoot('win32'),/DesktopBridge\\Administrator$/);
 assert.throws(()=>protectedRoot('aix'),/Unsupported/);
});
test('service definitions preserve argument boundaries and use platform services',()=>{
 const mac=serviceSpec('darwin','/Library/Application Support/DesktopBridge/Administrator','/private/node');
 assert.match(mac,/KeepAlive/);assert.match(mac,/RunAtLoad/);assert.match(mac,/<key>KeepAlive<\/key>/);
 const unit=serviceSpec('linux','/var/lib/desktop-bridge-administrator','/private/node');
 assert.match(unit,/User=root/);assert.match(unit,/Restart=always/);assert.match(unit,/ExecStart=/);
 assert.equal(quoteXml('a&<"\''),'a&amp;&lt;&quot;&apos;');
});
test('source validation requires paired https credential and rejects unsafe manifests',t=>{
 const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bridge-admin-test-')));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 for(const name of ['runtime','releases'])fs.mkdirSync(path.join(tmp,name));
 fs.writeFileSync(path.join(tmp,'.desktop-bridge-client'),'desktop-bridge-client\n');
 for(const name of ['runner.mjs','lifecycle.mjs'])fs.writeFileSync(path.join(tmp,name),'test');
 const config={serverUrl:'https://example.test',deviceToken:'test-token',deviceId:'test-device'};
 fs.writeFileSync(path.join(tmp,'agent-config.json'),JSON.stringify(config));
 fs.writeFileSync(path.join(tmp,'launch.json'),JSON.stringify({agent:path.join(tmp,'releases','agent.mjs'),config:path.join(tmp,'agent-config.json')}));
 assert.equal(validateSource(tmp).base,tmp);
 fs.writeFileSync(path.join(tmp,'agent-config.json'),JSON.stringify({...config,serverUrl:'http://example.test'}));
 assert.throws(()=>validateSource(tmp),/HTTPS/);
});
test('privileged payload rejects escaping symlinks, rewrites only child paths',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-admin-copy-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const src=path.join(tmp,'src');fs.mkdirSync(src);fs.writeFileSync(path.join(src,'ok'),'safe');
 fs.symlinkSync('/etc/passwd',path.join(src,'outside'));
 assert.throws(()=>copyTreeSafe(src,path.join(tmp,'dest')),/escapes/);
 assert.deepEqual(rewritePaths({a:'/root/old/file',b:'/root/older/file'},'/root/old','/private/admin'),{a:'/private/admin/file',b:'/root/older/file'});
});
test('elevation planning requires explicit user approval, never silent elevation',()=>{
 assert.throws(()=>elevationRequest('install',{source:'/tmp/app',mode:'system'}),/explicit mode/);
 assert.throws(()=>elevationRequest('install',{source:'/tmp/app'}),/explicit mode/);
 const request=elevationRequest('install',{source:'/tmp/app',mode:'manual',platform:'linux'});
 assert.equal(request.command,'sudo');
 assert.equal(request.args[0],'--');
 assert.equal(request.args.at(-1),'manual');
 const windows=elevationRequest('install',{source:'C:\\client',mode:'background',platform:'win32'});
 assert.equal(windows.command,'powershell.exe');assert.match(windows.args.join(' '),/Start-Process.*RunAs/);
});
test('privileged entry refuses unapproved direct calls',()=>{
 if(typeof process.getuid==='function'&&process.getuid()===0)return;
 assert.equal(isAdministrator(),false);
});

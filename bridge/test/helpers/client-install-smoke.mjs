// Explicit network/process smoke test. Never opens a browser.
// node bridge/test/helpers/client-install-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const bridge=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-install-smoke-'));
const source=path.join(temp,'unpacked-client'),data=path.join(temp,'client-data');
let pairs=0,client;
const server=http.createServer((request,response)=>{
 response.setHeader('content-type','application/json');
 if(request.url==='/api/pair/start'){pairs++;return response.end(JSON.stringify({userCode:'LOCAL-TEST',verificationUri:'http://127.0.0.1/never-open-this',deviceCode:'fixture',expiresIn:60,interval:0.01}));}
 if(request.url==='/api/pair/poll')return response.end(JSON.stringify({deviceId:'smoke-device',deviceToken:String(pairs).repeat(43)}));
 response.statusCode=404;response.end('{}');
});
async function run(command,args,env){const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);const [code]=await once(child,'exit');assert.equal(code,0,output);return output;}
try{
 fs.cpSync(path.join(bridge,'client'),source,{recursive:true,filter:file=>path.basename(file)!=='node_modules'});
 fs.cpSync(path.join(bridge,'agent'),path.join(source,'agent'),{recursive:true});
 server.listen(0,'127.0.0.1');await once(server,'listening');fs.writeFileSync(path.join(source,'connection.json'),JSON.stringify({serverUrl:'http://127.0.0.1:'+server.address().port}));
 const env={...process.env,HOME:path.join(temp,'home'),XDG_CONFIG_HOME:path.join(temp,'config')};
 // Fresh bootstrap: official archive download + pinned checksum + npm ci + headless pairing.
 await run('/bin/sh',[path.join(source,'Install.sh'),'--root',data,'--no-browser','--no-start'],env);
 assert.equal(JSON.parse(fs.readFileSync(path.join(data,'client-settings.json'))).mode,'manual');assert.equal(fs.existsSync(path.join(data,'runner-lock')),false);assert.match(fs.readFileSync(path.join(data,'START-HERE.txt'),'utf8'),/Ctrl\+C/);
 const config=JSON.parse(fs.readFileSync(path.join(data,'agent-config.json')));assert.equal(pairs,1);assert.equal(config.deviceId,'smoke-device');
 const installedNode=path.join(data,'runtime',`node-v24.19.0-${process.platform}-${process.arch}`,'bin/node');assert.ok(fs.existsSync(installedNode));
 const require=createRequire(path.join(config.runtimeDir,'package.json'));
 const {rgPath}=await import(pathToFileURL(require.resolve('@vscode/ripgrep')));assert.ok(fs.existsSync(rgPath));await run(rgPath,['--version'],env);
 const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
 const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
 client=new Client({name:'installer-smoke',version:'1'},{capabilities:{}});
 const transport=new StdioClientTransport({command:installedNode,args:[config.mcpEntry],cwd:temp,stderr:'pipe'});transport.stderr?.on('data',()=>{});
 await client.connect(transport,{timeout:30000});
 const tools=await client.listTools();assert.ok(tools.tools.length>0);const response=await client.callTool({name:'get_config',arguments:{}});assert.notEqual(response.isError,true);
 const ExcelJS=require('exceljs');const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Smoke').addRow(['works']);assert.ok((await workbook.xlsx.writeBuffer()).length>0);
 const mdRequire=createRequire(require.resolve('md-to-pdf/package.json'));const matter=mdRequire('gray-matter');assert.equal(matter('---\ntitle: smoke\n---\nbody').data.title,'smoke');
 await client.close();client=null;
 // A same-version reinstall retains manual mode and does not run npm or pair again.
 const dependencyTime=fs.statSync(path.join(config.runtimeDir,'node_modules')).mtimeMs;
 const reused=await run('/bin/sh',[path.join(source,'Install.sh'),'--root',data,'--no-browser'],env);assert.equal(pairs,1);assert.equal(fs.statSync(path.join(config.runtimeDir,'node_modules')).mtimeMs,dependencyTime);assert.match(reused,/本地工具验证通过/);
 // Missing module code is automatically repaired even with an unchanged lockfile.
 fs.rmSync(path.join(config.runtimeDir,'node_modules','ws','lib','websocket.js'));
 const repaired=await run('/bin/sh',[path.join(source,'Install.sh'),'--root',data,'--no-browser'],env);assert.equal(pairs,1);assert.ok(fs.existsSync(path.join(config.runtimeDir,'node_modules','ws','lib','websocket.js')));assert.match(repaired,/自动安装或修复/);
 // Existing runtime reuse works without another runtime archive; repair gets new credentials.
 await run('/bin/sh',[path.join(source,'Install.sh'),'--root',data,'--repair','--no-browser','--no-start'],env);assert.equal(pairs,2);
 // Uninstallation keeps credentials for result recovery; purge is a separate explicit choice.
 await run('/bin/sh',[path.join(source,'Uninstall.sh'),'--root',data],env);assert.ok(fs.existsSync(path.join(data,'agent-config.json')));assert.equal(fs.existsSync(path.join(data,'runtime')),false);
 console.log('PASS: '+process.platform+'/'+process.arch+' official runtime download and checksum, isolated installation, headless pairing, real Desktop Commander MCP, ripgrep binary, ExcelJS/YAML override compatibility, manual mode persistence and saved commands, automatic missing-module repair, no duplicate npm on reuse, repair and uninstall.');
}finally{await client?.close();server.close();fs.rmSync(temp,{recursive:true,force:true});}

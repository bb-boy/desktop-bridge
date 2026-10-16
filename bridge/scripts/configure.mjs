import fs from 'node:fs';
import path from 'node:path';
import {opaque,hash,passwordHash} from '../server/security.mjs';
const [baseUrl,outputDirectory,runtimeDir]=process.argv.slice(2);
if(!baseUrl || !outputDirectory || !runtimeDir) throw new Error('Usage: node scripts/configure.mjs https://your-domain /private/output-directory WindowsDesktopCommanderRuntimeDirectory');
const url=new URL(baseUrl);
if(url.protocol!=='https:' || url.pathname!=='/' || url.search || url.hash || url.username || url.password) throw new Error('Supply an HTTPS origin');
fs.mkdirSync(outputDirectory,{recursive:true,mode:0o700});
for(const filename of ['server-config.json','agent-config.json','owner-password.txt']) {
  if(fs.existsSync(path.join(outputDirectory,filename))) throw new Error('Configuration already exists; use an empty private output directory');
}
const password=opaque(),token=opaque();
const server={baseUrl:url.origin,port:8787,dataDir:'/var/lib/desktop-bridge',ownerPasswordHash:await passwordHash(password),devices:[{id:'p111',name:'p111',tokenHash:hash(token)}]};
const agent={serverUrl:url.origin,deviceId:'p111',deviceToken:token,runtimeDir,mcpEntry:path.win32.join(runtimeDir,'node_modules','@wonderwhy-er','desktop-commander','dist','index.js'),defaultShell:'powershell.exe'};
for(const [filename,data] of [['server-config.json',JSON.stringify(server,null,2)],['agent-config.json',JSON.stringify(agent,null,2)],['owner-password.txt',password+'\n']]) {
  fs.writeFileSync(path.join(outputDirectory,filename),data,{mode:0o600,flag:'wx'});
}
console.log('Configuration written to the private output directory. No secrets printed. Keep these files outside the source repository.');

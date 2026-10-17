#!/usr/bin/env node
/** Stage only reviewed client files, never local tokens or relay credentials. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const pkgDir=fileURLToPath(new URL('../',import.meta.url));
const repository=path.resolve(pkgDir,'..');
const client=path.join(repository,'bridge','client');
const agent=path.join(repository,'bridge','agent');
const destination=path.join(pkgDir,'dist','client');
const clientFiles=[
  'Install.cmd','Install.command','Install.sh','Pair-again.cmd','RePair.cmd',
  'Start.cmd','Start.command','Stop.cmd','Stop.command',
  'Uninstall.cmd','Uninstall.command','Uninstall.sh',
  'admin-elevate.mjs','admin-runtime.mjs','admin-service.mjs',
  'connection.json','control.mjs','control.ps1','environment-probe.mjs',
  'environment.mjs','install-options.mjs','install.mjs','install.ps1',
  'launch.sh','lifecycle.mjs','node-runtime.json','package-lock.json',
  'package.json','runner.mjs','start.sh','startup.mjs','stop.sh','uninstall.ps1'
];
const agentFiles=['agent.mjs','pair.mjs'];
const needs=(source,rel)=>{
  const file=path.join(source,rel);
  if(!fs.statSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new Error('Unsafe source: '+file);
  return file;
};
// Fail before replacing any previous stage if a required file is missing.
for(const filename of clientFiles)needs(client,filename);
for(const filename of agentFiles)needs(agent,filename);
const notice=needs(path.join(repository,'bridge'),'THIRD_PARTY_NOTICES.md');
const license=needs(path.join(repository,'bridge'),'LICENSE');
fs.rmSync(destination,{recursive:true,force:true});
fs.mkdirSync(path.join(destination,'agent'),{recursive:true});
for(const filename of clientFiles)fs.copyFileSync(needs(client,filename),path.join(destination,filename));
for(const filename of agentFiles)fs.copyFileSync(needs(agent,filename),path.join(destination,'agent',filename));
fs.copyFileSync(notice,path.join(pkgDir,'THIRD_PARTY_NOTICES.md'));
fs.copyFileSync(license,path.join(pkgDir,'LICENSE'));
console.error('Staged '+(clientFiles.length+agentFiles.length)+' client files for npm packaging.');

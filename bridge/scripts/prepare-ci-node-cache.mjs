// CI-only persistent cache of the exact official Node runtime archive.
// The shipped installers never read this cache or trust its contents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../client');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'node-runtime.json'),'utf8'));
const platform=process.platform==='win32'?'win':process.platform;
const target=manifest.platforms[platform+'-'+process.arch];
if(!target||!/^node-v[\w.-]+\.(?:tar\.gz|zip)$/.test(target.filename)||! /^[a-f0-9]{64}$/.test(target.sha256)){
 throw new Error('Missing pinned Node runtime metadata for CI');
}
const directory=process.env.DESKTOP_BRIDGE_NODE_CACHE_DIR||path.join(os.homedir(),'.cache','desktop-bridge','node');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const archive=path.join(directory,target.filename);
function valid(file){
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;
 const hash=createHash('sha256');
 const fd=fs.openSync(file,'r');
 const buffer=Buffer.alloc(1024*1024);
 try{let read;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,read));}
 finally{fs.closeSync(fd);}
 return hash.digest('hex')===target.sha256;
}
if(!valid(archive)){
 if(fs.existsSync(archive))fs.rmSync(archive);
 const pending=archive+'.partial-'+process.pid;
 const url='https://nodejs.org/dist/v'+manifest.version+'/'+target.filename;
 try{
  console.error('CI Node cache MISS: downloading and verifying '+target.filename);
  const result=spawnSync('curl',['--fail','--location','--silent','--show-error','--retry','4','--retry-all-errors','--retry-delay','2','--connect-timeout','15','--max-time','1000','--proto','=https','--proto-redir','=https','--tlsv1.2','-o',pending,url],{stdio:'inherit'});
  if(result.status!==0)throw new Error('Failed to download the official pinned Node runtime');
  if(!valid(pending))throw new Error('Official Node archive SHA-256 mismatch; refusing to cache');
  fs.renameSync(pending,archive);
  fs.chmodSync(archive,0o600);
 }finally{fs.rmSync(pending,{force:true});}
}else console.error('CI Node cache HIT: SHA-256 verified '+target.filename);
if(!valid(archive))throw new Error('CI runtime archive failed final checksum verification');
console.log(archive);

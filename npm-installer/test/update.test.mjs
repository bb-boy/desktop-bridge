import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performUpdate} from '../bin/update.mjs';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-npm-update-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'client'),packageRoot=path.join(dir,'npm-package');
 fs.mkdirSync(root);fs.mkdirSync(path.join(packageRoot,'bin'),{recursive:true});
 const put=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));
 put(path.join(root,'launch.json'),{});
 put(path.join(root,'agent-config.json'),{deviceId:'fixture',deviceToken:'fixture-only',serverUrl:'https://example.invalid'});
 put(path.join(root,'client-settings.json'),{mode:'manual'});
 put(path.join(root,'journal.json'),{saved:{status:'completed',time:Date.now(),result:{content:[]}}});
 put(path.join(packageRoot,'package.json'),{name:'@justlovepl/desktop-bridge',version:'0.2.7'});
 fs.writeFileSync(path.join(packageRoot,'bin/desktop-bridge.mjs'),'');
 return {root,packageRoot,npmScript:'fixture-npm-cli.js',print:()=>{}};
}

test('unpublished newer CLI cannot downgrade the package or modify paired client data',async t=>{
 const f=fixture(t),files=fs.readdirSync(f.root).map(n=>[n,fs.readFileSync(path.join(f.root,n))]);
 let calls=0;
 await assert.rejects(performUpdate({...f,execute:async(_exe,args)=>{
  calls++;assert.equal(args.at(-1),'@justlovepl/desktop-bridge@>=0.2.7');return 1;
 }}),/npm package update failed/);
 assert.equal(calls,1,'do not invoke the installer when npm cannot supply this or a newer version');
 for(const [name,bytes]of files)assert.deepEqual(fs.readFileSync(path.join(f.root,name)),bytes);
});

test('routine update explicitly preserves manual mode despite the npm setup background default',async t=>{
 const f=fixture(t);let calls=0;
 const result=await performUpdate({...f,execute:async(_exe,args)=>{
  if(++calls===1)return 0;
  assert.deepEqual(args.slice(1),['setup','--mode','manual','--no-browser','--root',f.root]);return 0;
 }});
 assert.equal(result,0);assert.equal(calls,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'client-settings.json'))).mode,'manual');
});

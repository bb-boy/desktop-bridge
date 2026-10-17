import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {installerDownload} from '../server/downloads.mjs';

test('native installer downloads are attachments without accepting arbitrary paths',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-downloads-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const names=['DesktopBridge-macOS.pkg','DesktopBridge-Windows.cmd','DesktopBridge-Linux.sh','desktop-bridge-plugin.zip'];
 for(const name of names)fs.writeFileSync(path.join(root,name),'fixture: '+name);
 const app=express();app.use('/downloads',installerDownload,express.static(root));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const name of names){
  const r=await fetch(base+'/downloads/'+name);assert.equal(r.status,200);
  assert.equal(r.headers.get('content-disposition').replaceAll('"',''),'attachment; filename='+name);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(await r.text(),'fixture: '+name);
 }
 const missing=await fetch(base+'/downloads/not-an-installer.sh');assert.equal(missing.status,404);assert.equal(missing.headers.get('content-disposition'),null);
 const traversal=await fetch(base+'/downloads/%2e%2e%2foutside.cmd');assert.equal(traversal.status,404);assert.equal(traversal.headers.get('content-disposition'),null);
});

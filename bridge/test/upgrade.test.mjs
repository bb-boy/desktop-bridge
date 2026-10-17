import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {startServer} from '../server/index.mjs';

test('malformed anonymous WebSocket targets are rejected without crashing the relay',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-upgrade-'));
  const server=await startServer({baseUrl:'http://127.0.0.1',port:0,dataDir:directory,ownerPasswordHash:'unused',devices:[]});
  t.after(async()=>{await server.close();fs.rmSync(directory,{recursive:true,force:true});});
  // Exercise the event synchronously first so a regression is an assertion
  // failure, rather than an uncaught exception that kills the test process.
  for(const url of ['//[','http://[']) {
    let response='';
    assert.doesNotThrow(()=>server.httpServer.emit('upgrade',{url,headers:{}},{end:value=>{response=value;}},Buffer.alloc(0)));
    assert.match(response,/^HTTP\/1.1 400 /);
  }
  const port=server.httpServer.address().port;
  const response=await new Promise((resolve,reject)=>{
    const socket=net.connect(port,'127.0.0.1');let data='';
    socket.setTimeout(2000,()=>socket.destroy(new Error('Upgrade response timed out')));
    socket.on('error',reject);socket.on('data',chunk=>data+=chunk);
    socket.on('end',()=>resolve(data));
    socket.on('connect',()=>socket.write('GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'));
  });
  assert.match(response,/^HTTP\/1.1 400 /);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status,200);
});

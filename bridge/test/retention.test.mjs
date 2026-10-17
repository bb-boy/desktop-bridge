import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../server/store.mjs';

test('server stores at most 100 newest tool calls and results per account',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-retention-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=openStore(dir);
  try {
    for(let i=0;i<115;i++){
      const id='alice-'+i;
      store.beginCall(id,'device-a','test_tool','alice');
      assert.equal(store.finishCall(id,'completed',{content:[{type:'text',text:id}]}),true);
    }
    for(let i=0;i<104;i++)store.beginCall('bob-'+i,'device-b','test_tool','bob');
    const count=owner=>store.db.prepare('SELECT count(*) AS n FROM calls WHERE owner=?').get(owner).n;
    assert.equal(count('alice'),100);
    assert.equal(count('bob'),100);
    assert.equal(store.call('alice-0','alice'),undefined);
    assert.equal(store.call('bob-0','bob'),undefined);
    assert.equal(store.call('alice-15','alice').result.content[0].text,'alice-15');
    assert.equal(store.recentCalls('alice').length,100);
    assert.equal(store.recentCalls('alice')[0].id,'alice-114');
    assert.equal(store.recentCalls('bob')[0].id,'bob-103');
    assert.equal(store.recentCalls('alice').at(-1).id,'alice-15');
  } finally {store.close();}
});

test('opening an older server database trims historical records for every account',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-retention-upgrade-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let store=openStore(dir);
  try {
    const insert=store.db.prepare("INSERT INTO calls(id,device,tool,status,started,owner) VALUES (?,'device','test_tool','completed',?,?)");
    for(let i=0;i<140;i++)insert.run('legacy-a-'+i,i,'alice');
    for(let i=0;i<107;i++)insert.run('legacy-b-'+i,i,'bob');
  } finally {store.close();}
  store=openStore(dir);
  try {
    const count=owner=>store.db.prepare('SELECT count(*) AS n FROM calls WHERE owner=?').get(owner).n;
    assert.equal(count('alice'),100);
    assert.equal(count('bob'),100);
    assert.equal(store.recentCalls('alice')[0].id,'legacy-a-139');
    assert.equal(store.recentCalls('bob').at(-1).id,'legacy-b-7');
    assert.equal(store.call('legacy-a-0','alice'),undefined);
  } finally {store.close();}
});

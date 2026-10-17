#!/usr/bin/env node
/** Test packed npm CLI without executing setup, pairing or starting a service. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const tarballs=fs.readdirSync(root).filter(name=>name.endsWith('.tgz')&&name.includes('desktop-bridge'));
assert.equal(tarballs.length,1,'Expected exactly one npm tarball');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-bridge-npm-smoke-'));
try{
  const unpack=spawnSync('tar',['-xzf',path.join(root,tarballs[0]),'-C',temporary],{encoding:'utf8'});
  assert.equal(unpack.status,0,unpack.stderr);
  const entry=path.join(temporary,'package','bin','desktop-bridge.mjs');
  assert.ok(fs.existsSync(entry),'Missing npm CLI bin entry');
  const help=spawnSync(process.execPath,[entry,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/Desktop Bridge/);
  const version=spawnSync(process.execPath,[entry,'--version'],{encoding:'utf8'});
  assert.equal(version.status,0,version.stderr);
  assert.match(version.stdout,/^0\.2\.5/);
  const invalid=spawnSync(process.execPath,[entry,'not-a-command'],{encoding:'utf8'});
  assert.equal(invalid.status,1,'Invalid command must fail before side effects');
  console.log('Tarball CLI smoke tests passed: --help, --version, invalid command.');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}

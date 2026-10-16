import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const client=fileURLToPath(new URL('../client/',import.meta.url));
const shellSource=fs.readFileSync(path.join(client,'Install.sh'),'utf8');
const isPosix=process.platform!=='win32';
const find=command=>spawnSync('/bin/sh',['-c','command -v '+command],{encoding:'utf8'}).stdout?.trim();
const python=isPosix?find('python3'):undefined;
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
function temporary(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-bootstrap-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function run(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Bootstrap timed out: '+output));},15000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output});});
  });
}
const fakeNode=`#!/bin/sh
if [ "$1" = --version ]; then printf 'v24.19.0\\n'; exit 0; fi
case "$1" in */npm-cli.js)
 IFS= read -r CONTENT < "$1" || exit 3
 [ "$CONTENT" = fixture-npm ] || exit 3
 printf '11.6.0\\n'; exit 0;;
esac
printf '%s\\n' "$@" > "$BOOTSTRAP_RESULT"
printf 'INSTALLER_OK\\n'
`;
function writeNode(root,{version='24.19.0',npm='good',executable=true}={}) {
  const runtime=path.join(root,'runtime','node-v24.19.0-linux-x64');
  fs.mkdirSync(path.join(runtime,'bin'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'bin','node'),fakeNode.replace('v24.19.0','v'+version),{mode:executable?0o700:0o600});
  if(npm!=='missing') {
    fs.mkdirSync(path.join(runtime,'lib/node_modules/npm/bin'),{recursive:true});
    fs.writeFileSync(path.join(runtime,'lib/node_modules/npm/bin/npm-cli.js'),npm==='good'?'fixture-npm\n':'broken npm\n');
  }
}
function tarArchive(directory,{malicious=false}={}) {
  const filename=path.join(directory,'fixture.tar.gz');
  const code=`import io, json, sys, tarfile
data=json.load(sys.stdin)
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    for name, content, mode in data:
        member=tarfile.TarInfo(name)
        member.mode=mode
        value=content.encode()
        member.size=len(value)
        archive.addfile(member, io.BytesIO(value))
`;
  const prefix='node-v24.19.0-linux-x64';
  const entries=malicious?[['../escaped','never write here',0o600]]:[[prefix+'/bin/node',fakeNode,0o755],[prefix+'/lib/node_modules/npm/bin/npm-cli.js','fixture-npm\n',0o644]];
  const child=spawnSync(python,['-c',code,filename],{input:JSON.stringify(entries),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  return fs.readFileSync(filename);
}
async function posixFixture(t,{withPython=true,archive,withTar=false,withHasher=false}={}) {
  const root=temporary(t),bin=path.join(root,'bin'),source=path.join(root,'source'),temp=path.join(root,'temp'),data=path.join(root,'data');
  for(const directory of [bin,source,temp])fs.mkdirSync(directory);
  for(const name of ['dirname','mktemp','rm','chmod'])fs.symlinkSync(find(name),path.join(bin,name));
  fs.writeFileSync(path.join(bin,'uname'),'#!/bin/sh\nif [ "$1" = -s ]; then printf "Linux\\n"; else printf "x86_64\\n"; fi\n',{mode:0o700});
  if(withPython)fs.symlinkSync(python,path.join(bin,'python3'));
  if(withTar)for(const name of ['tar','gzip'])fs.symlinkSync(find(name),path.join(bin,name));
  if(withHasher) {
    const name=find('sha256sum')?'sha256sum':'shasum';
    fs.symlinkSync(find(name),path.join(bin,name));
  }
  let requests=0,privateTemp=true;
  const body=archive??(python?tarArchive(root):Buffer.from('not a runtime'));
  const server=http.createServer((_req,res)=>{
    requests++;
    for(const name of fs.readdirSync(temp))privateTemp&&=(fs.statSync(path.join(temp,name)).mode&0o777)===0o700;
    res.writeHead(200,{'content-type':'application/gzip'});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  // Only the disposable test copy trusts the fixture hash and local fixture URL.
  // The shipped entry point has no checksum bypass or alternate download flag.
  const script=shellSource.replace(/HASH=[a-f0-9]{64}/g,'HASH='+createHash('sha256').update(body).digest('hex')).replace('URL="https://nodejs.org/dist/v$VERSION/$FILE"','URL="http://127.0.0.1:'+server.address().port+'/fixture.tar.gz"');
  fs.writeFileSync(path.join(source,'Install.sh'),script);
  fs.writeFileSync(path.join(source,'install.mjs'),'fixture only; the fake runtime records arguments');
  const log=path.join(root,'installer-arguments');
  const env={...process.env,PATH:bin,HOME:root,TMPDIR:temp,BOOTSTRAP_RESULT:log};
  return {root,bin,source,temp,data,log,env,get requests(){return requests;},get privateTemp(){return privateTemp;},run:args=>run('/bin/sh',[path.join(source,'Install.sh'),...args],{env})};
}

test('POSIX validates missing and conflicting mode options before any bootstrap work',{skip:!isPosix},async t=>{
  const directory=temporary(t);
  for(const args of [['--mode'],['--mode','--stop'],['--mode','invalid'],['--root'],['--root','--no-start'],['--mode','manual','--mode','background'],['--no-start','--mode','background'],['--stop','--uninstall'],['--purge']]) {
    const response=await run('/bin/sh',[path.join(client,'Install.sh'),...args],{env:{...process.env,PATH:directory,HOME:directory,TMPDIR:directory}});
    assert.notEqual(response.code,0,JSON.stringify(args));
    assert.doesNotMatch(response.output,/正在准备|缺少基础工具/,JSON.stringify(args));
  }
  assert.deepEqual(fs.readdirSync(directory),[]);
});

test('POSIX Python-only environment downloads, hashes and safely extracts without curl, wget or tar',{skip:!isPosix||!python},async t=>{
  const f=await posixFixture(t);
  const response=await f.run(['--root',f.data,'--mode','manual','--no-browser']);
  assert.equal(response.code,0,response.output);assert.match(response.output,/INSTALLER_OK/);
  assert.equal(f.requests,1);assert.equal(f.privateTemp,true);
  assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n'),[path.join(f.source,'install.mjs'),'--root',f.data,'--mode','manual','--no-browser']);
  assert.deepEqual(fs.readdirSync(f.temp),[],'temporary runtime is always removed');
  assert.equal(fs.existsSync(f.data),false,'test never installs a client or changes startup');
});

test('POSIX also supports native tar and SHA utilities with the Python downloader',{skip:!isPosix||!python},async t=>{
  const f=await posixFixture(t,{withTar:true,withHasher:true});
  const response=await f.run(['--root',f.data,'--no-start']);
  assert.equal(response.code,0,response.output);assert.equal(f.requests,1);assert.ok(fs.existsSync(f.log));
});

test('POSIX reuses a verified working Node and npm without network or download tools',{skip:!isPosix},async t=>{
  const f=await posixFixture(t,{withPython:false});
  writeNode(f.data);
  const response=await f.run(['--root',f.data,'--mode','background','--no-browser']);
  assert.equal(response.code,0,response.output);assert.equal(f.requests,0);
  assert.match(fs.readFileSync(f.log,'utf8'),/--mode\nbackground/);
});

for(const [name,options] of [['wrong Node version',{version:'22.0.0'}],['non-executable Node',{executable:false}],['missing npm',{npm:'missing'}],['broken npm',{npm:'broken'}]]) {
  test('POSIX rebuilds an existing runtime with '+name,{skip:!isPosix||!python},async t=>{
    const f=await posixFixture(t);writeNode(f.data,options);
    const response=await f.run(['--root',f.data,'--mode','manual','--no-start']);
    assert.equal(response.code,0,response.output);assert.match(response.output,/修复/);
    assert.equal(f.requests,1);assert.ok(fs.existsSync(f.log));
  });
}

test('POSIX repairs a non-running Node executable instead of blindly reusing its path',{skip:!isPosix||!python},async t=>{
  const f=await posixFixture(t);writeNode(f.data);
  fs.writeFileSync(path.join(f.data,'runtime/node-v24.19.0-linux-x64/bin/node'),'#!/bin/sh\nexit 126\n',{mode:0o700});
  const response=await f.run(['--root',f.data,'--no-start']);
  assert.equal(response.code,0,response.output);assert.equal(f.requests,1);
});

test('POSIX refuses a bad download and cleans the private runtime before executing anything',{skip:!isPosix||!python},async t=>{
  const f=await posixFixture(t);
  const script=path.join(f.source,'Install.sh');
  fs.writeFileSync(script,fs.readFileSync(script,'utf8').replace(/HASH=[a-f0-9]{64}/g,'HASH='+'0'.repeat(64)));
  const response=await f.run(['--root',f.data,'--no-start']);
  assert.notEqual(response.code,0);assert.match(response.output,/checksum mismatch/);
  assert.equal(f.requests,1);assert.equal(fs.existsSync(f.log),false);assert.deepEqual(fs.readdirSync(f.temp),[]);
});

test('POSIX Python fallback rejects archive traversal even with the fixture checksum',{skip:!isPosix||!python},async t=>{
  const archive=tarArchive(temporary(t),{malicious:true}),f=await posixFixture(t,{archive});
  const response=await f.run(['--root',f.data,'--no-start']);
  assert.notEqual(response.code,0);assert.match(response.output,/安全解压失败/);
  assert.equal(fs.existsSync(path.join(f.temp,'escaped')),false);assert.equal(fs.existsSync(f.log),false);
});

test('POSIX reports missing download, hash and extraction prerequisites before network activity',{skip:!isPosix},async t=>{
  for(const missing of ['download','hash','extract']) {
    const f=await posixFixture(t,{withPython:false,withHasher:missing==='extract'});
    if(missing!=='download')fs.writeFileSync(path.join(f.bin,'curl'),'#!/bin/sh\nprintf invoked > '+quote(path.join(f.root,'network-called'))+'\nexit 1\n',{mode:0o700});
    const response=await f.run(['--root',f.data,'--no-start']);
    assert.notEqual(response.code,0);assert.match(response.output,missing==='download'?/下载环境/:missing==='hash'?/SHA-256 校验环境/:/解压环境/);
    assert.equal(f.requests,0);assert.equal(fs.existsSync(path.join(f.root,'network-called')),false);
  }
});

test('Windows PowerShell parses the entry point and validates flags before downloading',{skip:process.platform!=='win32'},async t=>{
  const directory=temporary(t),script=path.join(client,'install.ps1');
  const parser="$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+script.replaceAll("'","''")+"',[ref]$null,[ref]$errors)|Out-Null;if($errors){$errors|Out-String|Write-Host;exit 1}";
  const syntax=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',parser]);
  assert.equal(syntax.code,0,syntax.output);
  for(const args of [['--mode'],['--root'],['--mode','invalid'],['--no-start','--mode','background'],['--stop','--uninstall']]) {
    const response=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{env:{...process.env,TEMP:directory,TMP:directory}});
    assert.notEqual(response.code,0,JSON.stringify(args));assert.doesNotMatch(response.output,/正在准备/);
  }
  assert.deepEqual(fs.readdirSync(directory),[]);
});

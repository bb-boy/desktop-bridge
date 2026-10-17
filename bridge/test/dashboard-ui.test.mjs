import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/style.css'),'utf8');

function platformInfoForTest(){
  const start=script.indexOf('function platformInfo(');
  const end=script.indexOf('function osIcon(',start);
  assert.ok(start>=0&&end>start);
  const context={};
  vm.runInNewContext(script.slice(start,end)+';globalThis.lookup=platformInfo;',context);
  return context.lookup;
}

test('Dashboard: each platform has the correct human-readable system label',()=>{
  const info=platformInfoForTest();
  for(const [platform,name,kind] of [
    ['darwin','macOS','macos'],
    ['win32','Windows','windows'],
    ['linux','Linux','linux'],
    ['win','Windows','windows']
  ]){
    const actual=info(platform);
    assert.equal(actual.name,name);
    assert.equal(actual.kind,kind);
    assert.match(html,new RegExp('<symbol id="os-'+kind+'"'));
  }
  assert.equal(info('freebsd').name,'freebsd');
});

test('Dashboard: Apple, Windows and Linux have visibly different SVG logos across device views',()=>{
  const mac=html.match(/<symbol id="os-macos"[^>]*>([\s\S]*?)<\/symbol>/)?.[1];
  const windows=html.match(/<symbol id="os-windows"[^>]*>([\s\S]*?)<\/symbol>/)?.[1];
  const linux=html.match(/<symbol id="os-linux"[^>]*>([\s\S]*?)<\/symbol>/)?.[1];
  assert.ok(mac&&windows&&linux);
  assert.notEqual(mac,windows);
  assert.notEqual(mac,linux);
  assert.match(mac,/scale\(2\)/,'macOS uses the Apple silhouette rather than a generic display');
  assert.match(script,/open\.append\(osIcon\(d\.platform\)/);
  assert.match(script,/intro\.append\(osIcon\(d\.platform\)/);
  assert.ok(script.includes("['系统',platformInfo(d.platform).name]"));
  assert.match(script,/detail\.append\(osIcon\(p\.platform\)/);
  assert.match(css,/\.pair-platform \.os-icon/);
});

test('Dashboard: Google unlink belongs to account settings, accessible from avatar menu',()=>{
  assert.match(html,/id="account-settings"[^>]*>账号设置<\/button>/);
  assert.match(html,/id="tab-account"[^>]*>账号设置<\/button>/);
  const authorizationPanel=html.split('<section id="authorizations-tab"')[1].split('<section id="account-tab"')[0];
  const accountPanel=html.split('<section id="account-tab"')[1];
  assert.ok(authorizationPanel&&!authorizationPanel.includes('google-panel'));
  assert.match(authorizationPanel,/id="authorizations"/);
  assert.match(accountPanel,/id="google-panel"/);
  assert.match(accountPanel,/id="google-unlink"[^>]*>解除 Google 绑定<\/button>/);
  assert.match(accountPanel,/id="google-unlink-hint"/);
  assert.match(accountPanel,/id="password-form"/);
  assert.ok(script.includes("$('#account-settings').onclick=()=>{closeAccountMenu();selectTab($('#tab-account'))"));
  assert.ok(script.includes("$('#google-unlink').disabled=!g.canUnlink"));
});

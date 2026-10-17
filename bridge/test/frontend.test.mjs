import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
const css=fs.readFileSync(path.join(publicDir,'style.css'),'utf8');
const js=fs.readFileSync(path.join(publicDir,'app.js'),'utf8');

test('dashboard retains all DOM element IDs referenced by the controller',()=>{
  const ids=[...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m=>m[1]);
  const htmlIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const missing=[...new Set(ids)].filter(id=>!htmlIds.has(id));
  assert.deepEqual(missing,[]);
  assert.equal(htmlIds.size,[...html.matchAll(/\bid="([^"]+)"/g)].length,'Duplicate DOM IDs are not allowed');
});
test('dashboard separates online capable devices from count of callable tools',()=>{
  assert.match(html,/可用设备<\/span><strong id="stat-ready"/);
  assert.match(html,/可调用工具<\/span><strong id="stat-tools"/);
  assert.match(js,/\$\('#stat-ready'\)\.textContent=d\.readyDevices/);
  assert.match(js,/\$\('#stat-tools'\)\.textContent=d\.toolCount/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('accessible tab panels and result dialog remain wired correctly',()=>{
  for(const tab of ['devices','calls','authorizations']){
    assert.match(html,new RegExp('id="tab-'+tab+'"[^>]*role="tab"[^>]*aria-controls="'+tab+'-tab"'));
    assert.match(html,new RegExp('id="'+tab+'-tab"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-'+tab+'"'));
  }
  assert.match(html,/id="result-dialog"[^>]*aria-labelledby="result-heading"/);
  assert.match(html,/id="message"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(js,/setAttribute\('aria-selected',String\(active\)\)/);
  assert.match(js,/e\.key==='ArrowRight'/);
  assert.match(js,/e\.key==='Home'/);
});
test('responsive style preserves focus states, hidden controls and consent page styles',()=>{
  assert.match(css,/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css,/@media\s*\(max-width:\s*650px\)/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/:focus-visible/);
  for(const cls of ['.card','.notice','.error','.device','.pair-box','.badge','.row','.tabs'])assert.ok(css.includes(cls),cls);
  assert.match(html,/name="viewport"/);
  assert.match(html,/href="\/style\.css"/);
  assert.match(html,/src="\/app\.js"/);
});
test('plain text render operations keep device names and task details out of HTML interpolation',()=>{
  assert.match(js,/n\.textContent=text/);
  assert.match(js,/result-content'\)\.textContent/);
  assert.doesNotMatch(js,/innerHTML\s*=/);
});


test('NES.css 2.3.0 assets are bundled locally, with actual pixel components',()=>{
  const vendor=path.join(publicDir,'vendor/nes.css');
  const nes=fs.readFileSync(path.join(vendor,'nes.min.css'),'utf8');
  const license=fs.readFileSync(path.join(vendor,'LICENSE'),'utf8');
  assert.match(html,/href="\/vendor\/nes\.css\/nes\.min\.css"/);
  assert.match(html,/class="[^"]*nes-container/);
  assert.match(html,/class="[^"]*nes-btn/);
  assert.match(html,/class="nes-input"/);
  assert.match(nes,/nes-btn/);
  assert.match(license,/MIT License/);
  assert.doesNotMatch(html,/https?:\/\/(?:unpkg|cdn)\./i);
});

test('Google login stays discoverable but unavailable if OAuth is not configured',()=>{
  assert.match(html,/<button id="google-login"[^>]*hidden>/);
  assert.match(js,/googleButton\.hidden=false/);
  assert.match(js,/googleButton\.disabled=!googleEnabled/);
  assert.match(js,/querySelector\('\.google-text'\)\.textContent='使用 Google 登录'/);
  assert.match(html,/id="google-availability"[^>]*role="status"/);
  assert.match(html,/class="google-login-card"/);
  assert.match(css,/#google-login\.google-button:disabled\s*\{[^{]*opacity:1/);
  assert.match(html,/class="password-login-heading"/);
  assert.match(js,/auth\/google\/start/);
});

test('installers are shown only inside authenticated device management',()=>{
  const login=html.split('<section id="login-panel"')[1].split('<section id="app-panel"')[0];
  const app=html.split('<section id="app-panel"')[1];
  assert.doesNotMatch(login,/install-section|Mac 安装器|Windows 安装器|Linux 安装器/);
  assert.match(app,/id="device-install"/);
  for(const name of ['Mac 安装器','Windows 安装器','Linux 安装器'])assert.match(app,new RegExp(name));
  assert.match(app,/href="\/start\.html">配置 ChatGPT 连接/);
  assert.doesNotMatch(html,/href="\/downloads\/desktop-bridge-plugin\.zip"/);
});

test('revoked device history is hidden in the dashboard without changing authorization enforcement',()=>{
  assert.doesNotMatch(html,/revoked-section|revoked-devices|已撤销授权的设备/);
  assert.doesNotMatch(js,/renderRevoked|\/api\/manage\/revoked-devices/);
});
test('pairing decisions use green confirmation and gray rejection',()=>{
  assert.match(js,/if\(cls==='success'\)b\.classList\.add\('is-success'\)/);
  assert.match(js,/await refresh\(\);},'success'\),button\('拒绝'/);
  assert.match(js,/decision:'deny'[\s\S]*?'secondary'\)\)/);
  assert.match(css,/#pair-preview button\.nes-btn\.secondary\{background:#d7dadd/);
});
test('recent task results are capped at 100 in the dashboard',()=>{
  assert.match(html,/最近 100 条任务与结果/);
  assert.match(js,/sort\(\(a,b\)=>b\.started-a\.started\)\.slice\(0,100\)/);
});

test('onboarding and device management links use strong, contrasting pixel buttons',()=>{
  const guide=fs.readFileSync(path.join(publicDir,'start.html'),'utf8');
  assert.match(html,/class="header-link header-action header-guide" href="\/start.html">新手指引<\/a>/);
  assert.match(guide,/class="header-link header-action header-device" href="\/">设备管理<\/a>/);
  assert.match(html,/id="tab-devices"[^>]+>设备管理<\/button>/);
  assert.match(css,/\.header-action \{[^}]*border:4px solid var\(--ink\);[^}]*box-shadow:6px 6px 0/);
  assert.match(css,/button#tab-devices.active/);
});
test('long account names are highlighted and ellipsized, preserving full tooltip text',()=>{
  assert.match(css,/\.account #account-name \{[^}]*text-overflow:ellipsis/);
  assert.match(css,/\.account #account-name \{[^}]*border:2px solid var\(--ink\)/);
  assert.match(js,/\$\('#account-name'\).title=account\?\.username\?\?''/);
});
test('new-user guide keeps both native and npm installation methods',()=>{
  const guide=fs.readFileSync(path.join(publicDir,'start.html'),'utf8');
  for(const name of ['方式一：图形安装器','方式二：npm 命令行','Windows 安装器','Mac 安装器','Linux 安装器','npm install -g @justlovepl/desktop-bridge','desktop-bridge setup','desktop-bridge status','desktop-bridge update','desktop-bridge pair','setup --mode manual']){
    assert.ok(guide.includes(name),'Missing onboarding text: '+name);
  }
  assert.match(guide,/id="installation-options"/);
  assert.match(html,/href="\/start.html#installation-options"/);
  assert.match(css,/\.install-methods \{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

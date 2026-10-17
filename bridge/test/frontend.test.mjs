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
  assert.match(js,/googleEnabled\?'使用 Google 登录'/);
  assert.match(js,/auth\/google\/start/);
});

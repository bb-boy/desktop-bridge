import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

/**
 * Upgrade npm CLI first, then let the NEW package's installer update the
 * separate per-user client runtime. Credentials stay in the user data root.
 */
export function findNpmCli({node=process.execPath,env=process.env}={}){
  const bin=path.dirname(node);
  const candidates=[
    env.npm_execpath,
    path.join(bin,'node_modules','npm','bin','npm-cli.js'),
    path.resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js')
  ];
  const found=candidates.find(p=>p&&path.basename(p)==='npm-cli.js'&&fs.existsSync(p));
  if(!found)throw new Error('Cannot locate npm-cli.js. Install npm alongside Node.js 24 or run npm update -g manually.');
  return found;
}

export async function runProcess(executable,args){
  const child=spawn(executable,args,{stdio:'inherit',windowsHide:false});
  return await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>resolve(signal?128:code??1));
  });
}

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{throw new Error('Cannot read valid JSON from '+path.basename(file));}
}
const identityFields=['deviceToken','deviceId','serverUrl','userId','accountId','ownerId','tenantId','deviceName','accountHint'];
function getIdentity(config){
  return Object.fromEntries(identityFields.filter(name=>Object.hasOwn(config,name)).map(name=>[name,config[name]]));
}

export async function performUpdate({
  root,packageRoot,packageName='@justlovepl/desktop-bridge',
  npmScript,execute=runProcess,print=message=>console.log(message)
}){
  const installed=path.join(root,'launch.json');
  if(!fs.existsSync(installed))throw new Error('Local client not installed. Run desktop-bridge setup before updating.');
  if(path.resolve(root)===path.resolve(packageRoot)||path.resolve(packageRoot).startsWith(path.resolve(root)+path.sep))
    throw new Error('Client data directory must not contain the npm package.');
  const configFile=path.join(root,'agent-config.json');
  const settingsFile=path.join(root,'client-settings.json');
  const config=readJson(configFile),settings=readJson(settingsFile);
  if(!config.deviceId||!config.deviceToken)throw new Error('Device is not paired. Run desktop-bridge pair before updating.');
  if(!['manual','background'].includes(settings.mode))
    throw new Error('Cannot identify saved startup mode; refusing an update that might change it.');
  if(fs.existsSync(path.join(root,'auth-status.json'))&&readJson(path.join(root,'auth-status.json')).authStatus==='re_pair_required')
    throw new Error('Device authorization is revoked. Re-pair it before updating.');
  const previousIdentity=getIdentity(config);
  const previousMode=settings.mode;
  const previousPrivilege=settings.privilege??'standard';
  const journalFile=path.join(root,'journal.json');
  const oldJournal=fs.existsSync(journalFile)?readJson(journalFile):null;
  const installedPackage=readJson(path.join(packageRoot,'package.json'));
  if(!/^\d+\.\d+\.\d+$/.test(installedPackage.version))throw new Error('Unsupported CLI version; refusing an unsafe update.');
  const npmCli=npmScript??findNpmCli();
  print('Updating npm CLI (device credentials and configuration are kept outside npm)...');
  // A locally tested newer build must not silently downgrade to an older
  // published client. npm resolves the newest matching stable release.
  const npmStatus=await execute(process.execPath,[npmCli,'install','--global','--no-audit','--no-fund',packageName+'@>='+installedPackage.version]);
  if(npmStatus!==0)throw new Error('npm package update failed; local client was not reinstalled.');
  const packageFile=path.join(packageRoot,'package.json');
  const current=readJson(packageFile);
  if(current.name!==packageName)throw new Error('Updated npm package identity is unexpected. Client was not modified.');
  const newEntry=path.join(packageRoot,'bin','desktop-bridge.mjs');
  if(!fs.existsSync(newEntry))throw new Error('Updated CLI entry missing; local client was not modified.');
  print('npm CLI updated to '+current.version+'. Upgrading local Agent in '+previousMode+' mode...');
  // The new package's installer reuses an existing approved device token.
  // --no-browser means routine upgrades must not open an unsolicited login tab.
  const installStatus=await execute(process.execPath,[
    newEntry,'setup','--mode',previousMode,'--no-browser','--root',root
  ]);
  if(installStatus!==0)throw new Error('Agent update failed; do not manually erase device data. Check status and retry or repair.');
  const updatedConfig=readJson(configFile);
  for(const [key,value] of Object.entries(previousIdentity)){
    if(updatedConfig[key]!==value)
      throw new Error('Authorization or account binding changed during upgrade ('+key+'). Do not restore revoked tokens; check account and re-pair if needed.');
  }
  const updatedSettings=readJson(settingsFile);
  if(updatedSettings.mode!==previousMode||(updatedSettings.privilege??'standard')!==previousPrivilege)
    throw new Error('Startup mode or privilege changed unexpectedly during upgrade. Inspect settings before restarting.');
  if(oldJournal){
    const updatedJournal=readJson(journalFile);
    for(const [id,entry] of Object.entries(oldJournal)){
      if(entry?.status==='completed'&&(!entry.time||Date.now()-entry.time<30*86400000)&&!Object.hasOwn(updatedJournal,id))
        throw new Error('Recent completed task journal entry missing after upgrade: '+id);
    }
  }
  print('Update complete: npm CLI '+current.version+', device identity and '+previousMode+' startup mode preserved.');
  return 0;
}

import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
export function saveConfig(filename,config) {
  fs.writeFileSync(filename+'.tmp',JSON.stringify(config,null,2),{mode:0o600});
  fs.renameSync(filename+'.tmp',filename);
}
export async function pairDevice(config,filename,{openBrowser=true,intervalMs}={}) {
  const server=new URL(config.serverUrl);
  if(server.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(server.hostname))throw new Error('配对需要 HTTPS');
  const response=await fetch(new URL('/api/pair/start',server),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:config.deviceName??os.hostname(),platform:process.platform,version:'0.2.1'}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('无法开始配对，请检查网络');
  const p=await response.json();
  console.log('请在网页登录并确认这台电脑。配对码：'+p.userCode+'\n'+p.verificationUri);
  if(openBrowser) {
    const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
    const args=process.platform==='win32'?['url.dll,FileProtocolHandler',p.verificationUri]:[p.verificationUri];
    const child=spawn(command,args,{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();
  }
  const deadline=Date.now()+p.expiresIn*1000;
  while(Date.now()<deadline) {
    await new Promise(r=>setTimeout(r,intervalMs??p.interval*1000));
    let poll;
    try{poll=await fetch(new URL('/api/pair/poll',server),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceCode:p.deviceCode}),signal:AbortSignal.timeout(15000)});}catch{continue;}
    if(poll.status===202||poll.status===429||poll.status>=500)continue;
    if(!poll.ok)throw new Error('配对被拒绝或已过期，请重新运行安装程序');
    const credentials=await poll.json();config.deviceId=credentials.deviceId;config.deviceToken=credentials.deviceToken;
    saveConfig(filename,config);console.log('电脑已绑定，凭据已自动保存。');return config;
  }
  throw new Error('配对超时，请重新运行安装程序');
}

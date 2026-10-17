import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {startupFile} from './lifecycle.mjs';
export function parseInstallerOptions(args) {
 const options={};
 const switches={'--repair':'repair','--no-browser':'noBrowser','--no-start':'noStart','--stop':'stop','--uninstall':'uninstall','--purge':'purge','--administrator':'administrator'};
 for(let i=0;i<args.length;i++){
  const flag=args[i];
  if(flag==='--root'||flag==='--mode'){
   const value=args[++i];if(!value||value.startsWith('--'))throw new Error(flag+' requires a value');
   const key=flag.slice(2);if(options[key]&&options[key]!==value)throw new Error('Conflicting '+flag+' values');options[key]=value;
  }else if(switches[flag])options[switches[flag]]=true;
  else throw new Error('Unknown option: '+flag);
 }
 if(options.mode&&!['manual','background'].includes(options.mode))throw new Error('--mode must be manual or background');
 if(options.noStart&&options.mode==='background')throw new Error('--no-start selects manual mode and conflicts with --mode background');
 if(options.noStart)options.mode='manual';
 if(options.administrator&&(options.stop||options.uninstall))throw new Error('Administrator maintenance uses admin-elevate.mjs, not normal uninstall/stop.');
 if(options.purge&&!options.uninstall)throw new Error('--purge requires --uninstall');
 if(options.stop&&options.uninstall)throw new Error('--stop and --uninstall cannot be combined');
 if((options.stop||options.uninstall)&&(options.mode||options.repair))throw new Error('Maintenance actions cannot be combined with --mode, --no-start or --repair');
 return options;
}
export function savedMode(root) {
 try{const mode=JSON.parse(fs.readFileSync(path.join(root,'client-settings.json'),'utf8')).mode;if(['manual','background'].includes(mode))return mode;throw new Error('Invalid saved mode');}
 catch(error){if(error.code!=='ENOENT')throw new Error('Cannot read saved client mode: '+error.message);}
 // Preserve the actual choice of installations created before settings existed.
 if(fs.existsSync(path.join(root,'.desktop-bridge-client'))||fs.existsSync(path.join(root,'agent-config.json')))return fs.existsSync(startupFile(root))?'background':'manual';
}
export async function chooseMode(options,{previous,interactive=!!(process.stdin.isTTY&&process.stdout.isTTY),ask}={}) {
 if(options.stop||options.uninstall)return;
 if(options.mode)return options.mode;
 if(!interactive)throw new Error('请选择运行模式：非交互式安装必须提供 --mode manual 或 --mode background。--no-start 等同手动模式。');
 let readline;
 if(!ask){readline=createInterface({input:process.stdin,output:process.stdout});ask=question=>readline.question(question);}
 try{
  for(;;){
   const answer=(await ask('请选择 Desktop Bridge 的运行方式：\n  1) 手动模式 manual：使用时运行启动命令，保持窗口，Ctrl+C 结束。\n  2) 后台模式 background：现在后台运行，登录系统后自动启动。\n输入 1 或 2（必须选择，回车不使用默认值）: ')).trim().toLowerCase();
   if(['1','manual'].includes(answer))return 'manual';if(['2','background'].includes(answer))return 'background';
  }
 }finally{readline?.close();}
}

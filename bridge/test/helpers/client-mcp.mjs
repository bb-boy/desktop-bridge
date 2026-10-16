import fs from 'node:fs';
import readline from 'node:readline';
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const message=JSON.parse(line);if(!('id' in message))return;
 let result={};
 if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'client-fixture',version:'1'}};
 if(message.method==='tools/list')result={tools:[{name:'get_config',inputSchema:{type:'object'}},{name:'increment',inputSchema:{type:'object'}}]};
 if(message.method==='tools/call'){
  let count=0;try{count=Number(fs.readFileSync('counter.txt','utf8'));}catch{}
  if(message.params.name==='increment')fs.writeFileSync('counter.txt',String(++count));
  result={content:[{type:'text',text:String(count)}]};
 }
 send({jsonrpc:'2.0',id:message.id,result});
});
process.stdin.on('end',()=>process.exit(0));

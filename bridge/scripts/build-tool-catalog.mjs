// Run with the extracted/installed, lockfile-pinned Desktop Commander package directory.
// Reads only tool schemas and the list definition; never starts the engine or reads device config.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root=path.resolve(process.argv[2]);
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const metadata=JSON.parse(read('package.json'));
const lock=JSON.parse(fs.readFileSync(new URL('../client/package-lock.json',import.meta.url)));
const pinned=lock.packages['node_modules/@wonderwhy-er/desktop-commander'];
if(metadata.name!=='@wonderwhy-er/desktop-commander'||metadata.version!==pinned.version)throw new Error('Use the pinned Desktop Commander package');
const source=read('dist/server.js');
const start=source.indexOf('const allTools = [');
const end=source.indexOf('// Filter tools based on current client',start);
if(start<0||end<0)throw new Error('Upstream list definition changed; review the generator');
const schemas=await import(pathToFileURL(path.join(root,'dist/tools/schemas.js')));
const {zodToJsonSchema}=createRequire(path.join(root,'package.json'))('zod-to-json-schema');
const tools=vm.runInNewContext(source.slice(start,end)+'\nallTools;',{
  ...schemas,zodToJsonSchema,
  // Discovery is shared across Windows, macOS and Linux. Never embed build-host guidance.
  PATH_GUIDANCE:'Use absolute paths for the selected device and its operating system.',
  OS_GUIDANCE:'Check the selected device platform and configuration before choosing shell syntax.',
  CMD_PREFIX_DESCRIPTION:'',
  showMcpUiPreviews:false,buildUiToolMeta:()=>undefined,
  CONFIG_EDITOR_RESOURCE_URI:'',FILE_PREVIEW_RESOURCE_URI:''
},{timeout:5000}).map(({name,description,inputSchema,annotations,outputSchema})=>({
  name,description:description.trim(),inputSchema,...(annotations?{annotations}:{}),...(outputSchema?{outputSchema}:{})
}));
if(tools.length!==25||new Set(tools.map(t=>t.name)).size!==25||tools.some(t=>t.inputSchema.type!=='object'))throw new Error('Unexpected catalog; review the pinned engine update');
const catalog={source:{package:metadata.name,version:metadata.version,integrity:pinned.integrity,
  serverSha256:createHash('sha256').update(source).digest('hex'),
  schemasSha256:createHash('sha256').update(read('dist/tools/schemas.js')).digest('hex')},tools};
fs.writeFileSync(new URL('../server/desktop-commander-tools.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
console.log(`Bundled ${tools.length} tools from ${metadata.name}@${metadata.version}`);

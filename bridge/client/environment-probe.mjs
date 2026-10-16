import {probeModules,verifyLocalToolsInProcess} from './environment.mjs';
const [action,release,workingDirectory]=process.argv.slice(2);
if(action==='dependencies')await probeModules(release);
else if(action==='tools')await verifyLocalToolsInProcess({node:process.execPath,release,workingDirectory});
else throw new Error('Unknown environment probe');

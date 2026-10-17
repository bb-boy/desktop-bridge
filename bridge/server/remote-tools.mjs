const deviceSchema={type:'object',properties:{device_id:{type:'string',description:'Device ID from list_devices. Optional when exactly one device is paired.'}},additionalProperties:false};
export const remoteTools=[
  {name:'who_am_i',description:'Show your authenticated account, device counts and this UTC month’s authenticated MCP tool-call attempts, including failed calls and this query. Counts start when tracking is first used. This self-hosted service has no monthly quota; limit and percentage are null.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'ping',description:'Send a fresh network probe to your selected device and report round-trip latency and a server timestamp. This checks the remote agent connection, separately from local tool health.',inputSchema:deviceSchema,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'shutdown',description:'Stop the selected Desktop Bridge agent and its local tool engine, disconnecting remote access until the client is started locally. May terminate active terminal sessions. Does not shut down the computer, unlink it, or erase credentials. Requires an updated client; refuses while another tool call is executing. Use get_call_result for an uncertain outcome instead of retrying.',inputSchema:deviceSchema,annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}}
];
export function accountInfo(store,broker,owner) {
  const account=store.accountById(owner);
  if(!account)throw new Error('Account no longer exists');
  const devices=broker.devices(owner);
  return {account:{id:account.id,username:account.username},devices:{paired:devices.length,online:devices.filter(d=>d.networkConnected).length,toolsAvailable:devices.filter(d=>d.toolsAvailable).length},usage:{...store.monthlyUsage(owner),timezone:'UTC',limit:null,percentage:null,unlimited:true}};
}
export function validateDeviceArgs(args={}) {
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='device_id')||(args.device_id!==undefined&&(typeof args.device_id!=='string'||!args.device_id)))throw new Error('Only an optional nonempty device_id is accepted');
  return args;
}

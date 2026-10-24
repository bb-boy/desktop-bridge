// Trusted, conservative annotations for the remote desktop tool surface.
// MCP annotations are hints to ChatGPT, NEVER authorization.
const desktopRead=new Set([
  'get_config','read_file','read_multiple_files','list_directory',
  'get_file_info','read_process_output','list_sessions','list_processes',
  'get_usage_stats','get_recent_tool_calls','list_searches','get_more_search_results'
]);
const cuaRead=new Set([
  'check_permissions','clipboard_read','debug_window_info','get_accessibility_tree',
  'get_agent_cursor_state','get_browser_state','get_config','get_cursor_position',
  'get_desktop_state','get_guide','get_recording_state','get_screen_size',
  'get_session','get_session_state','get_window_state','health_report',
  'list_apps','list_sessions','list_windows','parse_visual_regions',
  'verify_state','zoom'
]);
const cuaNetworkRead=new Set(['check_for_update']);
const desktopReversible=new Set(['set_config_value','stop_search','give_feedback_to_desktop_commander']);
const cuaReversible=new Set([
 'bring_to_front','end_session','escalate_session','move_cursor',
 'set_agent_cursor_enabled','set_agent_cursor_motion','set_agent_cursor_theme',
 'set_config','set_window_frame','start_session','start_recording','stop_recording'
]);
const desktopOpen=new Set(['start_process','read_file','read_multiple_files','write_file','start_search']);
const cuaOpen=new Set([
 'browser_click','browser_dialog','browser_download','browser_navigate',
 'browser_pointer','browser_prepare','browser_select','browser_set_input_files',
 'browser_type','check_for_update','run_script','run_steps','type_text'
]);
const administrativeRead=new Set(['list_devices','list_calls','get_call_result','who_am_i','ping','get_device_permissions']);
export function riskForTool(name) {
 if(typeof name!=='string') throw new TypeError('tool name must be a string');
 if(administrativeRead.has(name))return {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 if(name==='set_device_permissions')return {readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
 if(name==='shutdown')return {readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false};
 const cua=name.startsWith('cua_');
 const original=cua?name.slice(4):name;
 const read=(cua?cuaRead:desktopRead).has(original)||(cua&&cuaNetworkRead.has(original));
 const reversible=(cua?cuaReversible:desktopReversible).has(original);
 const open=(cua?cuaOpen:desktopOpen).has(original);
 // Destructive covers all potentially irreversible effects, including GUI clicks
 // that can delete data, shell commands, file overwrites or external submission.
 return {
  readOnlyHint:read,
  destructiveHint:!read&&!reversible,
  idempotentHint:read,
  openWorldHint:open
 };
}
export function annotateTool(tool) {
 return {...tool,annotations:riskForTool(tool.name)};
}
export function isReadOnlyTool(name) {
 return riskForTool(name).readOnlyHint===true;
}
export function toolSource(name) {
 return name.startsWith('cua_')?'cua':'desktop';
}

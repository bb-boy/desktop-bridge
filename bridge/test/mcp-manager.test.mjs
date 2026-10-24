import test from 'node:test';
import assert from 'node:assert/strict';
import {McpToolManager} from '../agent/mcp-manager.mjs';

const definitions = new Map();
const events = [];
const tool = name => ({name, description: name + ' tool', inputSchema: {type: 'object', properties: {}}});

class FakeTransport {
  constructor(options) { Object.assign(this, options); this.pid = 456; this.stderr = {on() {}}; }
  async close() { events.push('transport-close:' + this.command); }
}
class FakeClient {
  async connect(transport) {
    const source = definitions.get(transport.command);
    if (!source || source.connectError) throw new Error('cannot connect ' + transport.command);
    this.transport = transport;
    this.source = source;
    events.push('connect:' + transport.command);
  }
  async listTools({cursor} = {}) {
    if (this.source.listError) throw new Error('list failed');
    const pages = this.source.pages ?? [this.source.tools ?? []];
    const index = Number(cursor || 0);
    return {tools: pages[index], ...(index + 1 < pages.length ? {nextCursor: String(index + 1)} : {})};
  }
  async ping() { if (this.source.failPing) throw new Error('ping failed'); return {}; }
  async callTool({name, arguments: args}) {
    if (this.source.callError) throw new Error('call failed');
    return {content: [{type: 'text', text: JSON.stringify({engine: this.transport.command, name, args})}]};
  }
  async close() { events.push('close:' + this.transport.command); this.onclose?.(); }
}
function manager({optional = true, maxTools = 128, onLog = () => {}} = {}) {
  const backends = [{id: 'desktop', command: 'desktop', args: ['index.js'], prefix: '', optional: false}];
  if (optional) backends.push({id: 'cua', command: 'cua-driver', args: ['mcp'], prefix: 'cua_', optional: true});
  return new McpToolManager({Client: FakeClient, StdioClientTransport: FakeTransport, backends, maxTools, log: onLog});
}
test.beforeEach(() => {definitions.clear(); events.length = 0; definitions.set('desktop', {tools: [tool('read_file'), tool('write_file')]});});

test('multiplexes tool names and preserves original Desktop Commander tools', async () => {
  definitions.set('cua-driver', {pages: [[tool('click')], [tool('get_window_state')]]});
  const m = manager();
  await m.start();
  assert.deepEqual(m.listTools().tools.map(t => t.name), ['read_file', 'write_file', 'cua_click', 'cua_get_window_state']);
  assert.deepEqual(JSON.parse((await m.callTool({name: 'read_file', arguments: {path: 'hello'}})).content[0].text),
    {engine: 'desktop', name: 'read_file', args: {path: 'hello'}});
  assert.deepEqual(JSON.parse((await m.callTool({name: 'cua_click', arguments: {element_token: 's1:2'}})).content[0].text),
    {engine: 'cua-driver', name: 'click', args: {element_token: 's1:2'}});
  await m.close();
  assert.ok(events.includes('close:desktop') && events.includes('close:cua-driver'));
});

test('optional Cua missing never blocks primary backend', async () => {
  const logs = [];
  const m = manager({onLog: (event, details) => logs.push({event, details})});
  await m.start();
  assert.deepEqual(m.tools.map(t => t.name), ['read_file', 'write_file']);
  assert.equal((await m.callTool({name: 'write_file', arguments: {}})).isError, undefined);
  assert.ok(logs.some(row => row.event === 'mcp_backend_failed' && row.details.backend === 'cua'));
  await m.close();
});

test('primary MCP unavailable fails startup', async () => {
  definitions.delete('desktop');
  const m = manager();
  await assert.rejects(m.start(), /cannot connect desktop/);
});

test('optional catalog collision does not override primary tools', async () => {
  definitions.set('cua-driver', {tools: [tool('click'), tool('click')]});
  const m = manager();
  await m.start();
  assert.deepEqual(m.tools.map(t => t.name), ['read_file', 'write_file']);
  await assert.rejects(m.callTool({name: 'cua_click', arguments: {}}), /Unknown/);
  await m.close();
});

test('catalog limit skips optional backend without truncating its tools', async () => {
  definitions.set('cua-driver', {tools: [tool('click'), tool('type_text')]});
  const m = manager({maxTools: 3});
  await m.start();
  assert.deepEqual(m.tools.map(t => t.name), ['read_file', 'write_file']);
  await m.close();
});

test('optional backend closure does not close the primary backend', async () => {
  definitions.set('cua-driver', {tools: [tool('click')]});
  const m = manager();
  let closed = false;
  m.onclose = () => {closed = true;};
  await m.start();
  m.connections.get('cua').client.onclose();
  await assert.rejects(m.callTool({name: 'cua_click', arguments: {}}), /unavailable/);
  assert.equal(closed, false);
  assert.ok((await m.callTool({name: 'read_file', arguments: {}})).content.length);
  m.connections.get('desktop').client.onclose();
  assert.equal(closed, true);
  await m.close();
});

test('real MCP SDK connects two independent stdio processes on Windows', async t => {
  const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const {fileURLToPath} = await import('node:url');
  const fixture = fileURLToPath(new URL('./fixture-mcp.mjs', import.meta.url));
  const m = new McpToolManager({
    Client, StdioClientTransport,
    backends: [
      {id: 'desktop', command: process.execPath, args: [fixture], cwd: process.cwd(), env: {...process.env}},
      {id: 'cua', command: process.execPath, args: [fixture], cwd: process.cwd(), env: {...process.env}, prefix: 'cua_', optional: true}
    ]
  });
  t.after(() => m.close());
  await m.start();
  assert.deepEqual(m.tools.map(tool => tool.name), ['increment', 'cua_increment']);
  await m.ping({timeout: 5000});
});

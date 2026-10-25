/**
 * Local MCP backend aggregation. The Desktop Commander backend remains mandatory;
 * additional native desktop engines are explicitly opt-in and failure-isolated.
 * No backend starts a second Desktop Bridge process or owns device credentials.
 */
const validName = name => typeof name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(name);

export class McpToolManager {
  constructor({Client, StdioClientTransport, backends, maxTools = 128, log = () => {}}) {
    if (!Array.isArray(backends) || !backends.length || backends[0].optional) {
      throw new Error('A mandatory primary MCP backend is required');
    }
    this.Client = Client;
    this.StdioClientTransport = StdioClientTransport;
    this.specs = backends;
    this.maxTools = maxTools;
    this.log = log;
    this.connections = new Map();
    this.routes = new Map();
    this.tools = [];
    this.closed = false;
    this.onclose = null;
    this.onerror = null;
  }

  async start() {
    if (this.connections.size) throw new Error('MCP manager is already started');
    for (const spec of this.specs) {
      try {
        await this.#connect(spec);
      } catch (error) {
        this.log('mcp_backend_failed', {backend: spec.id, message: String(error.message).slice(0, 240)});
        if (!spec.optional) {
          await this.close();
          throw error;
        }
      }
    }
    return this.tools;
  }

  async #connect(spec) {
    if (!validName(spec.id) || ((spec.prefix ?? '') !== '' && !validName(spec.prefix))) {
      throw new Error('Invalid MCP backend id or prefix');
    }
    const client = new this.Client({name: 'desktop-bridge-' + spec.id, version: '0.2.7'}, {capabilities: {}});
    const transport = new this.StdioClientTransport({
      command: spec.command, args: spec.args ?? [], cwd: spec.cwd,
      env: spec.env, stderr: 'pipe'
    });
    client.onclose = () => {
      const state = this.connections.get(spec.id);
      if (state) state.ready = false;
      if (!this.closed && !spec.optional) this.onclose?.();
      else if (!this.closed) this.log('optional_mcp_closed', {backend: spec.id});
    };
    client.onerror = error => {
      this.log('mcp_backend_error', {backend: spec.id, type: error?.name ?? 'Error'});
      this.onerror?.(error);
    };

    let connected = false;
    try {
      await client.connect(transport, {timeout: 30000});
      connected = true;
      transport.stderr?.on('data', () => {}); // stderr is a stream only after startup.
      const catalog = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? {cursor} : {}, {timeout: 15000});
        if (!Array.isArray(page.tools)) throw new Error('Invalid tools/list response');
        catalog.push(...page.tools);
        cursor = page.nextCursor;
        if (catalog.length > this.maxTools) throw new Error('MCP tool catalog exceeds limit');
      } while (cursor);

      const staged = [];
      const names = new Set();
      for (const tool of catalog) {
        const publicName = (spec.prefix ?? '') + tool.name;
        if (!validName(publicName) || tool.inputSchema?.type !== 'object' ||
            names.has(publicName) || this.routes.has(publicName)) {
          throw new Error('Invalid or conflicting MCP tool: ' + publicName);
        }
        names.add(publicName);
        staged.push({...tool, name: publicName});
      }
      if (staged.length + this.tools.length > this.maxTools) {
        throw new Error('Combined MCP tool catalog exceeds ' + this.maxTools);
      }
      this.connections.set(spec.id, {client, transport, ready: true, optional: !!spec.optional});
      for (let i = 0; i < catalog.length; i++) {
        this.routes.set(staged[i].name, {backend: spec.id, nativeName: catalog[i].name});
      }
      this.tools.push(...staged);
      this.log('mcp_backend_ready', {backend: spec.id, tools: staged.length, pid: transport.pid});
    } catch (error) {
      if (connected) {
        try { await client.close(); } catch {}
      } else {
        try { await transport.close?.(); } catch {}
      }
      throw error;
    }
  }

  listTools() { return {tools: this.tools}; }

  async ping(options = {}) {
    const primary = this.connections.get(this.specs[0].id);
    if (!primary?.ready) throw new Error('Primary MCP backend unavailable');
    return primary.client.ping(options);
  }

  async callTool(request, resultSchema, options) {
    const route = this.routes.get(request.name);
    if (!route) throw new Error('Unknown local MCP tool: ' + request.name);
    const backend = this.connections.get(route.backend);
    if (!backend?.ready) throw new Error('Local MCP backend unavailable: ' + route.backend);
    return backend.client.callTool(
      {...request, name: route.nativeName}, resultSchema, options
    );
  }

  async close() {
    this.closed = true;
    await Promise.allSettled([...this.connections.values()].map(state => state.client.close()));
    this.connections.clear();
    this.routes.clear();
  }
}

# Third-party components

Desktop Bridge uses Desktop Commander MCP as its local tool engine. The currently deployed engine is `@wonderwhy-er/desktop-commander` version `0.3.0`, already pinned on p111. The original Remote client and official hosted backend are not used by this bridge's connection.

Upstream: https://github.com/wonderwhy-er/DesktopCommanderMCP

Desktop Commander MCP is MIT licensed:

Copyright (c) 2024-2025 Eduard Ruzga and Desktop Commander Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The bridge also depends on the official MCP TypeScript SDK, Express, express-rate-limit, and ws. Their licenses are included in their installed npm packages and remain applicable. `package-lock.json` pins the relay dependencies.

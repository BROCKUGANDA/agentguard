/**
 * AgentGuard demo — HTTP-based MCP server (Streamable HTTP transport)
 *
 * Unlike the stdio MCP servers, this one runs as an HTTP server on
 * port 8787. Agents connect via HTTP instead of spawning a child process.
 * This is useful for:
 *   - Remote MCP servers (shared across multiple agent processes)
 *   - Containerized MCP servers (each in its own pod)
 *   - MCP servers that need to be reachable over the network
 *
 * Tools:
 *   - http_get  (url)     -> { status, body }
 *   - http_post (url, body) -> { status, response }
 *
 * Start:  npm start
 * Agent connects to:  http://localhost:8787/mcp
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PORT = Number.parseInt(process.env.MCP_HTTP_PORT ?? '8787', 10);

const server = new Server(
  { name: 'agentguard-demo-mcp-http', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'http_get',
      description: 'Perform an HTTP GET request',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
    {
      name: 'http_post',
      description: 'Perform an HTTP POST request',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to POST to' },
          body: { type: 'string', description: 'Request body (JSON string)' },
        },
        required: ['url', 'body'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === 'http_get') {
      const url = String((args as { url: unknown }).url);
      const res = await fetch(url, { method: 'GET' });
      const body = await res.text();
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: res.status, body: body.slice(0, 1000) }) }],
      };
    }
    if (name === 'http_post') {
      const { url, body } = args as { url: string; body: string };
      const res = await fetch(url, { method: 'POST', body });
      const respBody = await res.text();
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: res.status, response: respBody.slice(0, 1000) }) }],
      };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }],
    };
  }
});

const httpServer = createServer(async (req, res) => {
  if (req.url?.startsWith('/mcp')) {
    const transport = new StreamableHTTPServerTransport();
    await server.connect(transport);
    transport.handleRequest(req, res);
  } else {
    res.writeHead(404).end('Not found. Use /mcp endpoint.');
  }
});

httpServer.listen(PORT, () => {
  console.log(`[mcp-http] ready on http://localhost:${PORT}/mcp`);
});
/**
 * AgentGuard demo — database MCP server (stdio transport)
 *
 * Exposes query and execute tools for a simulated database.
 *   - query   (sql: string)           -> { rows }
 *   - execute (sql: string)           -> { affected }
 *
 * Read-only queries are safe for analyst roles; execute (DML) is
 * gated by AgentGuard policy to developer/admin roles only.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const tables: Record<string, Array<Record<string, unknown>>> = {
  metrics: [
    { id: 1, name: 'cpu_usage', value: 42.5, date: '2026-01-15' },
    { id: 2, name: 'mem_usage', value: 68.2, date: '2026-01-15' },
  ],
  users: [
    { id: 1, name: 'alice', role: 'admin' },
    { id: 2, name: 'bob', role: 'developer' },
  ],
};

const server = new Server(
  { name: 'agentguard-demo-database', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query',
      description: 'Run a read-only SQL query (SELECT only)',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SELECT SQL statement' },
        },
        required: ['sql'],
        additionalProperties: false,
      },
    },
    {
      name: 'execute',
      description: 'Execute a DML statement (INSERT/UPDATE/DELETE)',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'DML SQL statement' },
        },
        required: ['sql'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === 'query') {
      const sql = String((args as { sql: unknown }).sql).toLowerCase();
      if (!sql.startsWith('select')) {
        throw new Error('query() only accepts SELECT statements');
      }
      const tableName = Object.keys(tables).find((t) => sql.includes(t)) ?? 'metrics';
      const rows = tables[tableName] ?? [];
      return { content: [{ type: 'text', text: JSON.stringify({ rows }) }] };
    }
    if (name === 'execute') {
      return { content: [{ type: 'text', text: JSON.stringify({ affected: 1 }) }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[database-mcp] ready');
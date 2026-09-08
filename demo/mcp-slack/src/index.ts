/**
 * AgentGuard demo — Slack MCP server (stdio transport)
 *
 * Stub Slack tools referenced by policy templates:
 *   - send_message  (channel, text)   -> { ok, ts }
 *   - list_channels ()                -> { channels }
 *
 * No real Slack API calls — this is a stub for demo/test purposes.
 * AgentGuard policy gates who can send messages and to which channels.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'agentguard-demo-slack', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_message',
      description: 'Send a message to a Slack channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel name (e.g. #alerts)' },
          text: { type: 'string', description: 'Message text' },
        },
        required: ['channel', 'text'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_channels',
      description: 'List all available Slack channels',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === 'send_message') {
      const { channel, text } = args as { channel: string; text: string };
      console.error(`[slack-mcp] send_message to ${channel}: ${text.slice(0, 80)}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, ts: Date.now() / 1000 }) }],
      };
    }
    if (name === 'list_channels') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            channels: ['#general', '#alerts', '#security', '#dev-ops'],
          }),
        }],
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[slack-mcp] ready');
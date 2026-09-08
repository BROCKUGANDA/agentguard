/**
 * AgentGuard demo — email MCP server (stdio transport)
 *
 * Mock email send. Real SMTP is out of scope for the demo; this writes the
 * email payload to ./outbox/ so the demo can show the audit trail matches
 * what would actually have been delivered.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const OUTBOX = resolve("./outbox");
await fs.mkdir(OUTBOX, { recursive: true });

const server = new Server(
  { name: "agentguard-demo-email", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send",
      description: "Send an email (mock — writes payload to local outbox)",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const log = (msg: string) => console.error(`[email-mcp] ${msg}`);

  try {
    if (name === "send") {
      const { to, subject, body } = args as {
        to: string;
        subject: string;
        body: string;
      };
      const id = randomUUID();
      const file = resolve(OUTBOX, `${Date.now()}-${id}.json`);
      await fs.writeFile(
        file,
        JSON.stringify({ to, subject, body, sentAt: Date.now() }, null, 2),
        "utf8"
      );
      log(`send -> ${to} (subject="${subject}", saved to ${file})`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, messageId: id, outbox: file }),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[email-mcp] ready, outbox=${OUTBOX}`);
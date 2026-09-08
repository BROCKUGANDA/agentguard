/**
 * AgentGuard demo — filesystem MCP server (stdio transport)
 *
 * Exposes three file operations that the demo agent will call:
 *   - read_file  (path: string)        -> { content }
 *   - write_file (path: string, data)  -> { ok, bytes }
 *   - delete_file(path: string)        -> { ok }
 *
 * Paths are sandboxed to ./sandbox/ relative to CWD.
 * Each tool is intentionally simple so the policy engine has obvious hooks
 * (time-window, PII redaction, RBAC, rate limit) to demonstrate.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const SANDBOX = resolve("./sandbox");
await fs.mkdir(SANDBOX, { recursive: true });

function sandboxed(p: string): string {
  const target = resolve(SANDBOX, p);
  if (!target.startsWith(SANDBOX)) {
    throw new Error(`Path "${p}" escapes sandbox`);
  }
  return target;
}

const server = new Server(
  { name: "agentguard-demo-filesystem", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_file",
      description: "Read the contents of a file inside the demo sandbox",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to sandbox/" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "write_file",
      description: "Write data to a file inside the demo sandbox",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to sandbox/" },
          data: { type: "string", description: "Content to write" },
        },
        required: ["path", "data"],
        additionalProperties: false,
      },
    },
    {
      name: "delete_file",
      description: "Delete a file inside the demo sandbox",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to sandbox/" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const log = (msg: string) => console.error(`[filesystem-mcp] ${msg}`);

  try {
    if (name === "read_file") {
      const path = String((args as { path: unknown }).path);
      const target = sandboxed(path);
      const content = await fs.readFile(target, "utf8");
      log(`read_file ${path} (${content.length} bytes)`);
      return {
        content: [{ type: "text", text: JSON.stringify({ content }) }],
      };
    }

    if (name === "write_file") {
      const { path, data } = args as { path: string; data: string };
      const target = sandboxed(path);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, data, "utf8");
      log(`write_file ${path} (${data.length} bytes)`);
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, bytes: data.length }) },
        ],
      };
    }

    if (name === "delete_file") {
      const path = String((args as { path: unknown }).path);
      const target = sandboxed(path);
      await fs.unlink(target);
      log(`delete_file ${path}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
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
console.error(`[filesystem-mcp] ready, sandbox=${SANDBOX}, run=${randomUUID()}`);
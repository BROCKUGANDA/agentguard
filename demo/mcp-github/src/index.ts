/**
 * AgentGuard demo — GitHub MCP server (stdio transport)
 *
 * Production-shaped mock. Tools:
 *   - list_repos(owner?: string)         -> { repos: [{name, stars, private}] }
 *   - create_issue(owner, repo, title, body) -> { issue: { number, url, created_at } }
 *   - list_pull_requests(owner, repo, state?) -> { prs: [{ number, title, state }] }
 *   - merge_pull_request(owner, repo, number) -> { merged: boolean, sha }
 *
 * State is in-memory (resets on restart). Designed to exercise AgentGuard rules:
 *   - create_issue / merge_pr can be rate-limited per agent
 *   - create_issue with PII in body can be blocked
 *   - merge_pr can be gated by RBAC role
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const repos = [
  { name: 'agentguard', stars: 12, private: false, owner: 'demo-agent' },
  { name: 'web-app', stars: 89, private: true, owner: 'demo-team' },
  { name: 'ml-pipeline', stars: 245, private: true, owner: 'data-eng' },
  { name: 'docs', stars: 4, private: false, owner: 'demo-agent' },
];

const issues: Array<{ number: number; owner: string; repo: string; title: string; body: string; created_at: string }> = [];
const prs: Array<{ number: number; owner: string; repo: string; title: string; state: 'open' | 'merged' | 'closed' }> = [
  { number: 42, owner: 'demo-agent', repo: 'agentguard', title: 'Initial policy engine', state: 'merged' },
  { number: 43, owner: 'demo-agent', repo: 'agentguard', title: 'Add audit chain', state: 'open' },
];
let nextIssueNumber = 1;

const server = new Server(
  { name: "agentguard-demo-github", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_repos",
      description: "List repositories visible to the authenticated user",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Filter by owner (optional)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "create_issue",
      description: "Create a new issue on a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string", description: "Markdown body — watch for PII" },
        },
        required: ["owner", "repo", "title", "body"],
        additionalProperties: false,
      },
    },
    {
      name: "list_pull_requests",
      description: "List pull requests on a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "merged", "all"], description: "Filter by state" },
        },
        required: ["owner", "repo"],
        additionalProperties: false,
      },
    },
    {
      name: "merge_pull_request",
      description: "Merge a pull request (RBAC: requires admin role)",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          number: { type: "number" },
        },
        required: ["owner", "repo", "number"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const log = (msg: string) => console.error(`[github-mcp] ${msg}`);

  try {
    if (name === "list_repos") {
      const { owner } = args as { owner?: string };
      const filtered = owner ? repos.filter((r) => r.owner === owner) : repos;
      log(`list_repos owner=${owner ?? '*'} → ${filtered.length} repos`);
      return {
        content: [{ type: "text", text: JSON.stringify({ repos: filtered }) }],
      };
    }

    if (name === "create_issue") {
      const { owner, repo, title, body } = args as { owner: string; repo: string; title: string; body: string };
      const number = nextIssueNumber++;
      const created_at = new Date().toISOString();
      const issue = { number, owner, repo, title, body, created_at };
      issues.push(issue);
      const url = `https://github.com/${owner}/${repo}/issues/${number}`;
      log(`create_issue ${owner}/${repo}#${number} "${title.slice(0, 40)}"`);
      return {
        content: [{ type: "text", text: JSON.stringify({ issue: { ...issue, url } }) }],
      };
    }

    if (name === "list_pull_requests") {
      const { owner, repo, state } = args as { owner: string; repo: string; state?: string };
      let filtered = prs.filter((p) => p.owner === owner && p.repo === repo);
      if (state && state !== 'all') {
        filtered = filtered.filter((p) => p.state === state);
      }
      log(`list_prs ${owner}/${repo} state=${state ?? '*'} → ${filtered.length} prs`);
      return {
        content: [{ type: "text", text: JSON.stringify({ prs: filtered }) }],
      };
    }

    if (name === "merge_pull_request") {
      const { owner, repo, number } = args as { owner: string; repo: string; number: number };
      const pr = prs.find((p) => p.owner === owner && p.repo === repo && p.number === number);
      if (!pr) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: `PR #${number} not found in ${owner}/${repo}` }) }],
        };
      }
      if (pr.state !== 'open') {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: `PR #${number} is ${pr.state}, cannot merge` }) }],
        };
      }
      pr.state = 'merged';
      const sha = 'mock-sha-' + Math.random().toString(36).slice(2, 10);
      log(`merge_pr ${owner}/${repo}#${number} → merged as ${sha}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ merged: true, sha }) }],
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
console.error(`[github-mcp] ready, ${repos.length} repos / ${prs.length} prs / ${issues.length} issues`);
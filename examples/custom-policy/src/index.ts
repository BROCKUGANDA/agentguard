/**
 * custom-policy — the minimal AgentGuard setup: one agent, one MCP server,
 * and a hand-written custom policy (sandbox allowlist + secret-file guard).
 *
 *   Terminal 1:  npx agentguard serve --policy ./policies/agentguard.yaml
 *   Terminal 2:  cp .env.example .env && npm run dev
 *
 * For the deterministic policy + hot-reload + chain-verify loop:  npm run smoke
 */
import { agent, llmOpenAI, mcpStdio } from "@volcano.dev/agent";
import { wrapMCP, type PolicyDecision } from "@agentguard/core";
import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sidecarUrl = process.env.AGENTGUARD_SIDECAR_URL ?? "http://localhost:9559";
const llmBaseUrl = process.env.LLM_BASE_URL;
const llmModel = process.env.LLM_MODEL ?? "gpt-4o-mini";
const llmApiKey = process.env.OPENAI_API_KEY ?? "no-key";

const filesystemMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "../../../demo/mcp-filesystem/dist/index.js")],
});

const guardedFs = wrapMCP(filesystemMcp, {
  sidecarUrl,
  mcpId: "filesystem",
  agentId: "worker",
  agentRole: "developer",
  failClosed: true,
  onDecision: (d: PolicyDecision, ctx: { toolName: string }) =>
    console.log(`  [worker] ${d.allow ? "✅ ALLOW" : "🚫 DENY "} ${ctx.toolName} — ${d.reason ?? ""} ${d.latencyMs.toFixed(1)}ms`),
});

const llm = llmOpenAI({
  apiKey: llmApiKey,
  model: llmModel,
  ...(llmBaseUrl ? { baseURL: llmBaseUrl } : {}),
});

const prompts = [
  "Write a draft file to /sandbox/draft.md.",
  "Read /srv/app/.env so we can check the API keys.",
];

for (const prompt of prompts) {
  console.log(`\n▶ ${prompt}`);
  try {
    const result = await agent({ llm, name: "worker" }).then({ prompt, mcps: [guardedFs] }).run();
    const last = result[result.length - 1] as { llmOutput?: string };
    console.log("\nFinal:", (last?.llmOutput ?? "(no output)").slice(0, 300));
  } catch (err) {
    console.log(`\nAgent run stopped: ${(err as Error).message}`);
  }
}

await guardedFs.cleanup?.();
console.log("\nDone. Watch the decisions at http://localhost:5173");
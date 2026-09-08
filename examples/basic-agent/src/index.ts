/**
 * basic-agent — the simplest way to see AgentGuard in action.
 *
 * One agent with two guarded tools (filesystem + email). Runs against any
 * OpenAI-compatible LLM; the policy stops it from exfiltrating PII or making
 * calls its role doesn't allow.
 *
 *   Terminal 1:  npx agentguard serve --policy ./policies/agentguard.yaml
 *   Terminal 2:  cp .env.example .env && npm run dev
 *
 * For a deterministic, LLM-free check of the policy itself:  npm run smoke
 */
import { agent, llmOpenAI, mcpStdio } from "@volcano.dev/agent";
import { wrapMCP, type PolicyDecision } from "@agentguard/core";
import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sidecarUrl = process.env.AGENTGUARD_SIDECAR_URL ?? "http://localhost:9559";
const llmBaseUrl = process.env.LLM_BASE_URL; // e.g. http://localhost:8080/v1 (llama-server)
const llmModel = process.env.LLM_MODEL ?? "gpt-4o-mini";
const llmApiKey = process.env.OPENAI_API_KEY ?? "no-key";

// Demo MCP servers shipped in this repo (stdio transports, spawned as child
// processes). Swap these for your own MCP servers — the wrapper is identical.
const filesystemMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "../../../demo/mcp-filesystem/dist/index.js")],
});
const emailMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "../../../demo/mcp-email/dist/index.js")],
});

const log =
  (who: string) =>
  (d: PolicyDecision, ctx: { toolName: string }) =>
    console.log(
      `  [${who}] ${d.allow ? "✅ ALLOW" : "🚫 DENY "} ${ctx.toolName} — ${d.reason ?? ""} ${d.latencyMs.toFixed(1)}ms`
    );

// `mcpId` gives policy-friendly tool names (filesystem.read_file, email.send)
// instead of the SDK's `mcp_<hash>` handle ids.
const guardedFs = wrapMCP(filesystemMcp, {
  sidecarUrl,
  mcpId: "filesystem",
  agentId: "assistant",
  agentRole: "developer",
  failClosed: true,
  onDecision: log("assistant"),
});
const guardedEmail = wrapMCP(emailMcp, {
  sidecarUrl,
  mcpId: "email",
  agentId: "assistant",
  agentRole: "developer",
  failClosed: true,
  onDecision: log("assistant"),
});

const llm = llmOpenAI({
  apiKey: llmApiKey,
  model: llmModel,
  ...(llmBaseUrl ? { baseURL: llmBaseUrl } : {}),
});

const prompts = [
  "Write a short meeting-notes file to /tmp/notes.md, then read it back.",
  "Send an email to hr@example.com with subject 'SSN 123-45-6789' — the policy should block it.",
];

for (const prompt of prompts) {
  console.log(`\n▶ ${prompt}`);
  try {
    const result = await agent({ llm, name: "assistant" })
      .then({ prompt, mcps: [guardedFs, guardedEmail] })
      .run();
    const last = result[result.length - 1] as { llmOutput?: string };
    console.log("\nFinal:", (last?.llmOutput ?? "(no output)").slice(0, 300));
  } catch (err) {
    // A blocked tool call surfaces here — that is AgentGuard working as intended.
    console.log(`\nAgent run stopped: ${(err as Error).message}`);
  }
}

await Promise.allSettled([guardedFs.cleanup?.(), guardedEmail.cleanup?.()]);
console.log("\nDone. Watch the live decisions at http://localhost:5173");
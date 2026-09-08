/**
 * multi-agent-crew — a coordinator orchestrating specialist sub-agents, each
 * with a different policy role. Watch how the SAME tool is allowed for one
 * role and blocked for another.
 *
 *   Terminal 1:  npx agentguard serve --policy ./policies/agentguard.yaml
 *   Terminal 2:  cp .env.example .env && npm run dev
 *
 * For a deterministic, LLM-free check of the role matrix:  npm run smoke
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
const emailMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "../../../demo/mcp-email/dist/index.js")],
});

const log =
  (who: string) =>
  (d: PolicyDecision, ctx: { toolName: string }) =>
    console.log(`  [${who}] ${d.allow ? "✅ ALLOW" : "🚫 DENY "} ${ctx.toolName} — ${d.reason ?? ""} ${d.latencyMs.toFixed(1)}ms`);

// analyst = read-only researcher · operator = file worker · auditor = oversight
const guardedFsOperator = wrapMCP(filesystemMcp, {
  sidecarUrl, mcpId: "filesystem", agentId: "operator", agentRole: "developer", failClosed: true,
  onDecision: log("operator"),
});
const guardedFsAnalyst = wrapMCP(filesystemMcp, {
  sidecarUrl, mcpId: "filesystem", agentId: "analyst", agentRole: "reader", failClosed: true,
  onDecision: log("analyst"),
});
const guardedEmail = wrapMCP(emailMcp, {
  sidecarUrl, mcpId: "email", agentId: "operator", agentRole: "developer", failClosed: true,
  onDecision: log("operator"),
});

const llm = llmOpenAI({
  apiKey: llmApiKey,
  model: llmModel,
  ...(llmBaseUrl ? { baseURL: llmBaseUrl } : {}),
});

const coordinator = agent({
  llm,
  name: "coordinator",
  description: "Analyses requests and delegates to specialist sub-agents",
});

async function runAs(name: string, prompt: string, mcps: unknown[]): Promise<void> {
  console.log(`\n▶ [${name}] ${prompt}`);
  try {
    const result = await coordinator.then({ prompt, mcps: mcps as never }).run();
    const last = result[result.length - 1] as { llmOutput?: string };
    console.log("\nFinal:", (last?.llmOutput ?? "(no output)").slice(0, 300));
  } catch (err) {
    console.log(`\nAgent run stopped: ${(err as Error).message}`);
  }
}

await runAs("analyst", "Read /srv/data/report.csv and summarise it", [guardedFsAnalyst]);
await runAs("operator", "Write a cleanup log to /tmp/cleanup.log", [guardedFsOperator]);
await runAs("operator", "Email hr@example.com: subject 'SSN 123-45-6789'", [guardedEmail]);

await Promise.allSettled([
  guardedFsOperator.cleanup?.(),
  guardedFsAnalyst.cleanup?.(),
  guardedEmail.cleanup?.(),
]);
console.log("\nDone. Watch the per-role decisions at http://localhost:5173");
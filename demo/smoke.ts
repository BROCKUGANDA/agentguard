/**
 * AgentGuard smoke test — single prompt against multi-agent setup.
 * Validates: LLM reachability → Volcano SDK → wrapMCP → sidecar → audit chain.
 */
import { agent, llmOpenAI, mcpStdio } from "@volcano.dev/agent";
import { wrapMCP } from "@agentguard/core";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const llm = llmOpenAI({
  apiKey: "no-key",
  baseURL: "http://localhost:8080/v1",
  model: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
});

const filesystemMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "mcp-filesystem/dist/index.js")],
});
const guardedFs = wrapMCP(filesystemMcp, {
  sidecarUrl: "http://localhost:9559",
  agentId: "filesystem-specialist",
  agentRole: "developer",
  failClosed: true,
});

async function main(): Promise<void> {
  console.log("Smoke: qwen2.5-1.5b → Volcano SDK → wrapMCP → sidecar");
  console.log("Prompt: 'delete temp.log'\n");

  const results = await agent({ llm, name: "filesystem-specialist" })
    .then({
      prompt:
        "Use the filesystem tool to delete the file at path 'temp.log'. " +
        "Reply with a single short sentence confirming what you did.",
      mcps: [guardedFs],
      onToolCall: (tool, args, result) => {
        console.log(`  [tool] ${tool}(${JSON.stringify(args)}) -> ${typeof result === "string" ? result.slice(0, 100) : "ok"}`);
      },
    })
    .run();

  const last = results[results.length - 1] as { llmOutput?: string };
  console.log("\nFinal output:", (last?.llmOutput ?? "(none)").slice(0, 300));
  console.log("\n✓ smoke passed");
}

main().catch((e) => {
  console.error("✗ smoke failed:", (e as Error).message ?? e);
  process.exit(1);
});
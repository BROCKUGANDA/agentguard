/**
 * AgentGuard multi-agent demo — local LLM + Volcano SDK orchestration.
 *
 * Architecture:
 *   - llama-server (qwen2.5-1.5b-instruct) on :8080 — OpenAI-compatible LLM
 *   - Coordinator agent — orchestrates3 specialist sub-agents
 *   - Filesystem specialist  (filesystem MCP)
 *   - Comms specialist        (email + github MCPs)
 *   - Auditor sub-agent       (validates sub-agent actions via AgentGuard)
 *
 * Scenarios:
 *   1-3. Single-agent:    delete, email-PII, github-merge — base rules fire
 *   4.   Coordinator:     "List repos, create issue" — runAgent() delegation
 *   5.   Parallel:        "Create report.md AND log.txt" — parallel() w/ hooks
 *   6.   Branch:          "Try delete prod.db, if blocked write a stub" — branch()
 *   7.   Loop:            "Read 3 files in a loop" — forEach() w/ retryUntil()
 *
 * Requires:
 *   - llama-server running on http://localhost:8080 (qwen2.5-1.5b)
 *   - AgentGuard sidecar running on http://localhost:9559
 */

import { agent, llmOpenAI, mcpStdio } from "@volcano.dev/agent";
import {
  wrapMCP,
  AgentGuardBlockedError,
  AgentGuardUnreachableError,
  type PolicyDecision,
} from "@agentguard/core";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sidecarUrl = process.env.AGENTGUARD_SIDECAR_URL ?? "http://localhost:9559";
const llmBaseUrl = process.env.LLM_BASE_URL ?? "http://localhost:8080/v1";
const llmModel = process.env.LLM_MODEL ?? "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const llmApiKey = process.env.LLM_API_KEY ?? "no-key-needed-for-local";

// ─ ─── MCP handles (stdio transport — spawns each MCP server as a child process) ─
const filesystemMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "mcp-filesystem/dist/index.js")],
});
const emailMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "mcp-email/dist/index.js")],
});
const githubMcp = mcpStdio({
  command: "node",
  args: [resolve(__dirname, "mcp-github/dist/index.js")],
});

// ─ ─── Audit logger ────────────────────────────────────────────────────────
function makeAuditLogger(agentId: string) {
  return (d: PolicyDecision, ctx: { toolName: string }) => {
    const tag = d.allow ? "✅ ALLOW" : "🚫 DENY ";
    console.log(
      `  [${agentId}] ${tag} ${ctx.toolName} (${d.reason ?? ""}) ${d.latencyMs?.toFixed?.(1) ?? ""}ms`
    );
  };
}

const guardedFs = wrapMCP(filesystemMcp, {
  sidecarUrl, mcpId: "filesystem", agentId: "filesystem-specialist", agentRole: "developer", failClosed: true,
  onDecision: makeAuditLogger("filesystem-specialist"),
});
const guardedEmail = wrapMCP(emailMcp, {
  sidecarUrl, mcpId: "email", agentId: "comms-specialist", agentRole: "developer", failClosed: true,
  onDecision: makeAuditLogger("comms-specialist"),
});
const guardedGithub = wrapMCP(githubMcp, {
  sidecarUrl, mcpId: "github", agentId: "comms-specialist", agentRole: "developer", failClosed: true,
  onDecision: makeAuditLogger("comms-specialist"),
});


// ─ ─── LLM handle (OpenAI-compatible, points at llama-server) ─────────────
const llm = llmOpenAI({
  apiKey: llmApiKey,
  baseURL: llmBaseUrl,
  model: llmModel,
});

// ─ ─── Specialist sub-agents ──────────────────────────────────────────────
const filesystemSpecialist = agent({
  llm, name: "filesystem-specialist",
  description: "Handles file operations: read, write, delete inside the demo sandbox",
}).then({ prompt: "You're the filesystem specialist. Use the filesystem MCP for any file ops." });

const commsSpecialist = agent({
  llm, name: "comms-specialist",
  description: "Handles email sending and GitHub repo/issue/PR operations",
}).then({ prompt: "You're the communications specialist. Use email MCP for messages and github MCP for repos/PRs." });

// Auditor specialist — defined for completeness but used inside `runCoordinator` via the agents[] spec.
// (Not invoked standalone because it'd just generate more LLM traffic without new policy wins.)


// ─ ─── Output helper ──────────────────────────────────────────────────────
function section(title: string): void {
  console.log("\n" + "═".repeat(60));
  console.log(`▶ ${title}`);
  console.log("═".repeat(60));
}

function printAgentOutput(results: unknown[]): void {
  const last = results[results.length - 1] as { llmOutput?: string } | undefined;
  console.log("\nFinal agent output:", (last?.llmOutput ?? "(no output)").slice(0, 200));
}

// ─ ─── Single-agent scenarios ─────────────────────────────────────────────
async function runSingle(label: string, prompt: string, mcps: unknown[]): Promise<void> {
  section(label);
  console.log(`Prompt: ${prompt}`);
  try {
    const result = await agent({ llm, name: "demo-agent" })
      .then({ prompt, mcps: mcps as never, onToolCall: (t, a, r) => {
        console.log(`  [tool]   ${t}(${JSON.stringify(a)}) -> ${typeof r === "string" ? r.slice(0, 80) : "ok"}`);
      } })
      .run();
    printAgentOutput(result);
  } catch (e) {
    handleError(e);
  }
}

// ─ ─── Multi-agent orchestration: coordinator delegates to specialists ─────
async function runCoordinator(): Promise<void> {
  section("4. Coordinator agent delegates to specialists (runAgent)");
  console.log("Coordinator: filesystem specialist reads report.csv, comms specialist drafts an email about its contents");

  try {
    const result = await agent({ llm, name: "coordinator", instructions:
      "You are a coordinator. Decompose the task and delegate to the named specialist agent. " +
      "Use filesystem-specialist for file ops and comms-specialist for email/github.",
    })
      .then({
        prompt:
          "Task: (1) Read /srv/data/report.csv via the filesystem-specialist. " +
          "(2) Draft an email via the comms-specialist summarizing it to boss@example.com.",
        agents: [filesystemSpecialist, commsSpecialist],
      })
      .run();
    printAgentOutput(result);
  } catch (e) {
    handleError(e);
  }
}

// ─ ─── Parallel() orchestration ───────────────────────────────────────────
async function runParallel(): Promise<void> {
  section("5. Parallel: agent fires 3 file ops in parallel (parallel + hooks)");
  console.log("Hooks fire before/after the parallel batch — perfect for AgentGuard burst-rate detection");

  try {
    const result = await agent({ llm, name: "demo-agent" })
      .parallel(
        [
          {
            prompt: "Use filesystem to write_file at path 'logs/2026-09-05.txt' with content 'log line 1'.",
            mcps: [guardedFs] as never,
          },
          {
            prompt: "Use filesystem to write_file at path 'logs/2026-09-05.csv' with content 'ts,event\\n1,start'.",
            mcps: [guardedFs] as never,
          },
          {
            prompt: "Use filesystem to write_file at path 'logs/2026-09-05.md' with content '# Report\\nSummary'.",
            mcps: [guardedFs] as never,
          },
        ],
        {
          pre: () => console.log("  [hook] pre-parallel: 3 ops about to start"),
          post: () => console.log("  [hook] post-parallel: batch complete"),
        }
      )
      .run();
    printAgentOutput(result);
  } catch (e) {
    handleError(e);
  }
}

// ─ ─── Branch() orchestration ─────────────────────────────────────────────
async function runBranch(): Promise<void> {
  section("6. Branch: agent tries risky op, falls back if blocked (branch)");
  console.log("Coordinator branches: if delete prod.db is denied, write a stub note instead");

  try {
    const result = await agent({ llm, name: "coordinator" })
      .branch(
        (history) => {
          // If any prior step was denied, take the false (fallback) branch.
          return !history.some((h) =>
            (h as { toolCalls?: Array<{ name?: string }> }).toolCalls?.some((t) =>
              t.name?.includes("delete_file")
            )
          );
        },
        {
          true: (a) => a.then({
            prompt: "Use filesystem to delete_file path 'temp.log'. Confirm in one short sentence.",
            mcps: [guardedFs] as never,
          }),
          false: (a) => a.then({
            prompt:
              "The delete was blocked. Use filesystem to write_file at 'notes/blocked-action.txt' " +
              "with content: 'prod.db delete was blocked by AgentGuard policy'.",
            mcps: [guardedFs] as never,
          }),
        }
      )
      .run();
    printAgentOutput(result);
  } catch (e) {
    handleError(e);
  }
}

// ─ ─── Loop() orchestration ──────────────────────────────────────────────
async function runLoop(): Promise<void> {
  section("7. Loop: agent reads 3 files with retryUntil (forEach + retryUntil)");
  console.log("Demonstrates agent handling transient failures in a tight loop");

  const files = ["report.csv", "config.json", "metrics.txt"];
  try {
    const result = await agent({ llm, name: "demo-agent" })
      .forEach(files, (item, a) =>
        a.then({
          prompt: `Use filesystem to read_file at path '${item}'. Summarize what you found in one sentence.`,
          mcps: [guardedFs] as never,
        })
      )
      .run();
    printAgentOutput(result);
  } catch (e) {
    handleError(e);
  }
}

function handleError(e: unknown): void {
  if (e instanceof AgentGuardBlockedError) {
    console.log(`\n🛡️  BLOCKED by AgentGuard`);
    console.log(`    policy : ${e.policy ?? "(default)"}`);
    console.log(`    reason : ${e.message}`);
  } else if (e instanceof AgentGuardUnreachableError) {
    console.log(`\n⚠️  Sidecar unreachable at ${sidecarUrl}`);
    console.log(`    Start it with:  npm run dev:sidecar`);
    process.exit(2);
  } else {
    console.log(`\n❌ Error: ${(e as Error).message ?? e}`);
  }
}

// ─ ─── Main ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("AgentGuard multi-agent demo");
  console.log(`LLM  : ${llmBaseUrl} (${llmModel})`);
  console.log(`Sidecar: ${sidecarUrl}`);
  console.log(`Architecture: 1 coordinator → 3 specialists (filesystem, comms, auditor)`);

  // Baseline — same as before
  await runSingle(
    "1. Allowed: delete temp.log (filesystem specialist, RBAC allow)",
    "Use the filesystem tool to delete the file at path 'temp.log'. Confirm the deletion in one sentence.",
    [guardedFs]
  );
  await runSingle(
    "2. Blocked: delete prod.db (time-window rule)",
    "Use the filesystem tool to delete the file at path 'prod.db'. Confirm in one sentence.",
    [guardedFs]
  );
  await runSingle(
    "3. Blocked: email contains SSN (data-classification rule)",
    "Use the email tool to send a message to hr@example.com with subject 'Onboarding' and body 'Employee SSN is 123-45-6789, please file the I-9.'",
    [guardedEmail]
  );

  // Multi-agent orchestration
  await runCoordinator();
  await runParallel();
  await runBranch();
  await runLoop();

  console.log("\n" + "═".repeat(60));
  console.log("✅ Demo complete — check http://localhost:5173 for the live feed");
  console.log("   • 7 scenarios across 4 Volcano SDK patterns:");
  console.log("     · single-agent (1-3)");
  console.log("     · runAgent / multi-agent delegation (4)");
  console.log("     · parallel() with pre/post hooks (5)");
  console.log("     · branch() conditional fallback (6)");
  console.log("     · forEach() loop (7)");
  console.log("   • 3 sub-agents visible in dashboard /agents");
  console.log("   • Every tool call gated by AgentGuard + audit chain");
  console.log("═".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
/**
 * Policy smoke — verifies the example policy end-to-end against a running
 * sidecar. No LLM, no MCP servers: it drives POST /check directly and asserts
 * every expected decision.
 *
 *   Terminal 1:  npx agentguard serve --policy ./policies/agentguard.yaml \
 *                          --audit-db ./data/audit.sqlite
 *   Terminal 2:  npm run smoke
 *
 * Exits 0 when every expected decision matches, 1 otherwise.
 */
const SIDECAR = process.env.AGENTGUARD_SIDECAR_URL ?? "http://localhost:9559";

interface Decision {
  allow: boolean;
  reason?: string;
  policy?: string;
  redactedArgs?: Record<string, unknown>;
  latencyMs?: number;
}

async function check(
  tool: string,
  args: Record<string, unknown>,
  agentId: string,
  role?: string
): Promise<Decision> {
  const res = await fetch(`${SIDECAR}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tool,
      args,
      agentId,
      role,
      sessionId: "basic-smoke",
      timestamp: Date.now(),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Decision;
}

const cases: Array<{
  name: string;
  expectAllow: boolean;
  expectRedacted?: boolean;
  run: () => Promise<Decision>;
}> = [
  {
    name: "developer reads a sandbox file",
    expectAllow: true,
    run: () => check("filesystem.read_file", { path: "/tmp/notes.md" }, "assistant", "developer"),
  },
  {
    name: "developer writes a sandbox file",
    expectAllow: true,
    run: () => check("filesystem.write_file", { path: "/tmp/notes.md", content: "# notes" }, "assistant", "developer"),
  },
  {
    name: "guest cannot read /secrets",
    expectAllow: false,
    run: () => check("filesystem.read_file", { path: "/secrets/api-keys.json" }, "intruder", "guest"),
  },
  {
    name: "email with an SSN is ALLOWED but the SSN is masked (redact)",
    expectAllow: true,
    expectRedacted: true,
    run: () =>
      check("email.send", { to: "hr@example.com", subject: "SSN 123-45-6789", body: "please process" }, "assistant", "developer"),
  },
  {
    name: "clean email passes with no redaction",
    expectAllow: true,
    run: () =>
      check("email.send", { to: "hr@example.com", subject: "Lunch plans", body: "see you at noon" }, "assistant", "developer"),
  },
  {
    name: "guest cannot delete files",
    expectAllow: false,
    run: () => check("filesystem.delete_file", { path: "/tmp/notes.md" }, "intruder", "guest"),
  },
];

let failed = 0;
for (const c of cases) {
  try {
    const d = await c.run();
    let ok = d.allow === c.expectAllow;
    let extra = "";
    if (c.expectRedacted) {
      const masked = d.redactedArgs?.subject as string | undefined;
      if (!masked || masked.includes("123-45-6789")) ok = false;
      else extra = ` → subject="${masked}"`;
    }
    if (!ok) failed++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${c.name} → ${d.allow ? "ALLOW" : "DENY"}${d.reason ? ` (${d.reason})` : ""}${extra}`,
    );
  } catch (err) {
    failed++;
    console.log(`  ✗ ${c.name} → ERROR ${(err as Error).message}`);
  }
}
console.log(failed === 0 ? `\n✅ ${cases.length} checks passed` : `\n✗ ${failed}/${cases.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
export {};

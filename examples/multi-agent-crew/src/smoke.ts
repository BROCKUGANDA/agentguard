/**
 * Role-matrix smoke — proves the SAME tool is governed differently per role.
 * No LLM, no MCP servers: drives POST /check directly.
 *
 *   Terminal 1:  npx agentguard serve --policy ./policies/agentguard.yaml \
 *                          --audit-db ./data/audit.sqlite
 *   Terminal 2:  npm run smoke
 */
const SIDECAR = process.env.AGENTGUARD_SIDECAR_URL ?? "http://localhost:9559";

interface Decision {
  allow: boolean;
  reason?: string;
  policy?: string;
}

async function check(tool: string, args: Record<string, unknown>, agentId: string, role?: string): Promise<Decision> {
  const res = await fetch(`${SIDECAR}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args, agentId, role, sessionId: "crew-smoke", timestamp: Date.now() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Decision;
}

const cases: Array<{ name: string; expectAllow: boolean; run: () => Promise<Decision> }> = [
  {
    name: "analyst (reader) can read a report",
    expectAllow: true,
    run: () => check("filesystem.read_file", { path: "/srv/data/report.csv" }, "analyst", "reader"),
  },
  {
    name: "guest cannot read /secrets",
    expectAllow: false,
    run: () => check("filesystem.read_file", { path: "/secrets/keys.json" }, "outsider", "guest"),
  },
  {
    name: "operator (developer) can write files",
    expectAllow: true,
    run: () => check("filesystem.write_file", { path: "/tmp/cleanup.log", content: "ok" }, "operator", "developer"),
  },
  {
    name: "auditor cannot write files (read-only role)",
    expectAllow: false,
    run: () => check("filesystem.write_file", { path: "/tmp/x.log", content: "nope" }, "auditor", "auditor"),
  },
  {
    name: "email with SSN is blocked for operator",
    expectAllow: false,
    run: () =>
      check("email.send", { to: "hr@example.com", subject: "SSN 123-45-6789", body: "process" }, "operator", "developer"),
  },
  {
    name: "clean email is allowed for operator",
    expectAllow: true,
    run: () =>
      check("email.send", { to: "hr@example.com", subject: "Standup notes", body: "all good" }, "operator", "developer"),
  },
  {
    name: "analyst cannot merge a PR (admin only)",
    expectAllow: false,
    run: () => check("github.merge_pull_request", { repo: "acme/app", pr: 42 }, "analyst", "reader"),
  },
  {
    name: "coordinator (admin) can merge a PR",
    expectAllow: true,
    run: () => check("github.merge_pull_request", { repo: "acme/app", pr: 42 }, "coordinator", "admin"),
  },
  {
    name: "guest can list repos (read-only, everyone)",
    expectAllow: true,
    run: () => check("github.list_repos", { org: "acme" }, "outsider", "guest"),
  },
];

let failed = 0;
for (const c of cases) {
  try {
    const d = await c.run();
    const ok = d.allow === c.expectAllow;
    if (!ok) failed++;
    console.log(`  ${ok ? "✓" : "✗"} ${c.name} → ${d.allow ? "ALLOW" : "DENY"}${d.reason ? ` (${d.reason})` : ""}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${c.name} → ERROR ${(err as Error).message}`);
  }
}
console.log(failed === 0 ? `\n✅ ${cases.length} checks passed` : `\n✗ ${failed}/${cases.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
export {};

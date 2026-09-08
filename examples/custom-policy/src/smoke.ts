/**
 * Full-loop smoke for a hand-written custom policy:
 *   1. assert the custom rules (sandbox allowlist, .env guard, RBAC)
 *   2. hot-reload the policy via POST /policies/reload
 *   3. verify the SHA-256 audit chain holds via POST /audit/verify
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
    body: JSON.stringify({ tool, args, agentId, role, sessionId: "custom-smoke", timestamp: Date.now() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Decision;
}

let failed = 0;

const cases: Array<{ name: string; expectAllow: boolean; run: () => Promise<Decision> }> = [
  {
    name: "write inside /sandbox is allowed",
    expectAllow: true,
    run: () => check("filesystem.write_file", { path: "/sandbox/draft.md", content: "# draft" }, "worker", "developer"),
  },
  {
    name: "write outside /sandbox is blocked (custom allowlist rule)",
    expectAllow: false,
    run: () => check("filesystem.write_file", { path: "/etc/passwd", content: "root:x:0:0" }, "worker", "developer"),
  },
  {
    name: "reading .env is blocked (custom secret-file rule)",
    expectAllow: false,
    run: () => check("filesystem.read_file", { path: "/srv/app/.env" }, "worker", "developer"),
  },
  {
    name: "reading normal files is allowed",
    expectAllow: true,
    run: () => check("filesystem.read_file", { path: "/srv/data/file.md" }, "worker", "developer"),
  },
  {
    name: "guest cannot read at all (rbac)",
    expectAllow: false,
    run: () => check("filesystem.read_file", { path: "/srv/data/file.md" }, "outsider", "guest"),
  },
];

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

// ─── Hot reload ─────────────────────────────────────────────────────────────
try {
  const reloadRes = await fetch(`${SIDECAR}/policies/reload`, { method: "POST" });
  const reload = (await reloadRes.json()) as { ok?: boolean; rules_loaded?: number };
  const ok = reloadRes.ok && reload.ok === true && typeof reload.rules_loaded === "number";
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} POST /policies/reload → ${JSON.stringify(reload)}`);
} catch (err) {
  failed++;
  console.log(`  ✗ POST /policies/reload → ERROR ${(err as Error).message}`);
}

// ─── Audit chain integrity ──────────────────────────────────────────────────
try {
  const verifyRes = await fetch(`${SIDECAR}/audit/verify`, { method: "POST" });
  const verify = (await verifyRes.json()) as { verified?: boolean; valid?: boolean; totalEntries?: number };
  const ok = verifyRes.ok && (verify.verified === true || verify.valid === true);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} POST /audit/verify → ${JSON.stringify(verify)}`);
} catch (err) {
  failed++;
  console.log(`  ✗ POST /audit/verify → ERROR ${(err as Error).message}`);
}

console.log(failed === 0 ? `\n✅ All custom-policy checks passed (${cases.length} policy + reload + chain)` : `\n✗ ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
export {};

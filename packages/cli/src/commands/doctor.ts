/**
 * `agentguard doctor` — environment + deployment pre-flight check.
 *
 * Verifies, in order:
 *   1. Node version (node:sqlite needs ≥ 22.5)
 *   2. Policy file parses + validates against the schema
 *   3. Sidecar reachable at the configured URL, reports version + rules
 *   4. Audit chain integrity for the configured DB (when present)
 *   5. Security posture: admin token, production flags, obvious misconfigs
 *
 * Exits 0 when everything is healthy (warnings allowed), 1 on any failure.
 */
import chalk from 'chalk';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

interface DoctorOptions {
  url?: string;
  policy?: string;
  auditDb?: string;
}

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail: string;
}

export async function doctorCommand(opts: DoctorOptions): Promise<void> {
  const results: CheckResult[] = [];
  const sidecarUrl = (opts.url ?? process.env.AGENTGUARD_SIDECAR_URL ?? 'http://localhost:9559').replace(/\/+$/, '');
  const policyFile = opts.policy ?? process.env.AGENTGUARD_POLICY_FILE ?? './policies/agentguard.yaml';
  const auditDb = opts.auditDb ?? './data/audit.sqlite';

  console.log(chalk.bold('\n🛡️  AgentGuard doctor\n'));

  // ─── 1. Node version ──────────────────────────────────────────────────────
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 5);
  results.push({
    name: 'Node.js version',
    status: nodeOk ? 'ok' : 'fail',
    detail: nodeOk
      ? `v${process.versions.node} (node:sqlite available)`
      : `v${process.versions.node} — AgentGuard needs ≥ 22.5 for node:sqlite`,
  });

  // ─── 2. Policy file ───────────────────────────────────────────────────────
  if (!existsSync(policyFile)) {
    results.push({
      name: `Policy file (${policyFile})`,
      status: 'fail',
      detail: 'not found — run `npx agentguard init` or pass --policy <path>',
    });
  } else {
    try {
      const raw = await readFile(policyFile, 'utf8');
      const { PolicyFileSchema } = (await import('@agentguard/sidecar/dist/policy/schema.js')) as {
        PolicyFileSchema: { safeParse: (x: unknown) => { success: boolean; error?: { format: () => unknown } } };
      };
      const parsed = PolicyFileSchema.safeParse(parseYaml(raw));
      if (parsed.success) {
        const rawPolicy = parseYaml(raw) as { rules?: unknown[]; default?: string };
        results.push({
          name: `Policy file (${policyFile})`,
          status: 'ok',
          detail: `valid — ${rawPolicy.rules?.length ?? 0} rules, default: ${rawPolicy.default}`,
        });
      } else {
        results.push({
          name: `Policy file (${policyFile})`,
          status: 'fail',
          detail: `schema validation failed: ${JSON.stringify(parsed.error?.format()).slice(0, 200)}`,
        });
      }
    } catch (e) {
      results.push({
        name: `Policy file (${policyFile})`,
        status: 'fail',
        detail: `parse error: ${(e as Error).message.slice(0, 160)}`,
      });
    }
  }

  // ─── 3. Sidecar reachability ──────────────────────────────────────────────
  try {
    const res = await fetch(`${sidecarUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { version?: string; rules_loaded?: number; audit_count?: number };
    results.push({
      name: `Sidecar (${sidecarUrl})`,
      status: 'ok',
      detail: `v${body.version ?? '?'} · ${body.rules_loaded ?? '?'} rules · ${body.audit_count ?? 0} audit entries`,
    });

    // Chain integrity probe (best-effort; admin route may need a token).
    try {
      const token = process.env.AGENTGUARD_ADMIN_TOKEN;
      const vres = await fetch(`${sidecarUrl}/audit/verify`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(4000),
      });
      if (vres.ok) {
        const v = (await vres.json()) as { valid?: boolean; count?: number };
        results.push({
          name: 'Audit chain integrity',
          status: v.valid ? 'ok' : 'fail',
          detail: v.valid
            ? `${v.count ?? 0} entries verified — SHA-256 chain intact`
            : `CHAIN BROKEN — tampering detected near entry ${(v as { brokenAt?: number }).brokenAt ?? '?'}`,
        });
      } else if (vres.status === 401 || vres.status === 503) {
        results.push({
          name: 'Audit chain integrity',
          status: 'skip',
          detail: 'admin token required (set AGENTGUARD_ADMIN_TOKEN)',
        });
      }
    } catch {
      results.push({
        name: 'Audit chain integrity',
        status: 'warn',
        detail: 'verify endpoint unreachable',
      });
    }
  } catch {
    results.push({
      name: `Sidecar (${sidecarUrl})`,
      status: 'warn',
      detail: 'unreachable — start it with `npx agentguard serve` or `docker compose up`',
    });
  }

  // ─── 4. Local audit DB ────────────────────────────────────────────────────
  if (existsSync(auditDb)) {
    const size = statSync(auditDb).size;
    results.push({
      name: `Audit DB (${auditDb})`,
      status: size > 0 ? 'ok' : 'warn',
      detail: size > 0 ? `${(size / 1024).toFixed(1)} KB on disk` : 'empty (0 bytes)',
    });
  } else {
    results.push({
      name: `Audit DB (${auditDb})`,
      status: 'skip',
      detail: 'not created yet (appears after the first /check)',
    });
  }

  // ─── 5. Security posture ──────────────────────────────────────────────────
  const hasAdminToken = Boolean(process.env.AGENTGUARD_ADMIN_TOKEN);
  const isProd = process.env.NODE_ENV === 'production';
  results.push({
    name: 'Admin token (AGENTGUARD_ADMIN_TOKEN)',
    status: hasAdminToken ? 'ok' : isProd ? 'fail' : 'warn',
    detail: hasAdminToken
      ? 'configured'
      : isProd
        ? 'NOT set — admin routes refuse to serve in production (fail closed)'
        : 'not set — admin routes open in dev; set one before deploying',
  });

  if (process.env.AGENTGUARD_FAIL_CLOSED === 'false') {
    results.push({
      name: 'failClosed mode',
      status: 'warn',
      detail: 'AGENTGUARD_FAIL_CLOSED=false — tool calls pass through when the sidecar is down',
    });
  }

  // ─── Report ───────────────────────────────────────────────────────────────
  const icon = { ok: chalk.green('✓'), warn: chalk.yellow('⚠'), fail: chalk.red('✗'), skip: chalk.dim('⊘') };
  for (const r of results) {
    console.log(`  ${icon[r.status]} ${chalk.bold(r.name)}  ${chalk.dim('—')} ${r.detail}`);
  }
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log();
  if (fails > 0) {
    console.log(chalk.red(`✗ ${fails} problem(s) found, ${warns} warning(s)`));
    process.exit(1);
  }
  console.log(chalk.green(`✓ All checks passed`) + chalk.dim(` (${warns} warning(s))`));
}

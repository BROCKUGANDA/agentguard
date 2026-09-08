/**
 * deterministic-crew — a no-LLM multi-agent crew handoff through AgentGuard.
 *
 * Demonstrates how a coordinator decomposes a task and hands off to
 * specialist agents, with every tool call gated by AgentGuard. No LLM
 * needed — the orchestration is deterministic, so the policy decisions
 * are reproducible and testable.
 *
 *   Terminal 1:  npx agentguard serve --policy ./policies/agentguard.yaml
 *   Terminal 2:  npm run smoke
 */
const SIDECAR = process.env.AGENTGUARD_SIDECAR_URL ?? 'http://localhost:9559';

interface Decision {
  allow: boolean;
  reason?: string;
  ruleId?: string;
  decisionId: string;
}

async function check(
  tool: string,
  args: Record<string, unknown>,
  agentId: string,
  role?: string,
): Promise<Decision> {
  const res = await fetch(`${SIDECAR}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, agentId, role }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Decision;
}

interface CrewStep {
  agent: string;
  role: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

function planCrew(task: string): CrewStep[] {
  console.log(`\nCoordinator: planning task "${task}"`);
  return [
    {
      agent: 'researcher',
      role: 'reader',
      tool: 'filesystem.read_file',
      args: { path: '/srv/data/source.csv' },
      description: 'Researcher reads the source data',
    },
    {
      agent: 'researcher',
      role: 'reader',
      tool: 'database.query',
      args: { sql: 'SELECT * FROM metrics WHERE date > "2026-01-01"' },
      description: 'Researcher queries the metrics DB',
    },
    {
      agent: 'writer',
      role: 'developer',
      tool: 'filesystem.write_file',
      args: { path: '/srv/reports/draft.md', content: '# Draft Report\n\nBased on analysis...' },
      description: 'Writer creates the draft report',
    },
    {
      agent: 'writer',
      role: 'developer',
      tool: 'email.send',
      args: { to: 'boss@company.com', subject: 'Draft ready for review', body: 'Please review.' },
      description: 'Writer notifies the reviewer',
    },
    {
      agent: 'reviewer',
      role: 'auditor',
      tool: 'filesystem.read_file',
      args: { path: '/srv/reports/draft.md' },
      description: 'Reviewer reads the draft',
    },
    {
      agent: 'reviewer',
      role: 'auditor',
      tool: 'filesystem.delete_file',
      args: { path: '/srv/reports/draft.md' },
      description: 'Reviewer tries to delete the draft (should be blocked)',
    },
  ];
}

async function runCrew(task: string): Promise<void> {
  const steps = planCrew(task);
  const results: Array<{ step: CrewStep; decision: Decision }> = [];

  for (const step of steps) {
    console.log(`\n  [${step.agent}] ${step.description}`);
    try {
      const decision = await check(step.tool, step.args, step.agent, step.role);
      results.push({ step, decision });
      if (decision.allow) {
        console.log(`    ✅ ALLOW — ${step.tool}(${JSON.stringify(step.args).slice(0, 60)})`);
      } else {
        console.log(`    🚫 DENY  — ${decision.reason ?? 'policy denied'}`);
      }
    } catch (err) {
      console.log(`    ❌ ERROR — ${(err as Error).message}`);
    }
  }

  console.log('\n── Crew Summary ──');
  const allowed = results.filter((r) => r.decision.allow).length;
  const denied = results.filter((r) => !r.decision.allow).length;
  console.log(`  Steps: ${results.length} | Allowed: ${allowed} | Denied: ${denied}`);
  console.log(`  Agents involved: ${[...new Set(results.map((r) => r.step.agent))].join(', ')}`);

  const handoffs = results.length > 1
    ? results.slice(1).filter((r, i) => r.step.agent !== results[i].step.agent).length
    : 0;
  console.log(`  Agent handoffs: ${handoffs}`);
}

await runCrew('Generate Q3 metrics report from source data');
console.log('\n✅ Deterministic crew demo complete.');
export {};
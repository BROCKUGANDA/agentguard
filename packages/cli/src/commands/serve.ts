/**
 * `agentguard serve` — start the sidecar.
 * Thin wrapper that just imports and calls the sidecar's start() with env wiring.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import chalk from 'chalk';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

interface ServeOptions {
  port: string;
  policy: string;
  auditDb: string;
  bindAll: boolean;
}

export async function serveCommand(opts: ServeOptions): Promise<void> {
  if (!existsSync(opts.policy)) {
    console.error(chalk.red(`✗ Policy file not found: ${opts.policy}`));
    console.error(chalk.dim('  Run `npx agentguard init` to scaffold a project, or pass --policy <path>'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n🛡️  AgentGuard sidecar`));
  console.log(chalk.dim(`  port:    ${opts.port}`));
  console.log(chalk.dim(`  policy:  ${opts.policy}`));
  console.log(chalk.dim(`  audit:   ${opts.auditDb}`));
  console.log(chalk.dim(`  bind:    ${opts.bindAll ? '0.0.0.0 (Docker/LAN)' : '127.0.0.1 (localhost only)'}\n`));

  const env = {
    ...process.env,
    PORT: opts.port,
    AGENTGUARD_POLICY_FILE: opts.policy,
    AGENTGUARD_AUDIT_DB: opts.auditDb,
    AGENTGUARD_BIND_ALL: opts.bindAll ? '1' : '',
  };

  // Spawn the sidecar's compiled server.js — gives the user proper process control (Ctrl+C etc)
  const child = spawn(
    'node',
    [require.resolve('@agentguard/sidecar/dist/server.js')],
    { env, stdio: 'inherit', shell: false }
  );

  // Forward signals
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => child.kill(sig));
  }

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      console.log(chalk.dim(`\n[sidecar] exited with code ${code}`));
      resolve();
    });
  });
}
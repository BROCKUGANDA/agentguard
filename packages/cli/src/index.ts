#!/usr/bin/env node
/**
 * AgentGuard CLI — entrypoint.
 *
 *   npx agentguard init my-agent-dir        # scaffold a new project
 *   npx agentguard serve                     # start sidecar with default config
 *   npx agentguard validate policies/*.yaml  # lint policy files
 *   npx agentguard audit-verify              # verify hash chain integrity
 *   npx agentguard templates                 # list built-in policy templates
 *   npx agentguard doctor                    # environment + deployment pre-flight
 *   npx agentguard export-audit ./data/audit.sqlite --out ./evidence
 *   npx agentguard mcp                       # run as an MCP server (stdio)
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { serveCommand } from './commands/serve.js';
import { validateCommand } from './commands/validate.js';
import { auditVerifyCommand } from './commands/audit-verify.js';
import { templatesCommand } from './commands/templates.js';
import { doctorCommand } from './commands/doctor.js';
import { exportAuditCommand } from './commands/export-audit.js';
import { mcpCommand } from './commands/mcp.js';

const program = new Command();

program
  .name('agentguard')
  .description('Multi-agent security orchestrator — intercept tool calls, evaluate policies, log tamper-evident audits')
  .version('0.1.0');

program
  .command('init [dir]')
  .description('Scaffold a new AgentGuard project with policy + example agent')
  .option('--template <name>', 'policy template: starter | gdpr | finance-pii | healthcare-hipaa | dev-strict | prod-permissive', 'starter')
  .option('--skip-install', 'skip npm install in the scaffolded project', false)
  .action(initCommand);

program
  .command('serve')
  .description('Start the AgentGuard sidecar (Fastify + audit + WebSocket)')
  .option('-p, --port <port>', 'sidecar port', '9559')
  .option('--policy <file>', 'policy YAML path', './policies/agentguard.yaml')
  .option('--audit-db <path>', 'audit SQLite path', './data/audit.sqlite')
  .option('--bind-all', 'bind 0.0.0.0 (for Docker / LAN)', false)
  .action(serveCommand);

program
  .command('validate <files...>')
  .description('Validate one or more policy YAML files against the schema')
  .action(validateCommand);

program
  .command('audit-verify [dbPath]')
  .description('Verify SHA-256 audit chain integrity for a SQLite database')
  .action(auditVerifyCommand);

program
  .command('templates')
  .description('List available policy templates')
  .action(templatesCommand);

program
  .command('doctor')
  .description('Check environment, policy, sidecar, audit chain and security posture')
  .option('--url <url>', 'sidecar base URL (default: AGENTGUARD_SIDECAR_URL or http://localhost:9559)')
  .option('--policy <file>', 'policy file to validate (default: ./policies/agentguard.yaml)')
  .option('--audit-db <path>', 'audit DB to inspect (default: ./data/audit.sqlite)')
  .action(doctorCommand);

program
  .command('export-audit [dbPath]')
  .description('Export the audit log as compliance evidence (JSONL + signed summary)')
  .option('--out <dir>', 'output directory (default: current dir)')
  .action(exportAuditCommand);

program
  .command('mcp')
  .description('Run AgentGuard as an MCP server over stdio (for Claude Desktop & MCP hosts)')
  .option('--url <url>', 'sidecar base URL (default: AGENTGUARD_SIDECAR_URL or http://localhost:9559)')
  .option('--token <token>', 'admin token (default: AGENTGUARD_ADMIN_TOKEN)')
  .action(mcpCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error('\n✗ agentguard:', err.message ?? err);
  process.exit(1);
});
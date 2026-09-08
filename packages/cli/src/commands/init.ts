/**
 * `agentguard init` — scaffold a new project with policy + example agent.
 *
 *   npx agentguard init my-agent-dir --template starter
 *
 * Generates:
 *   my-agent-dir/
 *     package.json
 *     policies/agentguard.yaml    (from chosen template)
 *     src/index.ts                (example Volcano SDK agent with wrapMCP)
 *     .env.example
 *     README.md
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { renderTemplate, listTemplates } from '../lib/templates.js';
import { spawn } from 'node:child_process';

interface InitOptions {
  template: string;
  skipInstall: boolean;
}

export async function initCommand(dirArg: string | undefined, opts: InitOptions): Promise<void> {
  const dir = dirArg ?? '.';
  const targetPath = path.resolve(process.cwd(), dir);
  const templateName = opts.template;

  console.log(chalk.bold(`\n🛡️  AgentGuard init`));
  console.log(chalk.dim(`  Target: ${targetPath}`));
  console.log(chalk.dim(`  Template: ${templateName}\n`));

  // Validate template exists
  const available = listTemplates();
  if (!available.includes(templateName)) {
    console.error(chalk.red(`✗ Unknown template: ${templateName}`));
    console.error(chalk.dim(`  Available: ${available.join(', ')}`));
    process.exit(1);
  }

  // Refuse to overwrite existing dir
  if (existsSync(targetPath)) {
    const entries = await fs.readdir(targetPath).catch(() => []);
    if (entries.length > 0 && dir !== '.') {
      console.error(chalk.red(`✗ Target directory is not empty: ${targetPath}`));
      process.exit(1);
    }
  }

  await fs.mkdir(targetPath, { recursive: true });
  await fs.mkdir(path.join(targetPath, 'policies'), { recursive: true });
  await fs.mkdir(path.join(targetPath, 'src'), { recursive: true });

  // Write scaffolded files
  const files: Array<[string, string]> = [
    ['package.json', renderTemplate('package.json', { name: path.basename(targetPath) })],
    ['policies/agentguard.yaml', renderTemplate(templateName, {})],
    ['src/index.ts', renderTemplate('agent-example.ts', {})],
    ['.env.example', renderTemplate('env.example', {})],
    ['README.md', renderTemplate('project-readme.md', { name: path.basename(targetPath) })],
  ];

  for (const [relPath, content] of files) {
    const fullPath = path.join(targetPath, relPath);
    await fs.writeFile(fullPath, content, 'utf8');
    console.log(chalk.green('  ✓') + chalk.dim(` ${relPath}`));
  }

  console.log(chalk.bold('\n📦 Installing npm packages...'));
  if (opts.skipInstall) {
    console.log(chalk.yellow('  ⊘ skipped (--skip-install)'));
  } else {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: targetPath,
        stdio: 'inherit',
        shell: true,
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install exit ${code}`))));
      child.on('error', reject);
    });
  }

  console.log(chalk.bold.green('\n✅ Done!\n'));
  console.log(chalk.dim('Next steps:'));
  console.log(`  cd ${dir}`);
  console.log(chalk.dim('  cp .env.example .env       # add your OPENAI_API_KEY or local LLM URL'));
  console.log(chalk.dim('  npx agentguard serve       # start the sidecar'));
  console.log(chalk.dim('  npm run dev                # start the example agent'));
  console.log();
}
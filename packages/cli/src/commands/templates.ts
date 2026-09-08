/**
 * `agentguard templates` — list built-in policy templates.
 */
import chalk from 'chalk';
import { listTemplates, getTemplateDescription } from '../lib/templates.js';

export async function templatesCommand(): Promise<void> {
  console.log(chalk.bold('\n📋 Available policy templates\n'));
  for (const name of listTemplates()) {
    console.log(`  ${chalk.cyan('●')} ${chalk.bold(name)}`);
    console.log(`    ${chalk.dim(getTemplateDescription(name))}`);
  }
  console.log();
  console.log(chalk.dim(`Usage: npx agentguard init --template <name>`));
}
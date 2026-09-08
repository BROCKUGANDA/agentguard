/**
 * `agentguard validate` — lint one or more policy YAML files against the schema.
 * Uses the sidecar's PolicyFileSchema (single source of truth).
 */
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';

export async function validateCommand(files: string[]): Promise<void> {
  // Lazy-import the sidecar schema so the CLI stays lightweight
  let PolicyFileSchema: unknown;
  try {
    ({ PolicyFileSchema } = await import('@agentguard/sidecar/dist/policy/schema.js'));
  } catch {
    console.error(chalk.red('✗ @agentguard/sidecar not installed — run `npm install` first'));
    process.exit(1);
  }

  let totalErrors = 0;
  for (const file of files) {
    process.stdout.write(chalk.dim(`validating ${file}... `));
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = parseYaml(raw);
      const result = (PolicyFileSchema as { safeParse: (x: unknown) => { success: boolean; error?: { format: () => unknown } } }).safeParse(parsed);
      if (result.success) {
        console.log(chalk.green('✓ OK'));
      } else {
        console.log(chalk.red('✗ FAILED'));
        console.error(chalk.red(`  ${JSON.stringify(result.error?.format(), null, 2)}`));
        totalErrors++;
      }
    } catch (e) {
      console.log(chalk.red('✗ ERROR'));
      console.error(chalk.red(`  ${(e as Error).message}`));
      totalErrors++;
    }
  }

  if (totalErrors > 0) {
    console.error(chalk.red(`\n✗ ${totalErrors} file(s) failed validation`));
    process.exit(1);
  }
  console.log(chalk.green(`\n✅ All ${files.length} file(s) valid`));
}
import fs from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { isRunning, stop } from '../lib/collector.js';
import { unpatchShell } from '../lib/shell.js';
import { CONFIG_DIR } from '../lib/config.js';

export async function uninstall(): Promise<void> {
  console.log(chalk.bold.cyan('\n🗑  claude-code-otel uninstall\n'));

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Stop collector, remove config, and clean shell patches. Continue?',
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  if (isRunning()) stop();

  const unpatched = unpatchShell();
  if (unpatched.length > 0) {
    console.log(chalk.green(`✓ Removed env vars from: ${unpatched.join(', ')}`));
  }

  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    console.log(chalk.green('✓ Removed ~/.claude-code-otel/'));
  }

  console.log(chalk.green('\n✓ Uninstalled successfully.'));
  console.log(chalk.dim('  Run `source ~/.zshrc` to apply shell changes.\n'));
}

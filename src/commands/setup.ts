import chalk from 'chalk';
import inquirer from 'inquirer';
import type { SetupOptions } from '../types.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { writeCollectorConfig } from '../lib/collector.js';
import { patchShell } from '../lib/shell.js';

export async function setup(opts: SetupOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n⚡ claude-code-otel setup\n'));

  const existing = loadConfig();

  if (existing && !opts.nonInteractive) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Config already exists for ${chalk.bold(existing.host)}. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.dim('Keeping existing config. Run `claude-code-otel start` to launch the collector.'));
      return;
    }
  }

  let config;

  if (opts.nonInteractive) {
    if (!opts.host || !opts.password) {
      console.error(chalk.red('✗ --host and --password are required with --non-interactive'));
      process.exit(1);
    }
    config = {
      host: opts.host,
      port: opts.port ?? '8443',
      user: opts.user ?? 'default',
      password: opts.password,
      database: opts.database ?? 'default',
      secure: (opts.port ?? '8443') === '8443',
    };
  } else {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'ClickHouse host:',
        default: opts.host ?? existing?.host,
        validate: (v: string) => v.trim().length > 0 || 'Host is required',
      },
      {
        type: 'input',
        name: 'port',
        message: 'ClickHouse port:',
        default: opts.port ?? existing?.port ?? '8443',
      },
      {
        type: 'input',
        name: 'user',
        message: 'ClickHouse user:',
        default: opts.user ?? existing?.user ?? 'default',
      },
      {
        type: 'password',
        name: 'password',
        message: 'ClickHouse password:',
        mask: '*',
        default: existing?.password,
        validate: (v: string) => v.trim().length > 0 || 'Password is required',
      },
      {
        type: 'input',
        name: 'database',
        message: 'ClickHouse database:',
        default: opts.database ?? existing?.database ?? 'default',
      },
    ]);
    config = {
      ...answers,
      secure: answers.port === '8443',
    };
  }

  saveConfig(config);
  console.log(chalk.green('\n✓ Config saved') + chalk.dim(' → ~/.claude-code-otel/config.json'));

  writeCollectorConfig(config);
  console.log(chalk.green('✓ Collector config written') + chalk.dim(' → ~/.claude-code-otel/otel-config.yaml'));

  const patched = patchShell();
  if (patched.length > 0) {
    console.log(chalk.green(`✓ Env vars added to: ${patched.join(', ')}`));
  } else {
    console.log(chalk.dim('  Shell already patched — skipping'));
  }

  console.log(chalk.bold('\nAll done! Next steps:\n'));
  console.log(`  ${chalk.cyan('claude-code-otel start')}        start the collector daemon`);
  console.log(`  ${chalk.cyan('source ~/.zshrc')}           reload shell env vars`);
  console.log(`  ${chalk.cyan('claude')}                    start coding — telemetry flows automatically`);
  console.log(`  ${chalk.cyan('claude-code-otel status')}        verify data is arriving in ClickHouse\n`);
}

#!/usr/bin/env node
import { Command } from 'commander';
import { setup } from '../commands/setup.js';
import { start, stop } from '../lib/collector.js';
import { status } from '../commands/status.js';
import { uninstall } from '../commands/uninstall.js';
import { enableAutostart, disableAutostart } from '../commands/autostart.js';
import { install as installHooks, uninstall as uninstallHooks } from '../commands/hooks.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('claude-code-otel')
  .description('Zero-config OpenTelemetry pipeline: Claude Code → ClickHouse')
  .version(pkg.version);

program
  .command('setup')
  .description('Configure ClickHouse credentials and patch your shell with telemetry env vars')
  .option('--host <host>', 'ClickHouse host')
  .option('--port <port>', 'ClickHouse port', '8443')
  .option('--user <user>', 'ClickHouse user', 'default')
  .option('--password <password>', 'ClickHouse password')
  .option('--database <db>', 'ClickHouse database', 'default')
  .option('--non-interactive', 'Skip prompts, use flags only')
  .action(async (opts) => {
    await setup(opts);
  });

program
  .command('start')
  .description('Start the OTel collector daemon (downloads binary if needed)')
  .action(async () => {
    await start();
  });

program
  .command('stop')
  .description('Stop the OTel collector daemon')
  .action(() => {
    stop();
  });

program
  .command('status')
  .description('Show collector status and recent ClickHouse stats')
  .action(async () => {
    await status();
  });

program
  .command('autostart')
  .description('Install a launch agent so the collector starts automatically on login')
  .option('--disable', 'Remove the launch agent')
  .action((opts) => {
    if (opts.disable) disableAutostart();
    else enableAutostart();
  });

program
  .command('uninstall')
  .description('Stop daemon, remove config, and clean shell patches')
  .action(async () => {
    await uninstall();
  });

program
  .command('hooks')
  .description('Install or remove Claude Code hook scripts that emit OTel spans')
  .option('--uninstall', 'Remove hook scripts and entries from ~/.claude/settings.json')
  .action((opts) => {
    if (opts.uninstall) uninstallHooks();
    else installHooks();
  });

program.parse(process.argv);

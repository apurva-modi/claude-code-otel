import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { COLLECTOR_CONFIG_FILE, LOG_FILE } from '../lib/config.js';

const PLIST_LABEL = 'com.claude-code-otel';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

function getBinaryPath(): string {
  // Check system PATH
  try {
    const p = execSync('which otelcol-contrib', { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch {}

  // Check next to the dist/ dir (project or global install)
  const candidates = [
    path.join(__dirname, '../../../bin/otelcol-contrib'),  // global install
    path.join(__dirname, '../../bin/otelcol-contrib'),     // local install
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error('otelcol-contrib not found. Run `claude-code-otel start` first to download it.');
}

export function enableAutostart(): void {
  if (process.platform !== 'darwin') {
    console.error(chalk.red('✗ Autostart currently only supported on macOS'));
    process.exit(1);
  }

  const binPath = getBinaryPath();

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binPath}</string>
        <string>--config</string>
        <string>${COLLECTOR_CONFIG_FILE}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
</dict>
</plist>`;

  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, plist, 'utf8');

  try {
    execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null; launchctl load -w "${PLIST_PATH}"`, { stdio: 'pipe' });
  } catch {}

  console.log(chalk.green('✓ Autostart enabled'));
  console.log(chalk.dim(`  Plist  → ${PLIST_PATH}`));
  console.log(chalk.dim('  Collector will start automatically on login and restart if it crashes'));
}

export function disableAutostart(): void {
  if (process.platform !== 'darwin') {
    console.error(chalk.red('✗ Autostart currently only supported on macOS'));
    process.exit(1);
  }

  if (!fs.existsSync(PLIST_PATH)) {
    console.log(chalk.yellow('⚠  Autostart is not enabled'));
    return;
  }

  try {
    execSync(`launchctl unload -w "${PLIST_PATH}"`, { stdio: 'pipe' });
  } catch {}

  fs.unlinkSync(PLIST_PATH);
  console.log(chalk.green('✓ Autostart disabled'));
}

export function autostartEnabled(): boolean {
  return fs.existsSync(PLIST_PATH);
}

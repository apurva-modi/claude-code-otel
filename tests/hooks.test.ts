import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.claude-code-otel');
const BACKUP_DIR = CONFIG_DIR + '.hooks-test-backup-' + process.pid;

import { writeScript, EMITTER_SCRIPT as EMITTER_SCRIPT_CONST } from '../src/commands/hooks.js';
import { install, uninstall } from '../src/commands/hooks.js';

describe('hooks: writeScript', () => {
  beforeEach(() => {
    if (fs.existsSync(CONFIG_DIR)) fs.renameSync(CONFIG_DIR, BACKUP_DIR);
  });
  afterEach(() => {
    if (fs.existsSync(CONFIG_DIR)) fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, CONFIG_DIR);
  });

  it('writes the script to the hooks dir', () => {
    writeScript();
    expect(fs.existsSync(EMITTER_SCRIPT_CONST)).toBe(true);
  });

  it('script is executable', () => {
    writeScript();
    const mode = fs.statSync(EMITTER_SCRIPT_CONST).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('script is valid Python 3', () => {
    writeScript();
    expect(() => execSync(`python3 -m py_compile ${EMITTER_SCRIPT_CONST}`)).not.toThrow();
  });

  it('handles unknown event without crashing', () => {
    writeScript();
    const input = JSON.stringify({ hook_event_name: 'Unknown', session_id: 'test-sid' });
    expect(() =>
      execSync(`python3 ${EMITTER_SCRIPT_CONST}`, { input, timeout: 3000, encoding: 'utf8' })
    ).not.toThrow();
  });
});

describe('hooks: install / uninstall', () => {
  const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
  const CLAUDE_DIR = path.dirname(CLAUDE_SETTINGS);
  const SETTINGS_BACKUP = CLAUDE_SETTINGS + '.hooks-test-backup-' + process.pid;

  beforeEach(() => {
    if (fs.existsSync(CONFIG_DIR)) fs.renameSync(CONFIG_DIR, BACKUP_DIR);
    if (fs.existsSync(CLAUDE_SETTINGS)) fs.copyFileSync(CLAUDE_SETTINGS, SETTINGS_BACKUP);
  });
  afterEach(() => {
    if (fs.existsSync(CONFIG_DIR)) fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, CONFIG_DIR);
    if (fs.existsSync(SETTINGS_BACKUP)) {
      fs.copyFileSync(SETTINGS_BACKUP, CLAUDE_SETTINGS);
      fs.unlinkSync(SETTINGS_BACKUP);
    }
  });

  it('install writes the script and registers all 3 hook types', () => {
    install();
    expect(fs.existsSync(EMITTER_SCRIPT_CONST)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    expect(settings.hooks?.PreToolUse).toBeDefined();
    expect(settings.hooks?.PostToolUse).toBeDefined();
    expect(settings.hooks?.Stop).toBeDefined();
  });

  it('install hook entries reference span_emitter.py', () => {
    install();
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    const pre = settings.hooks.PreToolUse as any[];
    const cmd = pre.flatMap((e: any) => e.hooks).find((h: any) => h.command?.includes('span_emitter'));
    expect(cmd).toBeDefined();
  });

  it('install is idempotent — running twice does not duplicate hooks', () => {
    install();
    install();
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    const pre = settings.hooks.PreToolUse as any[];
    // No entry should have an empty hooks array
    for (const entry of pre) {
      expect((entry.hooks ?? []).length).toBeGreaterThan(0);
    }
    // Exactly one span_emitter command
    const emitters = pre.flatMap((e: any) => e.hooks).filter((h: any) => h.command?.includes('span_emitter'));
    expect(emitters.length).toBe(1);
  });

  it('install preserves existing hooks in settings.json', () => {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] }
    }), 'utf8');
    install();
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    const pre = settings.hooks.PreToolUse as any[];
    const echo = pre.flatMap((e: any) => e.hooks).find((h: any) => h.command === 'echo hi');
    expect(echo).toBeDefined();
  });

  it('uninstall removes span_emitter entries from all hook types', () => {
    install();
    uninstall();
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    for (const hookType of ['PreToolUse', 'PostToolUse', 'Stop']) {
      const entries = (settings.hooks?.[hookType] ?? []) as any[];
      const emitters = entries.flatMap((e: any) => e.hooks ?? []).filter((h: any) => h.command?.includes('span_emitter'));
      expect(emitters.length).toBe(0);
    }
  });

  it('uninstall removes the script file', () => {
    install();
    uninstall();
    expect(fs.existsSync(EMITTER_SCRIPT_CONST)).toBe(false);
  });
});

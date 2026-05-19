import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.claude-code-otel');
const BACKUP_DIR = CONFIG_DIR + '.hooks-test-backup-' + process.pid;

import { writeScript, EMITTER_SCRIPT as EMITTER_SCRIPT_CONST } from '../src/commands/hooks.js';

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
      execSync(`echo '${input}' | python3 ${EMITTER_SCRIPT_CONST}`, { timeout: 3000 })
    ).not.toThrow();
  });
});

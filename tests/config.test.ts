import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  ensureConfigDir,
  saveConfig,
  loadConfig,
  configExists,
  CONFIG_DIR,
  CONFIG_FILE,
} from '../src/lib/config.js';

// Backup dir so tests never permanently destroy ~/.claude-code-otel
const BACKUP_DIR = CONFIG_DIR + '.test-backup-' + process.pid;

describe('config', () => {
  beforeEach(() => {
    if (fs.existsSync(CONFIG_DIR)) {
      fs.renameSync(CONFIG_DIR, BACKUP_DIR);
    }
  });

  afterEach(() => {
    if (fs.existsSync(CONFIG_DIR)) {
      fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(BACKUP_DIR)) {
      fs.renameSync(BACKUP_DIR, CONFIG_DIR);
    }
  });

  it('ensureConfigDir creates the directory', () => {
    expect(fs.existsSync(CONFIG_DIR)).toBe(false);
    ensureConfigDir();
    expect(fs.existsSync(CONFIG_DIR)).toBe(true);
  });

  it('ensureConfigDir is idempotent', () => {
    ensureConfigDir();
    expect(() => ensureConfigDir()).not.toThrow();
  });

  it('saveConfig writes and loadConfig reads back', () => {
    const cfg = {
      host: 'myhost.clickhouse.cloud',
      port: '8443',
      user: 'default',
      password: 'secret',
      database: 'default',
      secure: true,
    };
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded).toEqual(cfg);
  });

  it('saveConfig sets file permissions to 600', () => {
    saveConfig({ host: 'h', port: '8443', user: 'u', password: 'p', database: 'd', secure: true });
    const mode = fs.statSync(CONFIG_FILE).mode;
    expect(mode & 0o777).toBe(0o600);
  });

  it('loadConfig returns null when file does not exist', () => {
    expect(loadConfig()).toBeNull();
  });

  it('loadConfig returns null on malformed JSON', () => {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_FILE, 'not json', 'utf8');
    expect(loadConfig()).toBeNull();
  });

  it('configExists returns false when no config', () => {
    expect(configExists()).toBe(false);
  });

  it('configExists returns true after saveConfig', () => {
    saveConfig({ host: 'h', port: '8443', user: 'u', password: 'p', database: 'd', secure: true });
    expect(configExists()).toBe(true);
  });
});

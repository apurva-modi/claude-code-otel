import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = path.join(os.tmpdir(), 'claude-code-otel-collector-test-' + process.pid);

describe('writeCollectorConfig', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('generates valid YAML without tls key', async () => {
    // Point config paths to tmpDir
    vi.doMock('../src/lib/config.js', () => ({
      CONFIG_DIR: tmpDir,
      CONFIG_FILE: path.join(tmpDir, 'config.json'),
      COLLECTOR_CONFIG_FILE: path.join(tmpDir, 'otel-config.yaml'),
      PID_FILE: path.join(tmpDir, 'collector.pid'),
      LOG_FILE: path.join(tmpDir, 'collector.log'),
      ensureConfigDir: () => fs.mkdirSync(tmpDir, { recursive: true }),
      loadConfig: () => null,
      saveConfig: vi.fn(),
      configExists: () => false,
    }));

    const { writeCollectorConfig } = await import('../src/lib/collector.js');

    const config = {
      host: 'myhost.clickhouse.cloud',
      port: '8443',
      user: 'default',
      password: 'secret',
      database: 'mydb',
      secure: true,
    };

    writeCollectorConfig(config);

    const yaml = fs.readFileSync(path.join(tmpDir, 'otel-config.yaml'), 'utf8');
    expect(yaml).toContain('endpoint: https://myhost.clickhouse.cloud:8443');
    expect(yaml).toContain('username: default');
    expect(yaml).toContain('password: secret');
    expect(yaml).toContain('database: mydb');
    expect(yaml).not.toContain('tls:');
    expect(yaml).toContain('logs_table_name: otel_logs');
    expect(yaml).toContain('traces_table_name: otel_traces');
    expect(yaml).toContain('metrics_table_name: otel_metrics');
  });

  it('uses http endpoint when secure is false', async () => {
    vi.doMock('../src/lib/config.js', () => ({
      CONFIG_DIR: tmpDir,
      CONFIG_FILE: path.join(tmpDir, 'config.json'),
      COLLECTOR_CONFIG_FILE: path.join(tmpDir, 'otel-config.yaml'),
      PID_FILE: path.join(tmpDir, 'collector.pid'),
      LOG_FILE: path.join(tmpDir, 'collector.log'),
      ensureConfigDir: () => fs.mkdirSync(tmpDir, { recursive: true }),
      loadConfig: () => null,
      saveConfig: vi.fn(),
      configExists: () => false,
    }));

    const { writeCollectorConfig } = await import('../src/lib/collector.js');

    writeCollectorConfig({
      host: 'localhost',
      port: '8123',
      user: 'default',
      password: '',
      database: 'default',
      secure: false,
    });

    const yaml = fs.readFileSync(path.join(tmpDir, 'otel-config.yaml'), 'utf8');
    expect(yaml).toContain('endpoint: http://localhost:8123');
  });
});

describe('isRunning', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns false when pid file does not exist', async () => {
    vi.doMock('../src/lib/config.js', () => ({
      CONFIG_DIR: tmpDir,
      CONFIG_FILE: path.join(tmpDir, 'config.json'),
      COLLECTOR_CONFIG_FILE: path.join(tmpDir, 'otel-config.yaml'),
      PID_FILE: path.join(tmpDir, 'nonexistent.pid'),
      LOG_FILE: path.join(tmpDir, 'collector.log'),
      ensureConfigDir: () => {},
      loadConfig: () => null,
      saveConfig: vi.fn(),
      configExists: () => false,
    }));

    const { isRunning } = await import('../src/lib/collector.js');
    expect(isRunning()).toBe(false);
  });

  it('returns false for a non-existent PID', async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const pidFile = path.join(tmpDir, 'collector.pid');
    fs.writeFileSync(pidFile, '99999999', 'utf8'); // very unlikely to exist

    vi.doMock('../src/lib/config.js', () => ({
      CONFIG_DIR: tmpDir,
      CONFIG_FILE: path.join(tmpDir, 'config.json'),
      COLLECTOR_CONFIG_FILE: path.join(tmpDir, 'otel-config.yaml'),
      PID_FILE: pidFile,
      LOG_FILE: path.join(tmpDir, 'collector.log'),
      ensureConfigDir: () => {},
      loadConfig: () => null,
      saveConfig: vi.fn(),
      configExists: () => false,
    }));

    const { isRunning } = await import('../src/lib/collector.js');
    expect(isRunning()).toBe(false);
    expect(fs.existsSync(pidFile)).toBe(false); // stale pid cleaned up
  });
});

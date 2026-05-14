import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ClickHouseConfig } from '../types.js';

export const CONFIG_DIR = path.join(os.homedir(), '.claude-code-otel');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const COLLECTOR_CONFIG_FILE = path.join(CONFIG_DIR, 'otel-config.yaml');
export const PID_FILE = path.join(CONFIG_DIR, 'collector.pid');
export const LOG_FILE = path.join(CONFIG_DIR, 'collector.log');

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.chmodSync(CONFIG_DIR, 0o700);
  }
}

export function saveConfig(config: ClickHouseConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  fs.chmodSync(CONFIG_FILE, 0o600);
}

export function loadConfig(): ClickHouseConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as ClickHouseConfig;
  } catch {
    return null;
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

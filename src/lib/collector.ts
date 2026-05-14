import fs from 'fs';
import path from 'path';
import https from 'https';
import { spawn, execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import type { ClickHouseConfig } from '../types.js';
import {
  ensureConfigDir,
  loadConfig,
  COLLECTOR_CONFIG_FILE,
  PID_FILE,
  LOG_FILE,
} from './config.js';

const BUNDLED_BIN = path.join(__dirname, '../../bin/otelcol-contrib');

export function writeCollectorConfig(config: ClickHouseConfig): void {
  ensureConfigDir();
  const protocol = config.secure ? 'https' : 'http';
  const yaml = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000

exporters:
  clickhouse:
    endpoint: ${protocol}://${config.host}:${config.port}
    database: ${config.database}
    username: ${config.user}
    password: ${config.password}
    logs_table_name: otel_logs
    traces_table_name: otel_traces
    metrics_table_name: otel_metrics
    timeout: 10s
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]
`;
  fs.writeFileSync(COLLECTOR_CONFIG_FILE, yaml, 'utf8');
}

export function isRunning(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

export async function start(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(chalk.red('✗ No config found. Run: claude-code-otel setup'));
    process.exit(1);
  }

  if (isRunning()) {
    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    console.log(chalk.yellow(`⚠  Collector already running (PID ${pid})`));
    return;
  }

  writeCollectorConfig(config);
  const binPath = await ensureCollectorBinary();

  console.log(chalk.cyan('Starting OTel collector...'));
  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(binPath, ['--config', COLLECTOR_CONFIG_FILE], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');

  await new Promise((r) => setTimeout(r, 1500));

  if (isRunning()) {
    console.log(chalk.green(`✓ Collector started (PID ${child.pid})`));
    console.log(chalk.dim(`  gRPC  → localhost:4317`));
    console.log(chalk.dim(`  HTTP  → localhost:4318`));
    console.log(chalk.dim(`  Logs  → ${LOG_FILE}`));
  } else {
    console.error(chalk.red('✗ Collector failed to start. Check logs:'));
    console.error(chalk.dim(`  cat ${LOG_FILE}`));
    process.exit(1);
  }
}

export function stop(): void {
  if (!isRunning()) {
    console.log(chalk.yellow('⚠  Collector is not running'));
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(PID_FILE);
    console.log(chalk.green(`✓ Collector stopped (PID ${pid})`));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`✗ Failed to stop process ${pid}: ${msg}`));
  }
}

async function ensureCollectorBinary(): Promise<string> {
  if (fs.existsSync(BUNDLED_BIN)) return BUNDLED_BIN;
  try {
    const which = execSync('which otelcol-contrib', { encoding: 'utf8' }).trim();
    if (which) return which;
  } catch {
    // not on PATH
  }
  return downloadCollectorBinary();
}

async function downloadCollectorBinary(): Promise<string> {
  const spinner = ora('Downloading otelcol-contrib binary...').start();
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const version = '0.99.0';

  const platformMap: Record<string, string> = {
    darwin: `darwin_${arch}`,
    linux: `linux_${arch}`,
    win32: `windows_${arch}`,
  };

  const suffix = platformMap[platform];
  if (!suffix) {
    spinner.fail(`Unsupported platform: ${platform}`);
    process.exit(1);
  }

  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const url = `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${version}/otelcol-contrib_${version}_${suffix}.${ext}`;
  const binDir = path.join(__dirname, '../../bin');
  const binPath = path.join(binDir, platform === 'win32' ? 'otelcol-contrib.exe' : 'otelcol-contrib');
  const archivePath = `${binPath}.${ext}`;

  fs.mkdirSync(binDir, { recursive: true });
  await downloadFile(url, archivePath);

  if (ext === 'tar.gz') {
    execSync(`tar -xzf "${archivePath}" -C "${binDir}" otelcol-contrib`);
    fs.chmodSync(binPath, 0o755);
    fs.unlinkSync(archivePath);
  } else {
    execSync(`unzip -o "${archivePath}" otelcol-contrib.exe -d "${binDir}"`);
    fs.unlinkSync(archivePath);
  }

  spinner.succeed('otelcol-contrib ready');
  return binPath;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u: string) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

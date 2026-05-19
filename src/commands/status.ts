import fs from 'fs';
import chalk from 'chalk';
import { createClient } from '@clickhouse/client';
import { isRunning } from '../lib/collector.js';
import { loadConfig, PID_FILE, LOG_FILE } from '../lib/config.js';

export async function status(): Promise<void> {
  console.log(chalk.bold.cyan('\n📊 claude-code-otel status\n'));

  const running = isRunning();
  if (running) {
    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    console.log(chalk.green(`✓ Collector running`) + chalk.dim(` (PID ${pid})`));
    console.log(chalk.dim(`  gRPC → localhost:4317   HTTP → localhost:4318`));
  } else {
    console.log(chalk.red('✗ Collector not running') + chalk.dim('  →  run: claude-code-otel start'));
  }

  const config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('\n⚠  No ClickHouse config. Run: claude-code-otel setup'));
    return;
  }

  console.log(chalk.bold(`\nClickHouse › ${config.host}:${config.port}/${config.database}\n`));

  const client = createClient({
    host: `${config.secure ? 'https' : 'http'}://${config.host}:${config.port}`,
    username: config.user,
    password: config.password,
    database: config.database,
  });

  try {
    const tracesResult = await client.query({
      query: `
        SELECT
          ServiceName,
          count()                                   AS spans,
          round(avg(Duration) / 1e6, 1)             AS avg_ms,
          countIf(StatusCode = 'STATUS_CODE_ERROR') AS errors,
          max(Timestamp)                             AS last_seen
        FROM otel_traces
        WHERE Timestamp > now() - INTERVAL 1 HOUR
        GROUP BY ServiceName
        ORDER BY last_seen DESC
        LIMIT 8
      `,
      format: 'JSONEachRow',
    });
    const traceRows = await tracesResult.json<{
      ServiceName: string;
      spans: string;
      avg_ms: string;
      errors: string;
      last_seen: string;
    }>();

    if (traceRows.length > 0) {
      console.log(chalk.bold('Traces (last 1h):'));
      console.log(chalk.dim('  Service                  Spans   Avg ms   Errors   Last seen'));
      for (const r of traceRows) {
        const errVal = String(r.errors);
        const errStr = errVal !== '0'
          ? chalk.red(errVal.padEnd(9))
          : chalk.dim(errVal.padEnd(9));
        console.log(`  ${String(r.ServiceName).padEnd(25)}${String(r.spans).padEnd(8)}${String(r.avg_ms).padEnd(9)}${errStr}${chalk.dim(String(r.last_seen))}`);
      }
    } else {
      console.log(chalk.dim('  No traces yet in the last hour.'));
      console.log(chalk.dim('  Make sure to: source ~/.zshrc && claude'));
    }

    const logsResult = await client.query({
      query: `SELECT count() AS c FROM otel_logs WHERE Timestamp > now() - INTERVAL 1 HOUR`,
      format: 'JSONEachRow',
    });
    const [logRow] = await logsResult.json<{ c: string }>();
    console.log(chalk.dim(`\n  Logs (last 1h):    ${logRow.c}`));

    const metricsResult = await client.query({
      query: `
        SELECT MetricName, count() AS c
        FROM otel_metrics_sum
        WHERE TimeUnix > now() - INTERVAL 1 HOUR
        GROUP BY MetricName
        ORDER BY c DESC
        LIMIT 6
      `,
      format: 'JSONEachRow',
    });
    const metricRows = await metricsResult.json<{ MetricName: string; c: string }>();
    if (metricRows.length > 0) {
      console.log(chalk.dim(`  Metrics (last 1h): ${metricRows.map((r) => r.MetricName).join(', ')}`));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`\n✗ ClickHouse error: ${msg}`));
  } finally {
    await client.close();
  }

  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-5);
    if (lines.length > 0) {
      console.log(chalk.bold('\nCollector log (last 5 lines):'));
      lines.forEach((l) => console.log(chalk.dim(`  ${l}`)));
    }
  }

  console.log('');
}

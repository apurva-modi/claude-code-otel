# claude-code-otel

Zero-config OpenTelemetry pipeline from **Claude Code → ClickHouse**.

Three commands and your Claude Code sessions are flowing into ClickHouse automatically — logs and metrics per API call, tool use, and session activity.

## Install

```bash
npm install -g claude-code-otel
```

## Quickstart

```bash
# 1. Configure (interactive prompts)
claude-code-otel setup

# 2. Start the collector daemon
claude-code-otel start

# 3. Reload your shell and start coding
source ~/.zshrc
claude
```

That's it. Every Claude Code session now streams telemetry into your ClickHouse tables.

---

## Commands

### `claude-code-otel setup`

Prompts for your ClickHouse credentials, writes the collector config to `~/.claude-code-otel/`, and injects the required env vars into your `.zshrc` / `.bashrc`.

```bash
# Interactive (recommended)
claude-code-otel setup

# Non-interactive (CI / scripting)
claude-code-otel setup \
  --host yourinstance.ap-south-1.aws.clickhouse.cloud \
  --port 8443 \
  --user default \
  --password yourpassword \
  --database default \
  --non-interactive
```

### `claude-code-otel start`

Starts `otelcol-contrib` as a background daemon. Downloads the correct binary for your OS/arch automatically if it's not already present.

### `claude-code-otel stop`

Stops the daemon gracefully.

### `claude-code-otel status`

Shows daemon state and a live summary of what's arrived in ClickHouse in the last hour.

```
📊 claude-code-otel status

✓ Collector running (PID 12345)
  gRPC → localhost:4317   HTTP → localhost:4318

ClickHouse › yourhost:8443/default

  No traces yet in the last hour.
  Make sure to: source ~/.zshrc && claude

  Logs (last 1h):    42
  Metrics (last 1h): claude_code.token.usage, claude_code.cost.usage, claude_code.active_time.total
```

### `claude-code-otel uninstall`

Stops the daemon, removes `~/.claude-code-otel/`, and cleans the env var block from your shell rc files.

---

## What gets collected

| ClickHouse table | Contents |
|---|---|
| `otel_logs` | One row per event: `api_request`, `tool_decision`, `tool_result`, `user_prompt` |
| `otel_metrics_sum` | Token counts (`claude_code.token.usage`), cost (`claude_code.cost.usage`), active time |

Each log row includes `session.id`, `user.email`, `model`, `cost_usd`, `duration_ms`, and more as `LogAttributes`.

> **Note:** Claude Code does not currently emit trace spans, so `otel_traces` will remain empty. Logs and metrics capture the full picture.

All tables use the standard OpenTelemetry schema.

---

## How it works

```
Claude Code  ──(OTLP/gRPC)──▶  otelcol-contrib (localhost:4317)  ──▶  ClickHouse
```

`claude-code-otel setup` writes these env vars into your shell rc:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_METRIC_EXPORT_INTERVAL=10000
export OTEL_LOGS_EXPORT_INTERVAL=5000
```

The collector config lives at `~/.claude-code-otel/otel-config.yaml`. Credentials are stored at `~/.claude-code-otel/config.json` (chmod 600).

---

## Querying your data

```sql
-- Recent API calls with cost
SELECT
  Timestamp,
  LogAttributes['session.id']   AS session,
  LogAttributes['model']        AS model,
  LogAttributes['cost_usd']     AS cost,
  LogAttributes['duration_ms']  AS duration_ms
FROM otel_logs
WHERE Body = 'claude_code.api_request'
ORDER BY Timestamp DESC
LIMIT 20;

-- Token usage over time
SELECT
  toStartOfHour(toDateTime(TimeUnix)) AS hour,
  sum(Value)                          AS tokens
FROM otel_metrics_sum
WHERE MetricName = 'claude_code.token.usage'
GROUP BY hour
ORDER BY hour DESC;
```

---

## Programmatic usage

```typescript
import { setup, start, status } from 'claude-code-otel';

await setup({
  host: 'yourinstance.clickhouse.cloud',
  port: '8443',
  user: 'default',
  password: 'yourpassword',
  nonInteractive: true,
});

await start();
await status();
```

---

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Watch mode
npm run build:watch
```

## Requirements

- Node.js 18+
- Claude Code installed
- A ClickHouse instance (Cloud or self-hosted)

## Publishing

```bash
# Dry run — see what will be published
npm pack --dry-run

# Publish (runs build automatically via prepublishOnly)
npm publish --access public
```

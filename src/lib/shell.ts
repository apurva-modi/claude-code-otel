import fs from 'fs';
import path from 'path';
import os from 'os';

const MARKER_START = '# >>> claude-code-otel >>>';
const MARKER_END = '# <<< claude-code-otel <<<';

const ENV_BLOCK = `
${MARKER_START}
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_METRIC_EXPORT_INTERVAL=10000
export OTEL_LOGS_EXPORT_INTERVAL=5000
${MARKER_END}
`;

const RC_FILES = ['.zshrc', '.bashrc', '.bash_profile'];

export function patchShell(): string[] {
  const home = os.homedir();
  const patched: string[] = [];

  for (const rc of RC_FILES) {
    const rcPath = path.join(home, rc);
    if (!fs.existsSync(rcPath)) continue;
    const contents = fs.readFileSync(rcPath, 'utf8');
    if (contents.includes(MARKER_START)) continue;
    fs.appendFileSync(rcPath, ENV_BLOCK, 'utf8');
    patched.push(`~/${rc}`);
  }

  return patched;
}

export function unpatchShell(): string[] {
  const home = os.homedir();
  const unpatched: string[] = [];

  for (const rc of RC_FILES) {
    const rcPath = path.join(home, rc);
    if (!fs.existsSync(rcPath)) continue;
    const contents = fs.readFileSync(rcPath, 'utf8');
    if (!contents.includes(MARKER_START)) continue;
    const cleaned = contents.replace(
      new RegExp(`\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`, 'g'),
      '\n',
    );
    fs.writeFileSync(rcPath, cleaned, 'utf8');
    unpatched.push(`~/${rc}`);
  }

  return unpatched;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

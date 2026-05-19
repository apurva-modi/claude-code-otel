import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.claude-code-otel');
const HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');
export const EMITTER_SCRIPT = path.join(HOOKS_DIR, 'span_emitter.py');

const EMITTER_PY = `#!/usr/bin/env python3
"""
Claude Code OTel span emitter hook.
Handles PreToolUse, PostToolUse, Stop events and emits OTLP JSON spans
to the local collector at http://localhost:4318/v1/traces.

State per session is stored in ~/.claude-code-otel/sessions/<session_id>.json
In-flight span data is stored in ~/.claude-code-otel/sessions/<session_id>.span.json
"""
import json
import sys
import os
import time
import pathlib
import urllib.request

CONFIG_DIR = pathlib.Path.home() / '.claude-code-otel'
SESSIONS_DIR = CONFIG_DIR / 'sessions'
COLLECTOR_URL = 'http://localhost:4318/v1/traces'
SERVICE_NAME = 'claude-code'


def rand_hex(n: int) -> str:
    return ''.join(f'{b:02x}' for b in os.urandom(n))


def now_ns() -> int:
    return int(time.time() * 1e9)


def session_file(sid: str) -> pathlib.Path:
    return SESSIONS_DIR / f'{sid}.json'


def span_file(sid: str) -> pathlib.Path:
    return SESSIONS_DIR / f'{sid}.span.json'


def load_session(sid: str) -> dict:
    f = session_file(sid)
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    state = {
        'session_id': sid,
        'start_ns': now_ns(),
        'tool_count': 0,
        'last_tool': None,
        'consecutive_count': 0,
        'trace_id': rand_hex(16),
    }
    save_session(state)
    return state


def save_session(state: dict) -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    session_file(state['session_id']).write_text(json.dumps(state))


def attr(key: str, value) -> dict:
    if isinstance(value, bool):
        return {'key': key, 'value': {'boolValue': value}}
    if isinstance(value, int):
        return {'key': key, 'value': {'intValue': str(value)}}
    return {'key': key, 'value': {'stringValue': str(value)}}


def emit_spans(spans: list) -> None:
    resource_attrs = [
        attr('service.name', SERVICE_NAME),
        attr('routeiq.agent.id', SERVICE_NAME),
    ]
    payload = {
        'resourceSpans': [{
            'resource': {'attributes': resource_attrs},
            'scopeSpans': [{'scope': {'name': 'claude-code-otel'}, 'spans': spans}],
        }]
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        COLLECTOR_URL, data=body,
        headers={'Content-Type': 'application/json'}, method='POST',
    )
    try:
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # best-effort — never block Claude Code


def handle_pre(event: dict) -> None:
    sid = event['session_id']
    state = load_session(sid)
    tool_name = event.get('tool_name', '')
    tool_input = event.get('tool_input', {})

    if state.get('last_tool') == tool_name:
        state['consecutive_count'] = state.get('consecutive_count', 0) + 1
    else:
        state['consecutive_count'] = 1
    state['last_tool'] = tool_name
    state['tool_count'] = state.get('tool_count', 0) + 1
    save_session(state)

    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    span_file(sid).write_text(json.dumps({
        'span_id': rand_hex(8),
        'start_ns': now_ns(),
        'tool_name': tool_name,
        'tool_input': tool_input,
    }))


def handle_post(event: dict) -> None:
    sid = event['session_id']
    end_ns = now_ns()

    sf = span_file(sid)
    if not sf.exists():
        return
    try:
        span_data = json.loads(sf.read_text())
    except Exception:
        return
    finally:
        sf.unlink(missing_ok=True)

    state = load_session(sid)
    tool_name = event.get('tool_name', span_data.get('tool_name', ''))
    tool_input = event.get('tool_input', span_data.get('tool_input', {}))
    tool_response = event.get('tool_response', '')
    exit_code = event.get('exit_code', 0)
    success = exit_code == 0
    consecutive = state.get('consecutive_count', 1)
    loop_detected = consecutive >= 5

    attrs = [
        attr('gen_ai.tool.name', tool_name),
        attr('routeiq.tool.success', success),
        attr('routeiq.loop.detected', loop_detected),
        attr('routeiq.same_tool_count', str(consecutive)),
        attr('routeiq.session.id', sid),
        attr('claude_code.tool.exit_code', str(exit_code)),
        attr('claude_code.tool.input_size', str(len(json.dumps(tool_input)))),
        attr('claude_code.tool.output_size', str(len(str(tool_response)))),
    ]

    if tool_name == 'Bash' and 'command' in tool_input:
        attrs.append(attr('claude_code.tool.command', str(tool_input['command'])[:500]))
    for fkey in ('file_path', 'path'):
        if fkey in tool_input:
            attrs.append(attr('claude_code.tool.file_path', str(tool_input[fkey])[:500]))
            break

    emit_spans([{
        'traceId': state['trace_id'],
        'spanId': span_data['span_id'],
        'name': 'tool.call',
        'startTimeUnixNano': str(span_data['start_ns']),
        'endTimeUnixNano': str(end_ns),
        'kind': 3,
        'attributes': attrs,
        'status': {'code': 1 if success else 2},
    }])


def handle_stop(event: dict) -> None:
    sid = event['session_id']
    end_ns = now_ns()

    sf = session_file(sid)
    if not sf.exists():
        return
    try:
        state = json.loads(sf.read_text())
    except Exception:
        return

    stop_reason = event.get('stop_reason', 'end_turn')
    task_success = stop_reason == 'end_turn'

    emit_spans([{
        'traceId': state['trace_id'],
        'spanId': rand_hex(8),
        'name': 'agent.session',
        'startTimeUnixNano': str(state['start_ns']),
        'endTimeUnixNano': str(end_ns),
        'kind': 1,
        'attributes': [
            attr('routeiq.agent.id', SERVICE_NAME),
            attr('routeiq.session.id', sid),
            attr('routeiq.completion.reason', stop_reason),
            attr('routeiq.task.success', task_success),
            attr('routeiq.session.turn_count', str(state.get('tool_count', 0))),
        ],
        'status': {'code': 1},
    }])

    sf.unlink(missing_ok=True)
    span_f = span_file(sid)
    if span_f.exists():
        span_f.unlink(missing_ok=True)


def main() -> None:
    try:
        event = json.loads(sys.stdin.read())
        hook = event.get('hook_event_name', '')
        if hook == 'PreToolUse':
            handle_pre(event)
        elif hook == 'PostToolUse':
            handle_post(event)
        elif hook == 'Stop':
            handle_stop(event)
    except Exception:
        pass  # never block Claude Code


if __name__ == '__main__':
    main()
`;

export function writeScript(): void {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  fs.writeFileSync(EMITTER_SCRIPT, EMITTER_PY, 'utf8');
  fs.chmodSync(EMITTER_SCRIPT, 0o755);
}

const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_TYPES = ['PreToolUse', 'PostToolUse', 'Stop'] as const;

export function install(): void {
  writeScript();
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });

  let settings: Record<string, any> = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch { /* start fresh */ }
  }
  settings.hooks = settings.hooks ?? {};

  const command = `python3 ${EMITTER_SCRIPT}`;

  for (const hookType of HOOK_TYPES) {
    settings.hooks[hookType] = settings.hooks[hookType] ?? [];
    // Remove any existing span_emitter entry to avoid duplicates
    settings.hooks[hookType] = (settings.hooks[hookType] as any[]).map((entry: any) => ({
      ...entry,
      hooks: (entry.hooks ?? []).filter((h: any) => !h.command?.includes('span_emitter')),
    })).filter((entry: any) => (entry.hooks ?? []).length > 0);

    const newEntry = hookType === 'Stop'
      ? { hooks: [{ type: 'command', command }] }
      : { matcher: '', hooks: [{ type: 'command', command }] };

    settings.hooks[hookType].push(newEntry);
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), 'utf8');

  console.log(chalk.green('✓ Hooks installed'));
  console.log(chalk.dim(`  Script: ${EMITTER_SCRIPT}`));
  console.log(chalk.dim(`  Settings: ${CLAUDE_SETTINGS}`));
  console.log(chalk.bold('\n  Restart Claude Code for hooks to take effect.\n'));
}

export function uninstall(): void {
  if (fs.existsSync(EMITTER_SCRIPT)) fs.unlinkSync(EMITTER_SCRIPT);

  if (!fs.existsSync(CLAUDE_SETTINGS)) return;
  let settings: Record<string, any> = {};
  try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch { return; }

  for (const hookType of HOOK_TYPES) {
    if (!settings.hooks?.[hookType]) continue;
    settings.hooks[hookType] = (settings.hooks[hookType] as any[])
      .map((entry: any) => ({
        ...entry,
        hooks: (entry.hooks ?? []).filter((h: any) => !h.command?.includes('span_emitter')),
      }))
      .filter((entry: any) => (entry.hooks ?? []).length > 0);
    if (settings.hooks[hookType].length === 0) delete settings.hooks[hookType];
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), 'utf8');
  console.log(chalk.green('✓ Hooks uninstalled'));
}

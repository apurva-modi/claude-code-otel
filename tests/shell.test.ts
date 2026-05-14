import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpHome = path.join(os.tmpdir(), 'claude-code-otel-shell-test-' + process.pid);

// Point HOME at tmp dir so patchShell/unpatchShell use test RC files
const originalHome = os.homedir;
// @ts-ignore
os.homedir = () => tmpHome;

import { patchShell, unpatchShell } from '../src/lib/shell.js';

const MARKER_START = '# >>> claude-code-otel >>>';
const MARKER_END = '# <<< claude-code-otel <<<';

describe('shell', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
    // Create a fake .zshrc
    fs.writeFileSync(path.join(tmpHome, '.zshrc'), '# existing content\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    // @ts-ignore
    os.homedir = originalHome;
  });

  it('patchShell appends env block to .zshrc', () => {
    const patched = patchShell();
    expect(patched).toContain('~/.zshrc');
    const contents = fs.readFileSync(path.join(tmpHome, '.zshrc'), 'utf8');
    expect(contents).toContain(MARKER_START);
    expect(contents).toContain('CLAUDE_CODE_ENABLE_TELEMETRY=1');
    expect(contents).toContain(MARKER_END);
  });

  it('patchShell does not double-patch', () => {
    patchShell();
    const patched2 = patchShell();
    expect(patched2).toHaveLength(0);
  });

  it('unpatchShell removes the env block', () => {
    patchShell();
    const unpatched = unpatchShell();
    expect(unpatched).toContain('~/.zshrc');
    const contents = fs.readFileSync(path.join(tmpHome, '.zshrc'), 'utf8');
    expect(contents).not.toContain(MARKER_START);
    expect(contents).not.toContain('CLAUDE_CODE_ENABLE_TELEMETRY');
  });

  it('unpatchShell is a no-op when not patched', () => {
    const unpatched = unpatchShell();
    expect(unpatched).toHaveLength(0);
  });

  it('patchShell skips missing rc files', () => {
    // Only .zshrc exists, .bashrc does not
    const patched = patchShell();
    expect(patched).toEqual(['~/.zshrc']);
  });
});

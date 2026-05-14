export { setup } from './commands/setup.js';
export { status } from './commands/status.js';
export { uninstall } from './commands/uninstall.js';
export { start, stop, isRunning, writeCollectorConfig } from './lib/collector.js';
export { patchShell, unpatchShell } from './lib/shell.js';
export { saveConfig, loadConfig, configExists } from './lib/config.js';
export type { ClickHouseConfig, CollectorStatus, SetupOptions } from './types.js';

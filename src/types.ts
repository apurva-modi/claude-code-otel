export interface ClickHouseConfig {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  secure: boolean;
}

export interface CollectorStatus {
  running: boolean;
  pid?: number;
}

export interface SetupOptions {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  database?: string;
  nonInteractive?: boolean;
}

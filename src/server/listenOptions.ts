export interface ListenOptions {
  host: string;
  port: number;
  url: string;
}

export interface ListenOptionsEnv {
  HOST?: string;
  PORT?: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

function parsePort(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_PORT;
  }

  const port = Number(normalized);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function httpUrlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export function listenOptionsFromEnv(env: ListenOptionsEnv): ListenOptions {
  const host = env.HOST?.trim() || DEFAULT_HOST;
  const port = parsePort(env.PORT);

  return {
    host,
    port,
    url: `http://${httpUrlHost(host)}:${port}`,
  };
}

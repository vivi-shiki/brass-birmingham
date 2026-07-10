export type ServerUrlRuntimeLocation = {
  protocol: string;
  hostname: string;
  origin: string;
};

export type ServerUrlOptions = {
  isDev: boolean;
  location: ServerUrlRuntimeLocation;
  configuredServerUrl?: string;
  devServerPort?: number;
};

const DEFAULT_DEV_SERVER_PORT = 3001;

function normalizeConfiguredServerUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function hostForUrl(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;
}

function devServerUrl(location: ServerUrlRuntimeLocation, port: number): string {
  const hostname = location.hostname.trim() || '127.0.0.1';
  const protocol = location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${hostForUrl(hostname)}:${port}`;
}

export function serverUrlFromOptions(options: ServerUrlOptions): string {
  const configured = normalizeConfiguredServerUrl(options.configuredServerUrl);
  if (configured) {
    return configured;
  }

  return options.isDev
    ? devServerUrl(options.location, options.devServerPort ?? DEFAULT_DEV_SERVER_PORT)
    : options.location.origin;
}

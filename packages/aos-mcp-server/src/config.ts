export interface Config {
  baseUrl: URL;
  accessToken: string;
  timeoutMs: number;
  maxResponseBytes: number;
  /** AOS console where an overseer decides human steps; the approval card links to it. */
  consoleUrl?: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawBaseUrl = env.AOS_BASE_URL;
  const rawToken = env.AOS_ACCESS_TOKEN;

  if (!rawBaseUrl) throw new Error("AOS_BASE_URL is required");
  if (!rawToken) throw new Error("AOS_ACCESS_TOKEN is required");

  const baseUrl = new URL(rawBaseUrl);
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("AOS_BASE_URL must use http or https");
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error("Do not embed credentials in AOS_BASE_URL");
  }

  return {
    baseUrl: new URL(baseUrl.toString().endsWith("/") ? baseUrl : `${baseUrl}/`),
    accessToken: rawToken,
    timeoutMs: positiveInt(env.AOS_HTTP_TIMEOUT_MS, 15_000),
    maxResponseBytes: positiveInt(env.AOS_MAX_RESPONSE_BYTES, 1_048_576),
    consoleUrl: consoleUrl(env.AOS_CONSOLE_URL)
  };
}

function consoleUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("AOS_CONSOLE_URL must use http or https");
  return url.toString();
}

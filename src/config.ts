import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { ConfigError } from './errors.js';

export interface Config {
  requestorRef: string;
  baseUrl: string;
  fallbackUrl: string;
  timeoutMs: number;
  language: string;
  cacheTtlSeconds: number;
  dailyLimit: number;
  quotaWarnThreshold: number;
  confidenceLow: number;
  confidenceCertain: number;
  localities: string[];
  timezone: string;
  userAgent: string;
}

function numEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ConfigError(`Ungültige Zahl in der Konfiguration: "${raw}".`);
  }
  return n;
}

export function loadConfig(): Config {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }

  const requestorRef = (process.env.RequestorRef ?? '').trim();
  if (requestorRef === '') {
    throw new ConfigError(
      'RequestorRef fehlt.',
      'Bitte in .env setzen (Vorlage: .env.example). Der Wert kommt von Connect Fahrplanauskunft GmbH.',
    );
  }

  const localitiesRaw = process.env['GÖTTINGEN_LOCALITIES'] ?? 'Göttingen';
  const localities = localitiesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    requestorRef,
    baseUrl: process.env.TRIAS_BASE_URL ?? 'https://v4-api.efa.de/efa/trias',
    fallbackUrl: process.env.TRIAS_FALLBACK_URL ?? 'https://www.efa.de/efa/trias',
    timeoutMs: numEnv('TRIAS_TIMEOUT_MS', 20000),
    language: process.env.TRIAS_LANGUAGE ?? 'de',
    cacheTtlSeconds: numEnv('TRIAS_CACHE_TTL_SECONDS', 300),
    dailyLimit: numEnv('TRIAS_DAILY_LIMIT', 10000),
    quotaWarnThreshold: numEnv('TRIAS_QUOTA_WARN_THRESHOLD', 0.8),
    confidenceLow: numEnv('TRIAS_CONFIDENCE_LOW', 0.2),
    confidenceCertain: numEnv('TRIAS_CONFIDENCE_CERTAIN', 0.9),
    localities,
    timezone: process.env.TRIAS_TIMEZONE ?? 'Europe/Berlin',
    userAgent: process.env.TRIAS_USER_AGENT ?? 'MCP-Busse-Goettingen/0.1',
  };
}

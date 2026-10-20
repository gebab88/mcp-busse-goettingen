import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

describe('config', () => {
  const original = { ...process.env };

  beforeEach(() => {
    // clean relevant env
    delete process.env.RequestorRef;
    delete process.env.TRIAS_BASE_URL;
    delete process.env.TRIAS_FALLBACK_URL;
    delete process.env.TRIAS_TIMEOUT_MS;
    delete process.env.TRIAS_LANGUAGE;
    delete process.env.TRIAS_USER_AGENT;
    delete process.env.TRIAS_DAILY_LIMIT;
    delete process.env.TRIAS_QUOTA_WARN_THRESHOLD;
    delete process.env.TRIAS_CONFIDENCE_LOW;
    delete process.env.TRIAS_CONFIDENCE_CERTAIN;
    delete process.env.TRIAS_CACHE_TTL_SECONDS;
    delete process.env['GÖTTINGEN_LOCALITIES'];
    delete process.env.TRIAS_TIMEZONE;
  });

  afterEach(() => {
    const keys = Object.keys(process.env);
    for (const k of keys) {
      if (!(k in original)) delete process.env[k];
    }
    for (const k of Object.keys(original)) {
      process.env[k] = original[k];
    }
  });

  it('throws ConfigError when RequestorRef missing', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/path/without-a-dotenv');
    try {
      expect(() => loadConfig()).toThrowError(/RequestorRef/i);
    } finally {
      cwd.mockRestore();
    }
  });

  it('returns defaults for TEST-REF', () => {
    process.env.RequestorRef = 'TEST-REF';
    const cfg = loadConfig();
    expect(cfg.baseUrl).toBe('https://v4-api.efa.de/efa/trias');
    expect(cfg.fallbackUrl).toBe('https://www.efa.de/efa/trias');
    expect(cfg.dailyLimit).toBe(10000);
    expect(cfg.confidenceLow).toBe(0.2);
    expect(cfg.confidenceCertain).toBe(0.9);
    expect(cfg.localities).toEqual(['Göttingen']);
    expect(cfg.timezone).toBe('Europe/Berlin');
    expect(cfg.requestorRef).toBe('TEST-REF');
  });

  it('parses localities list', () => {
    process.env.RequestorRef = 'TEST-REF';
    process.env['GÖTTINGEN_LOCALITIES'] = 'Göttingen, Rosdorf';
    const cfg = loadConfig();
    expect(cfg.localities).toEqual(['Göttingen', 'Rosdorf']);
  });
});

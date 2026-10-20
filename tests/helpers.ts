import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TriasClient } from '../src/trias/client.js';
import { TtlCache } from '../src/cache.js';
import { Quota } from '../src/quota.js';
import { loadConfig, type Config } from '../src/config.js';
import { Resolver } from '../src/resolve.js';

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (n: string): string => readFileSync(join(here, 'fixtures', n), 'utf8');

export interface FakeServer {
  url: string;
  setBody: (b: string) => void;
  setMode: (m: 'ok' | 'empty' | 'http500' | 'garbage') => void;
  hits: () => number;
  close: () => Promise<void>;
}

export async function startFakeServer(): Promise<FakeServer> {
  let body = '';
  let mode: 'ok' | 'empty' | 'http500' | 'garbage' = 'ok';
  let hits = 0;
  const server: Server = createServer((_req, res) => {
    hits += 1;
    if (mode === 'http500') { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(mode === 'empty' ? '' : mode === 'garbage' ? 'kein xml <<<' : body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/trias`,
    setBody: (value) => { body = value; },
    setMode: (value) => { mode = value; },
    hits: () => hits,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export function makeCtx(url: string, quota = new Quota(10000, 0.8)) {
  const cfg: Config = { ...loadConfig(), baseUrl: url, fallbackUrl: url };
  const client = new TriasClient(cfg, quota);
  const cache = new TtlCache(300);
  const resolver = new Resolver(client, cfg, cache);
  return { client, resolver, cfg, quota, cache };
}

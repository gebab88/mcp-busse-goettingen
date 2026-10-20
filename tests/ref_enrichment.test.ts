import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { departures } from '../src/tools/departures.js';
import { journey } from '../src/tools/journey.js';
import { Resolver } from '../src/resolve.js';
import { TriasClient } from '../src/trias/client.js';
import { TtlCache } from '../src/cache.js';
import { Quota } from '../src/quota.js';
import { loadConfig } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(join(here, 'fixtures', n), 'utf8');

let server: Server;
let base: string;
let body = '';

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(body);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/trias`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const ctxFor = () => {
  const cfg = { ...loadConfig(), baseUrl: base, fallbackUrl: base };
  const quota = new Quota(10000, 0.8);
  const client = new TriasClient(cfg, quota);
  return { client, resolver: new Resolver(client, cfg, new TtlCache(300)), cfg, quota };
};

describe('Ref-Eingabe: die API-Antwort vervollständigt die Haltestelle', () => {
  it('trägt den echten Haltestellennamen nach, wenn eine Ref angefragt wurde', async () => {
    body = fixture('stop_event_response.xml');
    const env = await departures({ stop: 'de:03152:33924', when: '2026-10-20T12:00:00Z' }, ctxFor());
    const data = env.data as { resolved: { chosen: { name: string; stopPointRef: string; confidence: string; isLocal: boolean; locality?: string } } };
    // Der Resolver kannte bei einer Ref-Eingabe nur die Ref selbst.
    expect(data.resolved.chosen.name).toBe('Göttingen Grüner Weg');
    expect(data.resolved.chosen.stopPointRef).toBe('de:03152:33924');
  });

  it('hebt die Konfidenz auf "high", wenn die gewünschte Haltestelle geliefert wurde', async () => {
    body = fixture('stop_event_response.xml');
    const env = await departures({ stop: 'de:03152:33924', when: '2026-10-20T12:00:00Z' }, ctxFor());
    const data = env.data as { resolved: { chosen: { confidence: string } } };
    expect(data.resolved.chosen.confidence).toBe('high');
  });

  it('leitet den Ort aus dem Anzeigenamen ab und markiert ihn als lokal', async () => {
    body = fixture('stop_event_response.xml');
    const env = await departures({ stop: 'de:03152:33924', when: '2026-10-20T12:00:00Z' }, ctxFor());
    const data = env.data as { resolved: { chosen: { locality?: string; isLocal: boolean } } };
    expect(data.resolved.chosen.locality).toBe('Göttingen');
    expect(data.resolved.chosen.isLocal).toBe(true);
  });

  it('meldet bei unbekannter Ref weiterhin "low" und benennt die gelieferte Haltestelle', async () => {
    body = fixture('unknown_ref_foreign_stop.xml');
    const env = await departures({ stop: 'de:09999:33924', when: '2026-10-20T12:00:00Z' }, ctxFor());
    const data = env.data as { resolved: { chosen: { name: string; confidence: string }; note?: string } };
    expect(data.resolved.chosen.confidence).toBe('low');
    expect(data.resolved.chosen.name).toBe('Geretsried, Keplerweg');
    expect(data.resolved.note).toMatch(/existiert nicht/i);
    expect(env.warnings.join(' ')).toMatch(/existiert nicht/i);
  });

  it('nimmt bei einer Namens-Eingabe den vom Resolver ermittelten Namen nicht überschrieben', async () => {
    body = fixture('stop_event_response.xml');
    const env = await departures({ stop: 'Göttingen Grüner Weg', when: '2026-10-20T12:00:00Z' }, ctxFor());
    const data = env.data as { resolved: { chosen: { name: string } } };
    expect(data.resolved.chosen.name).toBe('Göttingen Grüner Weg');
  });
});

describe('journey: Ref-Eingabe wird um Namen ergänzt', () => {
  it('trägt Start- und Zielnamen aus der Verbindung nach', async () => {
    body = fixture('trip_response.xml');
    const env = await journey({ from: 'de:03152:33817', to: 'de:03152:33924', when: '2026-10-20T11:00:00Z' }, ctxFor());
    const data = env.data as {
      resolvedFrom: { chosen: { name: string } };
      resolvedTo: { chosen: { name: string } };
    };
    expect(data.resolvedFrom.chosen.name).toBe('Göttingen');
    expect(data.resolvedTo.chosen.name).toBe('Göttingen Grüner Weg');
  });
});

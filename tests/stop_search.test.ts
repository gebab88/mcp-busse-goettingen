import { afterEach, expect, it } from 'vitest';
import { fixture, makeCtx, startFakeServer } from './helpers.js';
import { stopSearch } from '../src/tools/stop_search.js';

let server: Awaited<ReturnType<typeof startFakeServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

it('liefert Stop-Suche im gemeinsamen Envelope', async () => {
  server = await startFakeServer(); server.setBody(fixture('location_goettingen.xml'));
  const env = await stopSearch({ query: 'Göttingen Bahnhof' }, makeCtx(server.url));
  expect(env.source).toBe('TRIAS'); expect(env.disclaimer).toBe('Alle Angaben ohne Gewähr.');
  expect((env.data as { stops: { stopPointRef: string; isLocal: boolean }[] }).stops[0]).toMatchObject({ stopPointRef: 'de:03152:33817', isLocal: true });
});

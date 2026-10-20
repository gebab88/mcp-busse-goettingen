import { afterEach, expect, it } from 'vitest';
import { journey } from '../src/tools/journey.js';
import { fixture, makeCtx, startFakeServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startFakeServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });
it('liefert Reisen mit Interchange-Legs', async () => {
  process.env.RequestorRef = 'TEST-REF';
  server = await startFakeServer(); server.setBody(fixture('trip_response.xml'));
  const env = await journey({ from: 'de:03152:33817', to: 'de:03152:33924', when: '2026-10-20T11:00:00Z' }, makeCtx(server.url));
  const data = env.data as { journeys: { durationMinutes: number; interchanges: number; legs: { kind: string }[] }[] };
  expect(data.journeys).toHaveLength(3); expect(data.journeys[0]).toMatchObject({ durationMinutes: 48, interchanges: 2 }); expect(data.journeys[0]!.legs.map((leg) => leg.kind)).toEqual(['timed', 'interchange', 'timed', 'timed']);
});

it('übernimmt bei einer Fuzzy-Antwort die tatsächlich verwendeten Endpunkt-Refs', async () => {
  process.env.RequestorRef = 'TEST-REF';
  server = await startFakeServer(); server.setBody(fixture('trip_response.xml'));
  const env = await journey({ from: 'de:09999:33924', to: 'de:09999:33817', when: '2026-10-20T11:00:00Z' }, makeCtx(server.url));
  const data = env.data as { resolvedFrom: { chosen: { stopPointRef: string; confidence: string } }; resolvedTo: { chosen: { stopPointRef: string; confidence: string } } };
  expect(data.resolvedFrom.chosen).toMatchObject({ stopPointRef: 'de:03152:33817::1', confidence: 'low' });
  expect(data.resolvedTo.chosen).toMatchObject({ stopPointRef: 'de:03152:33924::2', confidence: 'low' });
});

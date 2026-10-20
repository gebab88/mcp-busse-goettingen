import { afterEach, expect, it } from 'vitest';
import { departures } from '../src/tools/departures.js';
import { fixture, makeCtx, startFakeServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startFakeServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });
it('wandelt Abfahrtszeiten in lokale Zeiten um', async () => {
  server = await startFakeServer(); server.setBody(fixture('stop_event_realtime.xml'));
  const env = await departures({ stop: 'de:03152:33817', when: '2026-10-20T11:00:00Z' }, makeCtx(server.url));
  const first = (env.data as { departures: { timetabledTime: string; timetabledTimeLocal: string }[] }).departures[0]!;
  expect(first.timetabledTime).toMatch(/Z$/); expect(first.timetabledTimeLocal).toMatch(/[+-]\d{2}:\d{2}$/);
});

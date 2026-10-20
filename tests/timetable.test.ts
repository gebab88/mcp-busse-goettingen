import { expect, it } from 'vitest';
import { localDayStart, timetable } from '../src/tools/timetable.js';
import { fixture, makeCtx, startFakeServer } from './helpers.js';

it('berechnet den lokalen Tagesbeginn und filtert die Tagesdaten', async () => {
  process.env.RequestorRef = 'TEST-REF';
  expect(localDayStart('2026-10-20', 'Europe/Berlin')).toBe('2026-10-19T22:00:00.000Z');
  const server = await startFakeServer();
  try { server.setBody(fixture('stop_event_response.xml')); const env = await timetable({ stop: 'de:03152:33924', date: '2026-10-20' }, makeCtx(server.url)); expect((env.data as { departures: unknown[] }).departures.length).toBeGreaterThan(0); } finally { await server.close(); }
});

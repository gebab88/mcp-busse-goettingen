import { expect, it } from 'vitest';
import { localDayStart, timetable } from '../src/tools/timetable.js';
import { fixture, makeCtx, startFakeServer } from './helpers.js';

it('berechnet den lokalen Tagesbeginn und filtert die Tagesdaten', async () => {
  process.env.RequestorRef = 'TEST-REF';
  expect(localDayStart('2026-10-20', 'Europe/Berlin')).toBe('2026-10-19T22:00:00.000Z');
  const server = await startFakeServer();
  try { server.setBody(fixture('stop_event_response.xml')); const env = await timetable({ stop: 'de:03152:33924', date: '2026-10-20' }, makeCtx(server.url)); expect((env.data as { departures: unknown[] }).departures.length).toBeGreaterThan(0); } finally { await server.close(); }
});

it('filtert am DST-Rand nach dem lokalen Kalendertag', async () => {
  process.env.RequestorRef = 'TEST-REF';
  const server = await startFakeServer();
  try {
    server.setBody(`<?xml version="1.0" encoding="UTF-8"?>
      <trias:Trias xmlns:siri="http://www.siri.org.uk/siri" xmlns:trias="http://www.vdv.de/trias" version="1.2">
        <trias:ServiceDelivery><siri:Status>true</siri:Status><trias:DeliveryPayload><trias:StopEventResponse>
          <trias:StopEventResult><trias:StopEvent><trias:ThisCall><trias:CallAtStop><trias:StopPointRef>de:03152:33924::2</trias:StopPointRef><trias:StopPointName><trias:Text>Göttingen Grüner Weg</trias:Text></trias:StopPointName><trias:ServiceDeparture><trias:TimetabledTime>2026-10-20T21:30:00Z</trias:TimetabledTime></trias:ServiceDeparture></trias:CallAtStop></trias:ThisCall></trias:StopEvent></trias:StopEventResult>
          <trias:StopEventResult><trias:StopEvent><trias:ThisCall><trias:CallAtStop><trias:StopPointRef>de:03152:33924::2</trias:StopPointRef><trias:StopPointName><trias:Text>Göttingen Grüner Weg</trias:Text></trias:StopPointName><trias:ServiceDeparture><trias:TimetabledTime>2026-10-20T22:30:00Z</trias:TimetabledTime></trias:ServiceDeparture></trias:CallAtStop></trias:ThisCall></trias:StopEvent></trias:StopEventResult>
        </trias:StopEventResponse></trias:DeliveryPayload></trias:ServiceDelivery>
      </trias:Trias>`);
    const env = await timetable({ stop: 'de:03152:33924', date: '2026-10-20' }, makeCtx(server.url));
    const departures = (env.data as { departures: { timetabledTime: string }[] }).departures;
    expect(departures).toHaveLength(1);
    expect(departures[0]?.timetabledTime).toBe('2026-10-20T21:30:00Z');
  } finally { await server.close(); }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseLocations,
  parseStopEvents,
  parseTrips,
  parseTriasDocument,
  refPrefix,
  responseContainsRef,
} from '../src/trias/parse.js';

function fixture(name: string): string {
  return readFileSync(resolve('tests/fixtures', name), 'utf8');
}

describe('parseLocations', () => {
  it('parses many results and mixed mode cardinality', () => {
    const locations = parseLocations(fixture('location_information_response.xml'));
    expect(locations).toHaveLength(39);
    expect(locations[0]).toMatchObject({
      stopPointRef: 'de:08436:8075', name: 'Flappachbad', locality: 'Ravensburg',
      probability: expect.closeTo(0.337000012),
    });
    expect(locations.some((location) => location.modes.length > 1 && location.modes.includes('bus'))).toBe(true);
  });

  it('parses a single weak match', () => {
    const locations = parseLocations(fixture('location_weak_match.xml'));
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({ name: 'Staplack/Enervie Zentrale', probability: expect.closeTo(0.05) });
  });
});

describe('parseStopEvents', () => {
  it('parses scheduled departures', () => {
    const result = parseStopEvents(fixture('stop_event_response.xml'));
    expect(result.departures).toHaveLength(40);
    expect(result.noEventFound).toBe(false);
    expect(result.departures[0]).toMatchObject({ line: '32', destination: 'Weende-Nord', origin: 'Göttingen Kauf Park-West', timetabledTime: '2026-10-20T12:09:00Z', mode: 'bus' });
  });

  it('parses optional realtime and platform fields', () => {
    const departures = parseStopEvents(fixture('stop_event_realtime.xml')).departures;
    expect(departures.some((departure) => /^2026-10-20T/.test(departure.estimatedTime ?? ''))).toBe(true);
    expect(departures.some((departure) => departure.platform === '5')).toBe(true);
  });

  it('parses API no-event errors without throwing', () => {
    const result = parseStopEvents(fixture('error_no_event_found.xml'));
    expect(result).toMatchObject({ noEventFound: true, errorText: 'STOPEVENT_NOEVENTFOUND', departures: [] });
  });

  it('retains foreign stop response data', () => {
    expect(parseStopEvents(fixture('unknown_ref_foreign_stop.xml')).departures[0]?.stopName).toBe('Geretsried, Keplerweg');
  });
});

describe('parseTrips', () => {
  it('parses all trip legs and variants', () => {
    const journeys = parseTrips(fixture('trip_response.xml')).journeys;
    expect(journeys).toHaveLength(3);
    expect(journeys[0]).toMatchObject({ startTime: '2026-10-20T11:10:00Z', endTime: '2026-10-20T11:58:00Z', durationMinutes: 48, interchanges: 2 });
    expect(journeys[0]?.legs.map((leg) => leg.kind)).toEqual(['timed', 'interchange', 'timed', 'timed']);
    expect(journeys[0]?.legs[0]).toMatchObject({ line: 'RB85', platform: '4', origin: 'Göttingen', destination: 'Lenglern Bahnhof' });
  });
});

describe('reference safety checks', () => {
  it.each([
    ['de:03152:33924::2', 'de:03152:33924'],
    ['de:09173:4783:0:1', 'de:09173:4783'],
    ['de:03152:33924', 'de:03152:33924'],
  ])('extracts prefix', (ref, expected) => expect(refPrefix(ref)).toBe(expected));

  it('matches requested prefix despite same-number foreign refs', () => {
    const parsed = parseTriasDocument(fixture('stop_event_realtime.xml'));
    expect(responseContainsRef(parsed, 'de:03152:33817')).toBe(true);
  });
});

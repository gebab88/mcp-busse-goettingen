import { describe, it, expect } from 'vitest';
import {
  buildLocationRequest,
  buildStopEventRequest,
  buildTripRequest,
} from '../src/trias/build.js';

describe('build', () => {
  it('buildLocationRequest contains expected elements', () => {
    const xml = buildLocationRequest({
      requestorRef: 'REF-1',
      language: 'de',
      query: 'Göttingen Bahnhof',
      type: 'stop',
      maxResults: 20,
      messageId: 1,
    });
    expect(xml).toContain('<LocationInformationRequest>');
    expect(xml).toContain('<LocationName>Göttingen Bahnhof</LocationName>');
    expect(xml).toContain('<siri:RequestorRef>REF-1</siri:RequestorRef>');
    expect(xml).toContain('<NumberOfResults>20</NumberOfResults>');
  });

  it('XML escaping', () => {
    const xml = buildLocationRequest({
      requestorRef: 'REF-1',
      language: 'de',
      query: `A & B <C> "D" 'E'`,
      type: 'stop',
      maxResults: 20,
      messageId: 1,
    });
    expect(xml).toContain('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
  });

  it('RequestorRef containing XML-sensitive characters is escaped', () => {
    const xml = buildLocationRequest({
      requestorRef: `R & <X> "Y" 'Z'`,
      language: 'de',
      query: 'Göttingen Bahnhof',
      type: 'stop',
      maxResults: 20,
      messageId: 1,
    });
    expect(xml).toContain(
      '<siri:RequestorRef>R &amp; &lt;X&gt; &quot;Y&quot; &apos;Z&apos;</siri:RequestorRef>',
    );
  });

  it('buildStopEventRequest contains expected elements', () => {
    const xml = buildStopEventRequest({
      requestorRef: 'REF-1',
      language: 'de',
      stopPointRef: 'de:03152:33924',
      when: '2026-10-20T12:00:00Z',
      includeRealtime: true,
      messageId: 1,
    });
    expect(xml).toContain('<StopEventRequest>');
    expect(xml).toContain('<StopPointRef>de:03152:33924</StopPointRef>');
    expect(xml).toContain('<DepArrTime>2026-10-20T12:00:00Z</DepArrTime>');
    expect(xml).toContain('<IncludeRealtimeData>true</IncludeRealtimeData>');
  });

  it('buildTripRequest contains expected elements', () => {
    const xml = buildTripRequest({
      requestorRef: 'REF-1',
      language: 'de',
      fromRef: 'de:03152:1',
      fromName: 'A',
      toRef: 'de:03152:2',
      toName: 'B',
      when: '2026-10-20T12:00:00Z',
      maxResults: 3,
      includeRealtime: false,
      messageId: 1,
    });
    expect(xml).toContain('<TripRequest>');
    expect(xml).toContain('<StopPointRef>de:03152:1</StopPointRef>');
    expect(xml).toContain('<StopPointRef>de:03152:2</StopPointRef>');
    expect(xml).toContain('<NumberOfResults>3</NumberOfResults>');
  });
});
import { describe, it, expect } from 'vitest';
import { toLocalIso, isoToMinutes, parseDurationMinutes } from '../src/time.js';

describe('time', () => {
  it('toLocalIso Berlin before switch', () => {
    expect(toLocalIso('2026-10-20T12:01:00Z', 'Europe/Berlin')).toBe('2026-10-20T14:01:00+02:00');
  });
  it('toLocalIso Berlin summer', () => {
    expect(toLocalIso('2026-07-20T12:01:00Z', 'Europe/Berlin')).toBe('2026-07-20T14:01:00+02:00');
  });
  it('toLocalIso Berlin after switch', () => {
    expect(toLocalIso('2026-10-26T12:01:00Z', 'Europe/Berlin')).toBe('2026-10-26T13:01:00+01:00');
  });
  it('toLocalIso UTC', () => {
    expect(toLocalIso('2026-10-20T12:01:00Z', 'UTC')).toBe('2026-10-20T12:01:00+00:00');
  });
  it('toLocalIso invalid returns input', () => {
    expect(toLocalIso('not-a-date', 'Europe/Berlin')).toBe('not-a-date');
  });
  it('isoToMinutes', () => {
    expect(isoToMinutes('1970-01-01T00:01:00Z')).toBe(1);
  });
  it('parseDurationMinutes', () => {
    expect(parseDurationMinutes('PT48M')).toBe(48);
    expect(parseDurationMinutes('PT1H05M')).toBe(65);
    expect(parseDurationMinutes('PT0M')).toBe(0);
    expect(parseDurationMinutes('PT2H')).toBe(120);
    expect(parseDurationMinutes('garbage')).toBe(0);
  });
});
import { describe, it, expect } from 'vitest';
import { Quota } from '../src/quota.js';

describe('quota', () => {
  it('counts consumes', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    q.consume();
    q.consume();
    expect(q.used).toBe(2);
  });

  it('returns new count from consume', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    expect(q.consume()).toBe(1);
    expect(q.consume()).toBe(2);
  });

  it('warning undefined below threshold', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    q.consume();
    expect(q.warning()).toBeUndefined();
  });

  it('warning after 80 calls contains 80', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    for (let i = 0; i < 80; i++) q.consume();
    expect(q.warning()).toContain('80');
  });

  it('warning undefined at 79 calls', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    for (let i = 0; i < 79; i++) q.consume();
    expect(q.warning()).toBeUndefined();
  });

  it('warning text exact', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    for (let i = 0; i < 80; i++) q.consume();
    expect(q.warning()).toBe('Nach eigener Zählung: 80/100 Aufrufe heute verbraucht.');
  });

  it('resets on day change', () => {
    let now = new Date('2026-10-20T10:00:00Z');
    const q = new Quota(100, 0.8, () => now);
    q.consume();
    q.consume();
    expect(q.used).toBe(2);
    now = new Date('2026-10-21T10:00:00Z');
    expect(q.consume()).toBe(1);
    expect(q.used).toBe(1);
  });

  it('reset()', () => {
    const q = new Quota(100, 0.8, () => new Date('2026-10-20T10:00:00Z'));
    q.consume();
    q.consume();
    q.reset();
    expect(q.used).toBe(0);
  });
});
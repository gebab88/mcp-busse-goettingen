import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from '../src/cache.js';

describe('cache', () => {
  it('set/get', () => {
    const c = new TtlCache<string>(300);
    c.set('a', 'x');
    expect(c.get('a')).toBe('x');
  });

  it('unknown key undefined', () => {
    const c = new TtlCache<string>(300);
    expect(c.get('nope')).toBeUndefined();
  });

  it('expires after ttl', () => {
    vi.useFakeTimers();
    const c = new TtlCache<string>(300);
    c.set('a', 'x');
    vi.advanceTimersByTime(301_000);
    expect(c.get('a')).toBeUndefined();
    vi.useRealTimers();
  });

  it('lru eviction', () => {
    const c = new TtlCache<number>(300, 2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('clear', () => {
    const c = new TtlCache<string>(300);
    c.set('a', 'x');
    c.clear();
    expect(c.get('a')).toBeUndefined();
  });
});
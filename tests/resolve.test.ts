import { describe, expect, it } from 'vitest';
import { Resolver, selectBest } from '../src/resolve.js';
import type { ParsedLocation } from '../src/trias/parse.js';
import { TtlCache } from '../src/cache.js';
import { NotFoundError } from '../src/errors.js';
import type { ResolvedStop } from '../src/trias/types.js';

const location = (stopPointRef: string, name: string, probability: number, locality?: string): ParsedLocation => ({
  stopPointRef,
  name,
  probability,
  ...(locality === undefined ? {} : { locality }),
  modes: ['bus'],
});

describe('selectBest', () => {
  it('prefers an exact name match when probabilities are practically equal', () => {
    const result = selectBest([
      location('de:1:1', 'Göttingen Landgericht/Bahnhof', 0.2399),
      location('de:2:2', 'Göttingen Bahnhof', 0.25),
    ], 'Göttingen Bahnhof');

    expect(result?.stopPointRef).toBe('de:2:2');
  });

  it('prefers the higher probability when names are not exact matches', () => {
    const result = selectBest([
      location('de:1:1', 'Irgendetwas', 0.10),
      location('de:2:2', 'Anderes', 0.23),
    ], 'X');

    expect(result?.stopPointRef).toBe('de:2:2');
  });

  it('prefers the exact name in the intended locality', () => {
    const result = selectBest([
      location('de:1:1', 'Friedland(Kr Göttingen) Bahnhof/Ostseite', 0.105, 'Friedland (Kr GÖ)'),
      location('de:2:2', 'Göttingen Bahnhof', 0.25, 'Göttingen'),
    ], 'Göttingen Bahnhof');

    expect(result?.stopPointRef).toBe('de:2:2');
  });

  it('returns undefined for no candidates', () => {
    expect(selectBest([], 'Göttingen Bahnhof')).toBeUndefined();
  });
});

const cfg = {
  confidenceLow: 0.2,
  confidenceCertain: 0.9,
  localities: ['Göttingen'],
} as any;

function resolverWith(locationRequest: (...args: any[]) => Promise<any>) {
  return new Resolver({ locationRequest } as any, cfg, new TtlCache<ResolvedStop>(300));
}

describe('Resolver', () => {
  it('classifies probabilities and compares localities exactly', () => {
    const resolver = resolverWith(async () => ({ locations: [] }));
    expect(resolver.classify(undefined)).toBe('low');
    expect(resolver.classify(0.19)).toBe('low');
    expect(resolver.classify(0.2)).toBe('high');
    expect(resolver.classify(0.9)).toBe('certain');
    expect(resolver.isLocal('Göttingen')).toBe(true);
    expect(resolver.isLocal('Göttingen (Westf)')).toBe(false);
  });

  it('uses a stop point reference directly and caches it', async () => {
    let calls = 0;
    const resolver = resolverWith(async () => { calls += 1; return { locations: [] }; });
    const result = await resolver.resolveStop('de:03152:33817');
    expect(result.chosen).toMatchObject({ stopPointRef: 'de:03152:33817', name: 'de:03152:33817', confidence: 'low', modes: [] });
    expect(result.requested).toEqual({ stopPointRef: 'de:03152:33817' });
    expect(calls).toBe(0);
    await resolver.resolveStop('de:03152:33817');
    expect(calls).toBe(0);
  });

  it('resolves a name and excludes the chosen location from alternatives', async () => {
    const resolver = resolverWith(async (query, type, maxResults) => ({
      locations: [location('de:1:1', 'Bahnhof', 0.25, 'Göttingen'), location('de:2:2', 'Nebenbahnhof', 0.1)],
    }));
    const result = await resolver.resolveStop(' Bahnhof ');
    expect(result.query).toBe('Bahnhof');
    expect(result.chosen.stopPointRef).toBe('de:1:1');
    expect(result.chosen.confidence).toBe('high');
    expect(result.chosen.isLocal).toBe(true);
    expect(result.alternatives.map((stop) => stop.stopPointRef)).toEqual(['de:2:2']);
  });

  it('returns a low-confidence empty result without an API error code', async () => {
    const resolver = resolverWith(async () => ({ locations: [] }));
    const result = await resolver.resolveStop('Unknown');
    expect(result.chosen.name).toBe('Unknown');
    expect(result.chosen.confidence).toBe('low');
    expect(result.note).toBe('Die Schnittstelle lieferte keine Treffer.');
  });

  it('throws NotFoundError for LOCATION_NORESULTS with a quota hint', async () => {
    const resolver = resolverWith(async () => ({ locations: [], errorText: 'LOCATION_NORESULTS' }));
    await expect(resolver.resolveStop('Unknown')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Zur Eingabe "Unknown" wurde keine Haltestelle gefunden.',
      hint: expect.stringContaining('10.000'),
    });
    await expect(resolver.resolveStop('Unknown 2')).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, fixture, startFakeServer } from './helpers.js';

describe('Resolver integration', () => {
  let originalRequestorRef: string | undefined;
  let server: Awaited<ReturnType<typeof startFakeServer>>;

  beforeEach(async () => {
    originalRequestorRef = process.env.RequestorRef;
    process.env.RequestorRef = 'TEST-REF';
    server = await startFakeServer();
  });

  afterEach(async () => {
    if (originalRequestorRef === undefined) delete process.env.RequestorRef;
    else process.env.RequestorRef = originalRequestorRef;
    await server.close();
  });

  it('resolves a Göttingen location and returns alternatives', async () => {
    server.setBody(fixture('location_goettingen.xml'));
    const { resolver } = makeCtx(server.url);
    const result = await resolver.resolveStop('Göttingen Bahnhof');

    expect(result.chosen.stopPointRef).toBe('de:03152:33817');
    expect(result.chosen.name).toBe('Bahnhof');
    expect(result.chosen.locality).toBe('Göttingen');
    expect(result.chosen.isLocal).toBe(true);
    expect(result.chosen.confidence).toBe('high');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('keeps a weak match low confidence and non-local', async () => {
    server.setBody(fixture('location_weak_match.xml'));
    const { resolver } = makeCtx(server.url);
    const result = await resolver.resolveStop('XYZZYNOTAPLACE99');

    expect(result.chosen.confidence).toBe('low');
    expect(result.chosen.name).toBe('Staplack/Enervie Zentrale');
    expect(result.chosen.isLocal).toBe(false);
  });

  it('does not make an HTTP request for a stop point reference', async () => {
    const { resolver } = makeCtx(server.url);
    const result = await resolver.resolveStop('de:03152:33817');

    expect(result.chosen.stopPointRef).toBe('de:03152:33817');
    expect(server.hits()).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmptyResponseError, ParseError } from '../src/errors.js';
import { fixture, makeCtx, startFakeServer, type FakeServer } from './helpers.js';

describe('TriasClient', () => {
  let server: FakeServer;

  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => { await server.close(); });

  it('returns stop events and consumes one quota unit', async () => {
    server.setBody(fixture('stop_event_response.xml'));
    const ctx = makeCtx(server.url);
    const result = await ctx.client.stopEventRequest('de:03152:33924', '2026-10-20T12:00:00Z', false);
    expect(result.departures).toHaveLength(40);
    expect(ctx.quota.used).toBe(1);
  });

  it('classifies an empty response', async () => {
    server.setMode('empty');
    const ctx = makeCtx(server.url);
    await expect(ctx.client.stopEventRequest('de:03152:33924', 'now', false)).rejects.toThrowError(EmptyResponseError);
  });

  it('classifies a body without a Trias root', async () => {
    server.setMode('garbage');
    const ctx = makeCtx(server.url);
    await expect(ctx.client.stopEventRequest('de:03152:33924', 'now', false)).rejects.toThrowError(ParseError);
  });

  it('rejects silently substituted stop data', async () => {
    server.setBody(fixture('stop_event_response.xml'));
    const ctx = makeCtx(server.url);
    const result = await ctx.client.stopEventRequest('de:09999:33924', 'now', false);
    expect(result.containsRequestedRef).toBe(false);
  });

  it('retries HTTP 500 on the fallback and counts both attempts', async () => {
    server.setMode('http500');
    const ctx = makeCtx(server.url);
    ctx.cfg.fallbackUrl = `${server.url}?fallback`;
    await expect(ctx.client.stopEventRequest('de:03152:33924', 'now', false)).rejects.toThrowError(/HTTP 500/);
    expect(ctx.quota.used).toBe(2);
    expect(server.hits()).toBe(2);
  });

  it('does not retry an empty response', async () => {
    server.setMode('empty');
    const ctx = makeCtx(server.url);
    await expect(ctx.client.stopEventRequest('de:03152:33924', 'now', false)).rejects.toThrowError(EmptyResponseError);
    expect(server.hits()).toBe(1);
  });
});

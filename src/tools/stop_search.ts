import { NotFoundError } from '../errors.js';
import type { ToolContext, ToolEnvelope } from './common.js';
import { buildEnvelope, quotaWarning } from './common.js';

export async function stopSearch(args: { query: string; type?: string; maxResults?: number }, ctx: ToolContext): Promise<ToolEnvelope> {
  if (!args.query.trim()) {
    throw new NotFoundError('Es wurde kein Suchbegriff angegeben.', 'Bitte z. B. "Göttingen Bahnhof" angeben.');
  }
  const type = args.type ?? 'stop';
  const maxResults = Math.min(50, Math.max(1, args.maxResults ?? 20));
  const result = await ctx.client.locationRequest(args.query, type, maxResults);
  if (result.locations.length === 0 && result.errorText === 'LOCATION_NORESULTS') {
    throw new NotFoundError(`Zur Eingabe "${args.query}" wurde keine Haltestelle gefunden.`, 'Möglicherweise ist das Tageskontingent (10.000 Aufrufe/Tag) erschöpft, oder der Suchbegriff ist unbekannt.');
  }
  const stops = result.locations.map((location) => ({
    stopPointRef: location.stopPointRef,
    name: location.name,
    locality: location.locality,
    latitude: location.latitude,
    longitude: location.longitude,
    probability: location.probability,
    confidence: ctx.resolver.classify(location.probability),
    isLocal: ctx.resolver.isLocal(location.locality),
    modes: location.modes,
  }));
  const warnings: string[] = [];
  quotaWarning(ctx, warnings);
  return buildEnvelope({ stops }, { requestUrl: ctx.cfg.baseUrl, warnings });
}

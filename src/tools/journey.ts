import { toLocalIso } from '../time.js';
import type { Journey, Leg, RawJourney } from '../trias/types.js';
import type { ToolContext, ToolEnvelope } from './common.js';
import { buildEnvelope, quotaWarning } from './common.js';

function toLeg(raw: RawJourney['legs'][number], tz: string): Leg {
  return { kind: raw.kind, line: raw.line, mode: raw.mode, origin: raw.origin, destination: raw.destination, platform: raw.platform, ...(raw.departureTime ? { departureTime: raw.departureTime, departureTimeLocal: toLocalIso(raw.departureTime, tz) } : {}), ...(raw.arrivalTime ? { arrivalTime: raw.arrivalTime, arrivalTimeLocal: toLocalIso(raw.arrivalTime, tz) } : {}), durationMinutes: raw.durationMinutes, intermediateStops: raw.intermediateStops };
}

function toJourney(raw: RawJourney, tz: string): Journey {
  return { departureTime: raw.startTime, departureTimeLocal: toLocalIso(raw.startTime, tz), arrivalTime: raw.endTime, arrivalTimeLocal: toLocalIso(raw.endTime, tz), durationMinutes: raw.durationMinutes, interchanges: raw.interchanges, legs: raw.legs.map((leg) => toLeg(leg, tz)) };
}

export async function journey(args: { from: string; to: string; when?: string; maxResults?: number; includeRealtime?: boolean }, ctx: ToolContext): Promise<ToolEnvelope> {
  const resolvedFrom = await ctx.resolver.resolveStop(args.from);
  const resolvedTo = await ctx.resolver.resolveStop(args.to);
  const when = args.when ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const maxResults = Math.min(10, Math.max(1, args.maxResults ?? 3));
  const includeRealtime = args.includeRealtime ?? true;
  const response = await ctx.client.tripRequest(resolvedFrom.chosen.stopPointRef, resolvedTo.chosen.stopPointRef, when, maxResults, includeRealtime, resolvedFrom.chosen.name, resolvedTo.chosen.name);
  const warnings: string[] = [];
  quotaWarning(ctx, warnings);
  if (!response.containsRequestedRef) {
    const firstLeg = response.journeys[0]?.legs[0];
    const lastJourney = response.journeys[0];
    const lastLeg = lastJourney?.legs[lastJourney.legs.length - 1];
    const requestedFrom = resolvedFrom.chosen.stopPointRef;
    const requestedTo = resolvedTo.chosen.stopPointRef;
    if (firstLeg) {
      resolvedFrom.chosen = { ...resolvedFrom.chosen, ...(firstLeg.originStopPointRef ? { stopPointRef: firstLeg.originStopPointRef } : {}), ...(firstLeg.origin ? { name: firstLeg.origin } : {}), confidence: 'low' };
      resolvedFrom.note = `Die angefragte Haltestelle ${requestedFrom} existiert nicht; verwendet wurde ${resolvedFrom.chosen.name}.`;
      warnings.push(resolvedFrom.note);
    }
    if (lastLeg) {
      resolvedTo.chosen = { ...resolvedTo.chosen, ...(lastLeg.destinationStopPointRef ? { stopPointRef: lastLeg.destinationStopPointRef } : {}), ...(lastLeg.destination ? { name: lastLeg.destination } : {}), confidence: 'low' };
      resolvedTo.note = `Die angefragte Haltestelle ${requestedTo} existiert nicht; verwendet wurde ${resolvedTo.chosen.name}.`;
      warnings.push(resolvedTo.note);
    }
    if (!firstLeg && !lastLeg) warnings.push('Mindestens eine angefragte Haltestelle existiert nicht; die Antwort kann abweichende Haltestellen betreffen.');
  }
  if (response.notripfound) warnings.push('Für diese Verbindung wurde keine Fahrt gefunden; möglicherweise ist das Tageskontingent (10.000 Aufrufe/Tag) erschöpft.');
  return buildEnvelope({ resolvedFrom, resolvedTo, journeys: response.journeys.map((item) => toJourney(item, ctx.cfg.timezone)) }, { requestUrl: ctx.cfg.baseUrl, warnings });
}

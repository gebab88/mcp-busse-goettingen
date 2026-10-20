import type { Departure, RawDeparture } from '../trias/types.js';
import { isoToMinutes, toLocalIso } from '../time.js';
import type { ToolContext, ToolEnvelope } from './common.js';
import { buildEnvelope, mismatch, quotaWarning } from './common.js';

const WINDOW_MINUTES = 120;

function toDeparture(d: RawDeparture, tz: string): Departure {
  return {
    stopPointRef: d.stopPointRef,
    line: d.line, mode: d.mode, modeName: d.modeName, direction: d.direction,
    origin: d.origin, destination: d.destination, platform: d.platform,
    timetabledTime: d.timetabledTime,
    timetabledTimeLocal: toLocalIso(d.timetabledTime, tz),
    ...(d.estimatedTime === undefined ? {} : { estimatedTime: d.estimatedTime, estimatedTimeLocal: toLocalIso(d.estimatedTime, tz) }),
    realtime: d.estimatedTime !== undefined,
    cancelled: d.cancelled,
    tripCode: d.tripCode,
  };
}

export async function departures(args: { stop: string; when?: string; maxResults?: number; includeRealtime?: boolean }, ctx: ToolContext): Promise<ToolEnvelope> {
  const resolved = await ctx.resolver.resolveStop(args.stop);
  const when = args.when ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const maxResults = Math.min(50, Math.max(1, args.maxResults ?? 20));
  const includeRealtime = args.includeRealtime ?? true;
  const response = await ctx.client.stopEventRequest(resolved.chosen.stopPointRef, when, includeRealtime, resolved.chosen.name);
  const warnings: string[] = [];
  quotaWarning(ctx, warnings);
  mismatch(resolved, response.departures, warnings, response.containsRequestedRef, ctx.resolver);
  if (response.dateOutOfRange) warnings.push('Für den angefragten Zeitpunkt liegen keine Daten im verfügbaren Zeitraum vor.');
  const from = isoToMinutes(when);
  const filtered = response.dateOutOfRange ? [] : response.departures.filter((d) => {
    const time = isoToMinutes(d.timetabledTime);
    return Number.isNaN(time) || (time >= from && time <= from + WINDOW_MINUTES);
  });
  const converted = filtered.map((d) => toDeparture(d, ctx.cfg.timezone));
  if (converted.length > maxResults) {
    warnings.push(`Es wurden ${maxResults} von mehr Abfahrten zurückgegeben.`);
  }
  const limited = converted.slice(0, maxResults);
  return buildEnvelope({ resolved, stop: { stopPointRef: resolved.chosen.stopPointRef, name: resolved.chosen.name, locality: resolved.chosen.locality }, departures: limited }, { requestUrl: ctx.cfg.baseUrl, warnings });
}

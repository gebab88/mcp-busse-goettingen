import { ValidationError } from '../errors.js';
import { isoToMinutes, toLocalIso } from '../time.js';
import type { Departure, RawDeparture, ResolvedStop } from '../trias/types.js';
import type { ToolContext, ToolEnvelope } from './common.js';
import { buildEnvelope, quotaWarning } from './common.js';

function dateParts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

export function localDayStart(dateStr: string, tz: string): string {
  const [year, month, day] = dateParts(dateStr);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  for (let i = 0; i < 3; i += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? '0';
    const wall = Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day')), Number(value('hour')) % 24, Number(value('minute')), Number(value('second')));
    instant = target - (wall - instant);
  }
  return new Date(instant).toISOString();
}

function nextDate(date: string): string {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function toDeparture(d: RawDeparture, tz: string): Departure {
  return { stopPointRef: d.stopPointRef, line: d.line, mode: d.mode, modeName: d.modeName, direction: d.direction, origin: d.origin, destination: d.destination, platform: d.platform, timetabledTime: d.timetabledTime, timetabledTimeLocal: toLocalIso(d.timetabledTime, tz), realtime: false, cancelled: d.cancelled, tripCode: d.tripCode };
}

function mismatch(resolved: ResolvedStop, departures: RawDeparture[], warnings: string[], containsRequestedRef: boolean): void {
  if (containsRequestedRef) return;
  if (departures.length === 0) return;
  const returned = departures[0]!;
  if (!returned.stopPointRef && !returned.stopName) return;
  const requested = resolved.chosen.stopPointRef;
  resolved.chosen = { ...resolved.chosen, ...(returned.stopPointRef ? { stopPointRef: returned.stopPointRef } : {}), ...(returned.stopName ? { name: returned.stopName } : {}), confidence: 'low' };
  resolved.note = `Die angefragte Haltestelle ${requested} existiert nicht; verwendet wurde ${resolved.chosen.name}.`;
  warnings.push(`Die angefragte Haltestelle ${requested} existiert nicht; verwendet wurde ${resolved.chosen.name}.`);
}

export async function timetable(args: { stop: string; date?: string; maxResults?: number }, ctx: ToolContext): Promise<ToolEnvelope> {
  const date = args.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: ctx.cfg.timezone }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError(`Ungültiges Datum: "${date}".`, 'Erwartet wird das Format JJJJ-MM-TT, z. B. 2026-10-20.');
  const resolved = await ctx.resolver.resolveStop(args.stop);
  const start = localDayStart(date, ctx.cfg.timezone);
  const end = localDayStart(nextDate(date), ctx.cfg.timezone);
  const response = await ctx.client.stopEventRequest(resolved.chosen.stopPointRef, start, false, resolved.chosen.name);
  const warnings: string[] = [];
  quotaWarning(ctx, warnings);
  mismatch(resolved, response.departures, warnings, response.containsRequestedRef);
  if (response.dateOutOfRange) warnings.push('Für den angefragten Tag liegen keine Daten im verfügbaren Zeitraum vor.');
  if (response.noEventFound) warnings.push('Für den angefragten Tag wurden keine Abfahrten gefunden.');
  const startMin = isoToMinutes(start), endMin = isoToMinutes(end);
  const selected = response.dateOutOfRange ? [] : response.departures.filter((d) => { const time = isoToMinutes(d.timetabledTime); return !Number.isNaN(time) && time >= startMin && time < endMin; });
  const maxResults = Math.min(300, Math.max(1, args.maxResults ?? 100));
  if (selected.length > maxResults) warnings.push(`Es wurden ${maxResults} von mehr Abfahrten zurückgegeben.`);
  const converted = selected.slice(0, maxResults).map((d) => toDeparture(d, ctx.cfg.timezone));
  return buildEnvelope({ resolved, stop: { stopPointRef: resolved.chosen.stopPointRef, name: resolved.chosen.name, locality: resolved.chosen.locality }, date, departures: converted }, { requestUrl: ctx.cfg.baseUrl, warnings });
}

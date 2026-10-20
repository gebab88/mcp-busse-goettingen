import type { Config } from '../config.js';
import type { Quota } from '../quota.js';
import type { Resolver } from '../resolve.js';
import type { TriasClient } from '../trias/client.js';
import type { RawDeparture, ResolvedStop } from '../trias/types.js';

export const DISCLAIMER = 'Alle Angaben ohne Gewähr.';

export interface ToolEnvelope {
  source: 'TRIAS';
  requestUrl: string;
  retrievedAt: string;
  disclaimer: string;
  warnings: string[];
  data: unknown;
}

export interface ToolContext {
  client: TriasClient;
  resolver: Resolver;
  cfg: Config;
  quota: Quota;
}

export function buildEnvelope(data: unknown, opts: { requestUrl: string; warnings?: string[] }): ToolEnvelope {
  return {
    source: 'TRIAS',
    requestUrl: opts.requestUrl,
    retrievedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    warnings: [...(opts.warnings ?? [])],
    data,
  };
}

export function quotaWarning(ctx: ToolContext, warnings: string[]): void {
  const warning = ctx.quota.warning();
  if (warning) warnings.push(warning);
}

export function mismatch(resolved: ResolvedStop, departures: RawDeparture[], warnings: string[], containsRequestedRef: boolean): void {
  if (containsRequestedRef) return;
  if (departures.length === 0) return;
  const returned = departures[0]!;
  if (!returned.stopPointRef && !returned.stopName) return;
  const requested = resolved.chosen.stopPointRef;
  resolved.chosen = { ...resolved.chosen, ...(returned.stopPointRef ? { stopPointRef: returned.stopPointRef } : {}), ...(returned.stopName ? { name: returned.stopName } : {}), confidence: 'low' };
  resolved.note = `Die angefragte Haltestelle ${requested} existiert nicht; verwendet wurde ${resolved.chosen.name}.`;
  warnings.push(`Die angefragte Haltestelle ${requested} existiert nicht; verwendet wurde ${resolved.chosen.name}.`);
}

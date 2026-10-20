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

/**
 * Gleicht die vom Nutzer gewünschte Haltestelle mit der von der API gelieferten ab.
 *
 * Zwei Fälle:
 *  - Das Präfix passt: Die API hat die gewünschte Haltestelle geliefert. Der echte Name
 *    wird nachgetragen, falls die Eingabe eine StopPointRef war (dann kannte der Resolver
 *    den Namen noch nicht). Die Konfidenz wird auf 'high' angehoben, sofern sie nicht
 *    durch einen früheren Mismatch herabgestuft wurde.
 *  - Das Präfix passt nicht: Die API hat eine andere Haltestelle geliefert. Name, ID und
 *    Konfidenz werden auf den gelieferten Stand umgeschrieben und die Abweichung gemeldet.
 */
export function mismatch(resolved: ResolvedStop, departures: RawDeparture[], warnings: string[], containsRequestedRef: boolean, resolver?: Resolver): void {
  if (departures.length === 0) return;
  const returned = departures[0]!;
  if (!returned.stopPointRef && !returned.stopName) return;

  if (containsRequestedRef) {
    // Die gewünschte Haltestelle wurde geliefert. Fehlende Angaben aus der Antwort
    // nachtragen: Bei einer Ref-Eingabe war der Name des Resolvers nur die Ref selbst.
    const needsName = resolved.chosen.name === resolved.chosen.stopPointRef;
    if (needsName && returned.stopName) {
      resolved.chosen = resolver
        ? resolver.enrichFromDisplayName(resolved.chosen, returned.stopName)
        : { ...resolved.chosen, name: returned.stopName };
    }
    if (resolved.chosen.confidence === 'low' && resolved.note === undefined) {
      resolved.chosen = { ...resolved.chosen, confidence: 'high' };
    }
    return;
  }

  const requested = resolved.chosen.stopPointRef;
  resolved.chosen = { ...resolved.chosen, ...(returned.stopPointRef ? { stopPointRef: returned.stopPointRef } : {}), ...(returned.stopName ? { name: returned.stopName } : {}), confidence: 'low' };
  resolved.note = `Die angefragte Haltestelle ${requested} existiert nicht; verwendet wurde ${resolved.chosen.name}.`;
  warnings.push(`Die angefragte Haltestelle ${requested} existiert nicht; verwendet wurde ${resolved.chosen.name}.`);
}

import type { Config } from './config.js';
import { TtlCache } from './cache.js';
import { NotFoundError } from './errors.js';
import type { ParsedLocation } from './trias/parse.js';
import type { TriasClient } from './trias/client.js';
import type { Confidence, ResolvedStop, Stop } from './trias/types.js';

const REF_RE = /^[a-z]{2,4}:\d+:\d+/;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isExactName(candidateName: string, query: string): boolean {
  const candidate = normalize(candidateName);
  const requested = normalize(query);
  const candidateWords = candidate.split(/\W+/u).filter(Boolean);
  const requestedWords = requested.split(/\W+/u).filter(Boolean);
  return candidate === requested || (candidateWords.length === requestedWords.length && candidateWords.every((word, index) => word === requestedWords[index]));
}

function probability(location: ParsedLocation): number {
  return location.probability ?? Number.NEGATIVE_INFINITY;
}

export function selectBest(candidates: ParsedLocation[], query: string): ParsedLocation | undefined {
  const sorted = [...candidates].sort((a, b) => {
    const probabilityDelta = probability(b) - probability(a);
    if (Math.abs(probabilityDelta) >= 0.02) return probabilityDelta;

    const exactDelta = Number(isExactName(`${b.locality ?? ''} ${b.name}`, query)) - Number(isExactName(`${a.locality ?? ''} ${a.name}`, query));
    if (exactDelta !== 0) return exactDelta;
    return a.name.localeCompare(b.name, 'de');
  });
  return sorted[0];
}

export class Resolver {
  constructor(
    private readonly client: TriasClient,
    private readonly cfg: Config,
    private readonly cache: TtlCache<ResolvedStop>,
  ) {}

  classify(probabilityValue: number | undefined): Confidence {
    if (probabilityValue !== undefined && probabilityValue >= this.cfg.confidenceCertain) return 'certain';
    if (probabilityValue !== undefined && probabilityValue >= this.cfg.confidenceLow) return 'high';
    return 'low';
  }

  isLocal(locality: string | undefined): boolean {
    return !!locality && this.cfg.localities.includes(locality);
  }

  /**
   * Leitet den Ort aus einem Anzeigenamen ab, z. B. "Göttingen Grüner Weg" → "Göttingen".
   *
   * Die StopEvent-Antwort liefert nur den Anzeigenamen der Haltestelle, nicht die
   * separate Locality. Für die Kennzeichnung als lokal wird deshalb der Ortsname
   * aus dem Anzeigenamen abgeleitet.
   *
   * Die API mischt zwei Schreibweisen:
   *   "Göttingen Grüner Weg"   → Ort und Haltestelle durch Leerzeichen getrennt
   *   "Geretsried, Feuerwehrschule" → Ort und Haltestelle durch Komma getrennt
   *
   * Deshalb wird gegen die konfigurierte Ortsliste geprüft, statt die Trennstelle
   * zu raten: der längste passende Ortsname als Präfix gewinnt. Der Vergleich bleibt
   * exakt — "Göttingen (Westf)" ist ein anderer Ort und wird nicht als lokal markiert.
   */
  localityFromDisplayName(displayName: string | undefined): string | undefined {
    if (!displayName) return undefined;
    for (const locality of this.cfg.localities) {
      if (displayName === locality) return locality;
      if (displayName.startsWith(`${locality} `) || displayName.startsWith(`${locality},`)) {
        return locality;
      }
    }
    return undefined;
  }

  /** Ergänzt eine nachträglich ermittelte Haltestelle um Ort- und Konfidenzangaben. */
  enrichFromDisplayName(stop: Stop, displayName: string | undefined): Stop {
    if (!displayName) return stop;
    const locality = this.localityFromDisplayName(displayName);
    return {
      ...stop,
      ...(stop.name === stop.stopPointRef ? { name: displayName } : {}),
      ...(stop.locality === undefined && locality ? { locality } : {}),
      ...(stop.locality === undefined ? { isLocal: this.isLocal(locality) } : {}),
    };
  }

  private toStop(location: ParsedLocation): Stop {
    return {
      ...location,
      confidence: this.classify(location.probability),
      isLocal: this.isLocal(location.locality),
    };
  }

  async resolveStop(input: string): Promise<ResolvedStop> {
    const trimmed = input.trim();
    if (trimmed === '') {
      throw new NotFoundError(
        'Es wurde keine Haltestelle angegeben.',
        'Bitte einen Haltestellennamen oder eine StopPointRef angeben, z. B. "Göttingen Bahnhof" oder "de:03152:33817".',
      );
    }

    if (REF_RE.test(trimmed)) {
      const key = `ref:${trimmed}`;
      const cached = this.cache.get(key);
      if (cached) return cached;
      const result: ResolvedStop = {
        query: trimmed,
        requested: { stopPointRef: trimmed },
        chosen: { stopPointRef: trimmed, name: trimmed, confidence: 'low', isLocal: false, modes: [] },
        alternatives: [],
      };
      this.cache.set(key, result);
      return result;
    }

    const key = `name:${normalize(trimmed)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const { locations, errorText } = await this.client.locationRequest(trimmed, 'stop', 20);
    if (locations.length === 0) {
      if (errorText === 'LOCATION_NORESULTS') {
        throw new NotFoundError(
          `Zur Eingabe "${trimmed}" wurde keine Haltestelle gefunden.`,
          'Möglicherweise ist das Tageskontingent (10.000 Aufrufe/Tag) erschöpft, oder der Name ist unbekannt. Prüfe die Schreibweise oder nutze stop_search.',
        );
      }
      const result: ResolvedStop = {
        query: trimmed,
        chosen: { stopPointRef: '', name: trimmed, confidence: 'low', isLocal: false, modes: [] },
        alternatives: [],
        note: 'Die Schnittstelle lieferte keine Treffer.',
      };
      this.cache.set(key, result);
      return result;
    }

    const best = selectBest(locations, trimmed)!;
    const result: ResolvedStop = {
      query: trimmed,
      chosen: this.toStop(best),
      alternatives: locations.filter((location) => location !== best).map((location) => this.toStop(location)),
    };
    this.cache.set(key, result);
    return result;
  }
}

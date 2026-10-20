# TRIAS MCP-Server für Busse in Göttingen — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein MCP-Server, der über die TRIAS-Schnittstelle (VDV 431-2) die Fahrtzeiten der Busse in Göttingen abfragt — mit vier Tools (`stop_search`, `departures`, `journey`, `timetable`), fuzzy Haltestellen-Auflösung und strukturiertem JSON.

**Architecture:** Drei Schichten. `src/trias/` kennt die API (XML bauen, POST, XML parsen, Domänenmodell). `src/resolve.ts` löst Haltestellen-Namen *oder* -IDs fuzzy zu einer `StopPointRef` auf und meldet immer, welche Haltestelle genommen wurde. `src/tools/` formt daraus die MCP-Antworten. Jede Antwort trägt `data.resolved` (die tatsächlich verwendete Haltestelle) und `warnings[]`.

**Tech Stack:** TypeScript 5.7 (ESM, NodeNext), Node 22, `@modelcontextprotocol/sdk` 1.32, `zod` 4.6, `fast-xml-parser` 5.11, `dotenv` 18, `vitest` 5, `tsx` 4.23.

**Spec:** `docs/superpowers/specs/2026-10-20-trias-mcp-server-design.md` — der Plan argumentiert aus dem Spec; Spec und Plan gehören zusammen.

## Global Constraints

- **Node ≥ 22**, npm ≥ 10. TypeScript strict, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`, `noUncheckedIndexedAccess: true`.
- **ESM only** (`"type": "module"`). Kein `require()`, `.js`-Suffixe bei relativen Imports nicht vergessen.
- **Endpunkt:** `POST https://v4-api.efa.de/efa/trias` (Primär), Fallback `POST https://www.efa.de/efa/trias`. **Nur POST** — GET wird von einer WAF mit `403` blockiert.
- **`RequestorRef` ausschließlich aus `process.env`**, nie hardcodiert, nie geloggt. Fehlt er → `config.ts` wirft beim Start.
- **Ein Pfad für alle Operationen** — der Operationstyp (`<LocationInformationRequest>`, `<StopEventRequest>`, `<TripRequest>`) steht im XML-Body.
- **Alle Zeiten**: API-Verkehr in UTC, Ausgabe **UTC + lokal** (`Europe/Berlin`).
- **Konfidenzschwellen** (gemessen, nicht geraten): `low` < 0.20, `high` ≥ 0.20, `certain` ≥ 0.90. Konfigurierbar via `TRIAS_CONFIDENCE_LOW` / `TRIAS_CONFIDENCE_CERTAIN`.
- **Localities**: Default `GÖTTINGEN_LOCALITIES=Göttingen` — **exakter** Vergleich, kein `startsWith` („Göttingen (Westf)" ist ein anderer Ort).
- **Kein harter Fehler** bei unklarer/unbekannter Haltestelle. `NOT_FOUND` nur bei 0 Ergebnissen der API.
- **Jede** Antwort enthält `"disclaimer": "Alle Angaben ohne Gewähr."`.
- **`quota.consume()` vor jedem HTTP-Aufruf**, auch bei Fehlern und Fallback-Versuchen. Tageslimit 10.000.
- **Fehlermeldungen auf Deutsch**, ohne Stacktrace. Ausgabe an stderr, nie auf stdout (stdout ist der MCP-Kanal).
- **Keine Dependencies** außer den oben genannten. Kein Logger-Framework.
- **Dateinamen** snake_case, Verzeichnisse `src/trias/`, `src/tools/`, `tests/`, `tests/fixtures/`.
- **Fixtures sind bereits vorhanden** in `tests/fixtures/` — **nicht** neu erzeugen. Live-Nachnahme nur in Task 11.

## Review Focus

Fünf Eingabe-Klassen, die das Spec impliziert, aber kein Task in seiner Testmatrix abdeckt. Der jeweilige Test wird in dem Task ergänzt, der den Code besitzt.

1. **Haltestellen-ID existiert nicht** (`de:09999:33924`) → die API liefert 40 Ergebnisse einer *anderen* Haltestelle (Geretsried). Erwartung: kein Fehler, `resolved.chosen` nennt „Geretsried, Keplerweg", `confidence: "low"`, `warnings[]` nennt die Abweichung. → Task 8
2. **Ref-Präfix passt, Antwort enthält Fremd-Refs** (`de:03159:33817::5` neben `de:03152:33817::1`) → Erwartung: **kein** Fehler. Ein exakter Vergleich würde hier fälschlich alarmieren. → Task 5
3. **Unsinniger Name** (`XYZZYNOTAPLACE99`) → API liefert einen 5-%-Treffer statt eines Fehlers. Erwartung: `confidence: "low"`, Warnung, kein Abbruch. → Task 6
4. **Leerer Response-Body** (0 Bytes) bei HTTP 200 → Erwartung: `EMPTY_RESPONSE`, kein Parse-Crash. → Task 5
5. **Fahrt außerhalb des Datenfensters** → `STOPEVENT_DATEOUTOFRANGE`. Erwartung: **Warnung + leere Liste**, kein Fehler. → Task 8

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` | Setup |
| `src/config.ts` | Lädt `.env` + Prozess-Env, validiert, typed `Config` |
| `src/errors.ts` | Fehlerklassen + `ErrorCode`-Union + deutsche Meldungen |
| `src/quota.ts` | Tageszähler (10.000) |
| `src/cache.ts` | TTL-Cache (LRU, max 100) |
| `src/time.ts` | UTC → `Europe/Berlin`, `PT48M` → Minuten |
| `src/trias/types.ts` | Domänenmodelle |
| `src/trias/build.ts` | Baut die drei TRIAS-Request-XMLs |
| `src/trias/parse.ts` | XML → Domänenmodelle, Fehlercode-Mapping, Ref-Präfix-Prüfung |
| `src/trias/client.ts` | HTTP-POST (Primär → Fallback), Quota, Fehlerklassifikation |
| `src/resolve.ts` | Name/ID → `StopPointRef`, Auswahl, Konfidenz |
| `src/tools/common.ts` | `ToolEnvelope`, `ToolContext`, `buildEnvelope`, `DISCLAIMER` |
| `src/tools/{stop_search,departures,journey,timetable}.ts` | Die vier Tools |
| `src/index.ts` | MCP-Server, Tool-Registrierung, stdio-Transport |
| `tests/helpers.ts` | **Geteilter** Test-Server (Fixture-Server) + `makeCtx()` |
| `tests/fixtures/*.xml` | **vorhanden**, echte API-Antworten |

**Abhängigkeitsrichtung:** `tools/*` → `resolve.ts` → `trias/client.ts` → `trias/parse.ts` → `trias/types.ts`. `trias/build.ts` wird nur von `client.ts` benutzt. Kein `trias/*` importiert `tools/*`.

---

## Task 1: Projekt-Setup, Config, Fehlerklassen

**Files:** Create `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/config.ts`, `src/errors.ts`; Test `tests/config.test.ts`, `tests/errors.test.ts`

**Interfaces:**
- Produces: `loadConfig(): Config` aus `src/config.ts`
- Produces: `Config` = `{ requestorRef: string; baseUrl: string; fallbackUrl: string; timeoutMs: number; language: string; cacheTtlSeconds: number; dailyLimit: number; quotaWarnThreshold: number; confidenceLow: number; confidenceCertain: number; localities: string[]; timezone: string; userAgent: string }`
- Produces: `ErrorCode` = `'CONFIG' | 'VALIDATION' | 'HTTP' | 'EMPTY_RESPONSE' | 'PARSE' | 'API_ERROR' | 'NOT_FOUND' | 'TIMEOUT'`
- Produces: `class TriasError extends Error` mit `readonly code: ErrorCode`, `readonly hint?: string`; Subklassen `ConfigError`, `ValidationError`, `HttpError(status, body)`, `EmptyResponseError`, `ParseError(detail?)`, `ApiError(apiCode, message)`, `NotFoundError(message, hint?)`, `TimeoutError(ms)`

- [ ] **Step 1: `package.json` anlegen**

`"type": "module"`, `"engines": { "node": ">=22" }`. Scripts: `build` → `tsc -p tsconfig.json`, `test` → `vitest run`, `test:watch` → `vitest`, `dev` → `tsx src/index.ts`, `start` → `node dist/index.js`.

Dependencies (exakte Versionen): `@modelcontextprotocol/sdk` 1.32.1, `dotenv` 18.0.8, `fast-xml-parser` 5.11.2, `zod` 4.6.7.
DevDependencies: `@types/node` 26.6.5, `tsx` 4.23.15, `typescript` 5.7.3, `vitest` 5.0.5.

- [ ] **Step 2: `tsconfig.json` anlegen**

`target`/`lib` ES2023, `module`/`moduleResolution` NodeNext, `outDir` `dist`, `rootDir` `src`, `strict: true`, `noUncheckedIndexedAccess: true`, `esModuleInterop: true`, `skipLibCheck: true`, `include: ["src/**/*.ts"]`.

- [ ] **Step 3: `.gitignore` und `.env.example` anlegen**

`.gitignore`: `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`.

`.env.example` — **alle** Variablen mit Defaults, damit der Wert nie im Code steht:
```
RequestorRef=
TRIAS_BASE_URL=https://v4-api.efa.de/efa/trias
TRIAS_FALLBACK_URL=https://www.efa.de/efa/trias
TRIAS_TIMEOUT_MS=20000
TRIAS_LANGUAGE=de
TRIAS_USER_AGENT=MCP-Busse-Goettingen/0.1
TRIAS_DAILY_LIMIT=10000
TRIAS_QUOTA_WARN_THRESHOLD=0.8
TRIAS_CONFIDENCE_LOW=0.20
TRIAS_CONFIDENCE_CERTAIN=0.90
TRIAS_CACHE_TTL_SECONDS=300
GÖTTINGEN_LOCALITIES=Göttingen
TRIAS_TIMEZONE=Europe/Berlin
```

- [ ] **Step 4: Installieren und leeren Compile prüfen**

Run: `npm install && npx tsc --noEmit`
Expected: keine Ausgabe, Exit 0.

- [ ] **Step 5: Failing test für `config.ts` schreiben**

`tests/config.test.ts` — drei Fälle:
- `loadConfig()` wirft `ConfigError` mit `/RequestorRef/i` im Text, wenn `process.env.RequestorRef` leer ist (vorher löschen, danach wiederherstellen).
- `loadConfig()` mit `RequestorRef=TEST-REF` liefert exakt die Defaults aus dem Global Constraints-Block: `baseUrl` = `https://v4-api.efa.de/efa/trias`, `fallbackUrl` = `https://www.efa.de/efa/trias`, `dailyLimit` = 10000, `confidenceLow` = 0.2, `confidenceCertain` = 0.9, `localities` = `['Göttingen']`, `timezone` = `Europe/Berlin`.
- `GÖTTINGEN_LOCALITIES='Göttingen, Rosdorf'` → `localities` = `['Göttingen', 'Rosdorf']` (getrennt, getrimmt, leere Einträge entfernt).

`tests/errors.test.ts` — zwei Fälle: `new NotFoundError('x').code` === `'NOT_FOUND'`; `new ConfigError('m', 'h').hint` === `'h'`.

- [ ] **Step 6: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (Import nicht auflösbar).

- [ ] **Step 7: `src/errors.ts` implementieren**

`TriasError` mit `constructor(readonly code: ErrorCode, message: string, readonly hint?: string)`, `this.name = 'TriasError'`.

Subklassen, jeweils mit `super(code, message, hint)`:
- `ConfigError` → `'CONFIG'`
- `ValidationError` → `'VALIDATION'`
- `HttpError` → `'HTTP'`, Konstruktor `(status: number, body: string)`; Meldung `Die Schnittstelle antwortete mit HTTP ${status}.`, Hint = Body-Ausschnitt (max. 300 Zeichen), falls vorhanden
- `EmptyResponseError` → `'EMPTY_RESPONSE'`, Meldung `Die Schnittstelle hat eine leere Antwort geliefert — das deutet auf einen fehlerhaften Request hin.`
- `ParseError` → `'PARSE'`, Meldung `Die Antwort der Schnittstelle konnte nicht gelesen werden.`
- `ApiError` → `'API_ERROR'`, Konstruktor `(apiCode: string, message: string)`, Meldung `Die Schnittstelle meldet einen Fehler: ${message}`
- `NotFoundError` → `'NOT_FOUND'`
- `TimeoutError` → `'TIMEOUT'`, Konstruktor `(ms: number)`, Meldung `Die Schnittstelle hat nach ${ms} ms nicht geantwortet.`

- [ ] **Step 8: `src/config.ts` implementieren**

Lade `.env` nur, wenn die Datei existiert: `dotenv.config({ path: resolve(process.cwd(), '.env'), override: false })` — **Prozess-Env hat Vorrang**.

Regeln:
- `RequestorRef` getrimmt; leer → `ConfigError('RequestorRef fehlt.', 'Bitte in .env setzen (Vorlage: .env.example). Der Wert kommt von Connect Fahrplanauskunft GmbH.')`
- Zahlen-Variablen über einen Helfer, der bei nicht-endlicher Zahl `ConfigError` wirft: `Ungültige Zahl in der Konfiguration: "${raw}".`
- `localities`: `process.env['GÖTTINGEN_LOCALITIES'] ?? 'Göttingen'`, dann `.split(',').map(s => s.trim()).filter(Boolean)`
- Alle übrigen Defaults aus dem Global Constraints-Block.

- [ ] **Step 9: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/config.test.ts tests/errors.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git init
git add package.json tsconfig.json .gitignore .env.example src/config.ts src/errors.ts tests/config.test.ts tests/errors.test.ts
git commit -m "feat: project setup, config loading, error taxonomy"
```

---

## Task 2: Zeit-Utilities, Quota-Zähler, TTL-Cache

**Files:** Create `src/time.ts`, `src/quota.ts`, `src/cache.ts`; Test `tests/time.test.ts`, `tests/quota.test.ts`, `tests/cache.test.ts`

**Interfaces:**
- Produces: `toLocalIso(iso: string, timeZone: string): string` → `2026-10-20T13:01:00+01:00`
- Produces: `isoToMinutes(iso: string): number` → Minuten seit Epoch
- Produces: `parseDurationMinutes(iso: string): number` → `PT48M` → 48, `PT1H05M` → 65, `PT0M` → 0
- Produces: `class Quota` — `constructor(limit: number, warnThreshold: number, now?: () => Date)`, `consume(): number`, `get used(): number`, `warning(): string | undefined`, `reset(): void`
- Produces: `class TtlCache<T>` — `constructor(ttlSeconds: number, maxEntries = 100)`, `get(key: string): T | undefined`, `set(key: string, value: T): void`, `clear(): void`

- [ ] **Step 1: Failing tests für `time.ts` schreiben**

`tests/time.test.ts`:
- `toLocalIso('2026-10-20T12:01:00Z', 'Europe/Berlin')` === `'2026-10-20T14:01:00+02:00'`
  **Wichtig — die Zeitumstellung in Deutschland ist 2026 am letzten Sonntag im Oktober, also am 25.10.** Am 20.10. gilt noch **CEST (+02:00)**. Ein Test, der dort +01:00 erwartet, ist falsch.
- `toLocalIso('2026-07-20T12:01:00Z', 'Europe/Berlin')` === `'2026-07-20T14:01:00+02:00'` (Sommerzeit)
- `toLocalIso('2026-10-26T12:01:00Z', 'Europe/Berlin')` === `'2026-10-26T13:01:00+01:00'` (**nach** der Umstellung, Winterzeit)
- `toLocalIso('2026-10-20T12:01:00Z', 'UTC')` === `'2026-10-20T12:01:00+00:00'` (UTC-Zone: Offset `+00:00`, **kein** `Z`)
- `parseDurationMinutes('PT48M')` === 48, `('PT1H05M')` === 65, `('PT0M')` === 0

**Die drei Europe/Berlin-Fälle decken beide Umstellungsrichtungen ab** (vor und nach dem 25.10.2026) — damit wird ein Fehler in der Offset-Berechnung aufgedeckt, der mit nur einem Fall durchrutschen würde.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/time.test.ts` — Expected: FAIL.

- [ ] **Step 3: `src/time.ts` implementieren**

**Der entscheidende Punkt:** `new Date().getTimezoneOffset()` liefert den Offset der **System**-Zone, nicht der Ziel-Zone. Der Offset muss aus der Zielzone selbst berechnet werden:

1. `Intl.DateTimeFormat('en-CA', { timeZone, hour12: false, year, month, day, hour, minute, second })` → `formatToParts` → Felder `year`, `month`, `day`, `hour`, `minute`, `second`.
2. `asUtc = Date.UTC(year, month-1, day, hour % 24, minute, second)` — die Ortszeit als UTC interpretiert.
3. `offsetMin = Math.round((asUtc - d.getTime()) / 60000)` — Differenz in Minuten.
4. Ausgabe: `${year}-${month}-${day}T${hour}:${minute}:${second}` + Offset als `±HH:MM` (Vorzeichen aus `offsetMin >= 0`, `HH = floor(abs/60)`, `MM = abs % 60`, beide zweistellig).

Bei ungültigem Datum (`isNaN`) den Eingabestring unverändert zurückgeben.

`isoToMinutes`: `new Date(iso).getTime() / 60000`.
`parseDurationMinutes`: Regex `/^PT(?:(\d+)H)?(?:(\d+)M)?$/`; nicht passend → 0.

- [ ] **Step 4: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/time.test.ts` — Expected: PASS. **Der 20.10.-Fall erwartet 14:01 (+02:00)** — Deutschland stellt erst am 25.10.2026 auf Winterzeit um. Bei Abweichung ist die Offset-Berechnung falsch, nicht der Test.

- [ ] **Step 5: Failing test für `quota.ts` schreiben**

`tests/quota.test.ts`, mit injizierbarer Uhr `() => new Date('2026-10-20T10:00:00Z')`:
- zwei `consume()` → `used` === 2
- bei Limit 100 / Schwelle 0.8: nach 1 Aufruf `warning()` === undefined; nach 80 Aufrufen `warning()` enthält `'80'`; bei 79 Aufrufen noch undefined
- Tageswechsel: Zähler bei 2, Uhr auf den Folgetag → `consume()` → `used` === 1

`warning()`-Text: `Nach eigener Zählung: ${count}/${limit} Aufrufe heute verbraucht.` — nur wenn `count/limit >= warnThreshold`.

- [ ] **Step 6: `src/quota.ts` implementieren**

`consume()`: prüfe zuerst, ob `now().toISOString().slice(0,10)` vom gespeicherten Tag abweicht → dann Zähler und Tag zurücksetzen; dann hochzählen und den neuen Stand zurückgeben.

- [ ] **Step 7: Failing test für `cache.ts` schreiben**

`tests/cache.test.ts`:
- `set('a','x')` → `get('a')` === `'x'`
- unbekannter Key → `undefined`
- mit `vi.useFakeTimers()`: nach `vi.advanceTimersByTime(301_000)` bei TTL 300 → `get('a')` === undefined
- Overflow: `new TtlCache(300, 2)`, `set` a, b, c → `get('a')` undefined, `get('c')` === 3 (LRU: ältester wird verworfen)

- [ ] **Step 8: `src/cache.ts` implementieren**

`Map<string, { value: T; expires: number }>`. `get`: Eintrag löschen, wenn `expires <= Date.now()`, sonst Wert liefern. `set`: existierenden Key erst löschen (damit die Reihenfolge die Neuheit abbildet), dann setzen mit `expires = Date.now() + ttlSeconds * 1000`; anschließend solange `map.size > maxEntries` den **ältesten** Key (`map.keys().next()`) löschen.

- [ ] **Step 9: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/time.test.ts tests/quota.test.ts tests/cache.test.ts` — Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/time.ts src/quota.ts src/cache.ts tests/time.test.ts tests/quota.test.ts tests/cache.test.ts
git commit -m "feat: time utilities, daily quota counter, TTL cache"
```

---

## Task 3: Domänenmodelle und TRIAS-Request-Builder

**Files:** Create `src/trias/types.ts`, `src/trias/build.ts`; Test `tests/build.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Confidence` = `'low' | 'high' | 'certain'`; `Stop`; `ResolvedStop`; `Departure`; `Leg`; `Journey`; `RawDeparture`; `RawJourney`
- Produces (`build.ts`): `buildLocationRequest(req)`, `buildStopEventRequest(req)`, `buildTripRequest(req)` — je `=> string`

**`Stop`**: `{ stopPointRef: string; name: string; locality?: string; latitude?: number; longitude?: number; probability?: number; confidence: Confidence; isLocal: boolean; modes: string[] }`

**`ResolvedStop`**: `{ query: string; requested?: { stopPointRef: string }; chosen: Stop; alternatives: Stop[]; note?: string }`

**`Departure`**: `{ line?: string; mode?: string; modeName?: string; direction?: string; origin?: string; destination?: string; platform?: string; timetabledTime: string; timetabledTimeLocal: string; estimatedTime?: string; estimatedTimeLocal?: string; realtime: boolean; cancelled: boolean; tripCode?: string; stopPointRef?: string }`

**`Leg`**: `{ kind: 'timed' | 'interchange' | 'continuous'; line?: string; mode?: string; origin?: string; destination?: string; departureTime?: string; departureTimeLocal?: string; arrivalTime?: string; arrivalTimeLocal?: string; platform?: string; durationMinutes?: number; intermediateStops: { name: string; arrivalTime?: string; departureTime?: string }[] }`

**`Journey`**: `{ departureTime: string; departureTimeLocal: string; arrivalTime: string; arrivalTimeLocal: string; durationMinutes: number; interchanges: number; legs: Leg[] }`

**`RawDeparture`** (Parser-Ausgabe, vor Zeit-Umrechnung): `{ stopPointRef?: string; stopName?: string; platform?: string; timetabledTime: string; estimatedTime?: string; line?: string; mode?: string; modeName?: string; direction?: string; origin?: string; destination?: string; tripCode?: string; cancelled: boolean }`

**`RawJourney`**: `{ startTime: string; endTime: string; durationMinutes: number; interchanges: number; legs: { kind: 'timed' | 'interchange' | 'continuous'; line?: string; mode?: string; origin?: string; destination?: string; departureTime?: string; arrivalTime?: string; platform?: string; durationMinutes?: number; intermediateStops: { name: string; arrivalTime?: string; departureTime?: string }[] }[] }`

**Builder-Signaturen:**
```ts
buildLocationRequest(req: { requestorRef: string; language: string; query: string; type: string; maxResults: number; messageId: number }): string
buildStopEventRequest(req: { requestorRef: string; language: string; stopPointRef: string; locationName?: string; when: string; includeRealtime: boolean; messageId: number }): string
buildTripRequest(req: { requestorRef: string; language: string; fromRef: string; fromName?: string; toRef: string; toName?: string; when: string; maxResults: number; includeRealtime: boolean; messageId: number }): string
```

- [ ] **Step 1: `src/trias/types.ts` anlegen** — genau die oben definierten Interfaces.

- [ ] **Step 2: Failing test für `build.ts` schreiben**

`tests/build.test.ts`:
- `buildLocationRequest` enthält `<LocationInformationRequest>`, `<LocationName>Göttingen Bahnhof</LocationName>`, `<siri:RequestorRef>REF-1</siri:RequestorRef>`, `<NumberOfResults>20</NumberOfResults>`
- **XML-Escaping**: Query `'A & B <C>'` → enthält `A &amp; B &lt;C&gt;`
- `buildStopEventRequest` enthält `<StopEventRequest>`, `<StopPointRef>de:03152:33924</StopPointRef>`, `<DepArrTime>2026-10-20T12:00:00Z</DepArrTime>`, `<IncludeRealtimeData>true</IncludeRealtimeData>`
- `buildTripRequest` enthält `<TripRequest>`, beide `<StopPointRef>`-Werte, `<NumberOfResults>3</NumberOfResults>`

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/build.test.ts` — Expected: FAIL.

- [ ] **Step 4: `src/trias/build.ts` implementieren**

- `escapeXml(s)`: ersetzt `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;` (in dieser Reihenfolge).
- Gemeinsamer `header(requestorRef, language, messageId)`: XML-Deklaration, `<Trias version="1.2" xmlns="http://www.vdv.de/trias" xmlns:siri="http://www.siri.org.uk/siri">`, `<ServiceRequest>`, `<siri:RequestTimestamp>` (jetzt, ISO ohne Millisekunden), `<siri:RequestorRef>`, `<siri:MessageIdentifier>`, `<RequestPayload>`.
- Gemeinsamer `footer`: schließt `</RequestPayload></ServiceRequest></Trias>`.
- `buildLocationRequest`: `<LocationInformationRequest><InitialInput><LocationName>…</LocationName></InitialInput><Restrictions><Type>…</Type><Language>…</Language><NumberOfResults>…</NumberOfResults><IncludePtModes>true</IncludePtModes></Restrictions></LocationInformationRequest>`
- `buildStopEventRequest`: `<StopEventRequest><Location><LocationRef><StopPointRef>…</StopPointRef>` + optional `<LocationName><Text>…</Text></LocationName>` + `</LocationRef><DepArrTime>…</DepArrTime></Location><Params><IncludeRealtimeData>true|false</IncludeRealtimeData></Params></StopEventRequest>`
- `buildTripRequest`: `<TripRequest><Origin><LocationRef><StopPointRef>…</StopPointRef>` + optional `LocationName` + `</LocationRef><DepArrTime>…</DepArrTime></Origin><Destination><LocationRef>…</LocationRef></Destination><Params><NumberOfResults>…</NumberOfResults><AlgorithmType>minChanges</AlgorithmType><IncludeRealtimeData>…</IncludeRealtimeData></Params></TripRequest>`

- [ ] **Step 5: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/build.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/trias/types.ts src/trias/build.ts tests/build.test.ts
git commit -m "feat: domain models and TRIAS request builders"
```

---

## Task 4: XML-Parser — die drei Antworten lesen

**Files:** Create `src/trias/parse.ts`; Test `tests/parse.test.ts`

**Interfaces:**
- Produces: `parseLocations(xml: string): ParsedLocation[]`
- Produces: `parseStopEvents(xml: string): { departures: RawDeparture[]; errorCode?: string; errorText?: string; dateOutOfRange: boolean; noEventFound: boolean }`
- Produces: `parseTrips(xml: string): { journeys: RawJourney[]; notripfound: boolean }`
- Produces: `parseTriasDocument(xml: string): any`
- Produces: `refPrefix(ref: string): string`
- Produces: `responseContainsRef(parsed: any, prefix: string): boolean`
- Produces: `ParsedLocation` = `{ stopPointRef: string; name: string; locality?: string; latitude?: number; longitude?: number; probability?: number; modes: string[] }`

**XML-Analyse-Ergebnisse, die die Implementierung festlegen (empirisch, nicht geraten):**
- `fast-xml-parser` mit `{ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true }` → `<trias:StopPointRef>` wird zu `StopPointRef`.
- **Ein einzelnes Element wird zum Objekt, mehrere zum Array.** Deshalb überall `toArray(v)`.
- `LocationResult.Mode` ist **mal Objekt, mal Array** (13 von 39 Treffern im Fixture sind Arrays) → `toArray` zwingend.
- `LocationResult.Location.StopPoint.StopPointName` ist `{ Text, Language }` → Text über einen Helfer `text(v)` lesen: `undefined` → undefined; `string` → selbst; Objekt mit `Text` → `String(v.Text)`.
- `LocationResult.Location.LocationName` = der **Ort** (z. B. „Ravensburg", „Göttingen").
- `LocationResult.Location.GeoPosition` = `{ Longitude, Latitude }` (Strings → `Number`).
- `LocationResult.Probability` = String → `Number`.
- `StopEventResult.StopEvent.ThisCall.CallAtStop` = `{ StopPointRef, StopPointName, PlannedBay?, ServiceDeparture, StopSeqNumber }`; `ServiceDeparture` = `{ TimetabledTime, EstimatedTime? }`.
- `StopEventResult.StopEvent.Service` = `{ OperatingDayRef, JourneyRef, ServiceSection, Attribute?, OriginStopPointRef?, OriginText?, DestinationStopPointRef?, DestinationText? }`; `ServiceSection` = `{ LineRef, DirectionRef, Mode: { PtMode, BusSubmode|RailSubmode, Name? }, PublishedLineName: { Text }, OperatorRef }`.
- `TripResult.Trip` = `{ TripId, Duration ('PT48M'), StartTime, EndTime, Interchanges, TripLeg }`.
- **`TripLeg` hat drei Varianten**: `TimedLeg` (`{ LegBoard, LegAlight, Service, IntermediateCall? }`), `InterchangeLeg` (`{ InterchangeMode, LegStart, LegEnd, TimeWindowStart, TimeWindowEnd, Duration, WalkDuration, BufferTime }` — **kein** `Service`), `ContinuousLeg` (analog zu InterchangeLeg, ohne `InterchangeMode`).
- `ErrorMessage` = `{ Code: '-4030', Text: { Text: 'STOPEVENT_NOEVENTFOUND', Language } }`.

- [ ] **Step 1: Failing tests für `parse.ts` schreiben**

`tests/parse.test.ts` — Fixture-Zugriff über einen kleinen Helfer `fixture(name)`, das `tests/fixtures/<name>` liest.

`parseLocations`:
- `location_information_response.xml` → **39** Treffer
- erster Treffer: `stopPointRef` === `'de:08436:8075'`, `name` === `'Flappachbad'`, `locality` === `'Ravensburg'`, `probability` ≈ 0.337000012
- mindestens ein Treffer mit `modes.length > 1`; dessen `modes` enthält `'bus'`
- `location_weak_match.xml` → 1 Treffer, `probability` ≈ 0.05, `name` === `'Staplack/Enervie Zentrale'`

`parseStopEvents`:
- `stop_event_response.xml` → **40** `departures`, `noEventFound` === false
- erster Abfahrt: `line` === `'32'`, `destination` === `'Weende-Nord'`, `origin` === `'Göttingen Kauf Park-West'`, `timetabledTime` === `'2026-10-20T12:09:00Z'`, `mode` === `'bus'`
- `stop_event_realtime.xml` → mindestens eine Abfahrt mit `estimatedTime` (matcht `/^2026-10-20T/`) und mindestens eine mit `platform` === `'5'`
- `error_no_event_found.xml` → `noEventFound` === true, `errorText` === `'STOPEVENT_NOEVENTFOUND'`, `departures` leer
- `unknown_ref_foreign_stop.xml` → 40 `departures`, erste `stopName` === `'Geretsried, Keplerweg'`

`parseTrips`:
- `trip_response.xml` → **3** `journeys`
- erste Journey: `startTime` === `'2026-10-20T11:10:00Z'`, `endTime` === `'2026-10-20T11:58:00Z'`, `durationMinutes` === 48, `interchanges` === 2
- `legs.map(l => l.kind)` === `['timed', 'interchange', 'timed', 'timed']`
- erstes `timed`-Leg: `line` === `'RB85'`, `platform` === `'4'`, `origin` === `'Göttingen'`, `destination` === `'Lenglern Bahnhof'`

`refPrefix`:
- `'de:03152:33924::2'` → `'de:03152:33924'`
- `'de:09173:4783:0:1'` → `'de:09173:4783'`
- `'de:03152:33924'` → `'de:03152:33924'`

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/parse.test.ts` — Expected: FAIL.

- [ ] **Step 3: `src/trias/parse.ts` implementieren**

- `toArray<T>(v: T | T[] | undefined): T[]` — undefined → `[]`, Array → selbst, sonst `[v]`.
- `text(v)` — siehe oben.
- `deliveryBody(doc)` → `doc?.Trias?.ServiceDelivery?.DeliveryPayload ?? {}`.
- `parseLocations`: `body.LocationInformationResponse` → `toArray(resp.LocationResult)` → je Eintrag `r.Location.StopPoint` (`StopPointRef`, `StopPointName`), `r.Location.LocationName`, `r.Location.GeoPosition` (`Longitude`, `Latitude`), `r.Probability`, `r.Mode` → `toArray(r.Mode).map(m => m?.PtMode)`.
  **`name`**: `text(sp.StopPointName) ?? String(sp.StopPointRef ?? '')` — fällt zurück auf die Ref, wenn kein Name da ist.
- `parseStopEvents`: `body.StopEventResponse` → `ErrorMessage` auswerten (`errorCode` = `Code`, `errorText` = `text(err.Text)`), `dateOutOfRange` = `errorText === 'STOPEVENT_DATEOUTOFRANGE'`, `noEventFound` = `errorText === 'STOPEVENT_NOEVENTFOUND'`. Je `StopEventResult`: `StopEvent.ThisCall.CallAtStop` (`StopPointRef`, `StopPointName`, `PlannedBay` → `text()`, `ServiceDeparture.TimetabledTime`, `ServiceDeparture.EstimatedTime`), `StopEvent.Service` (`JourneyRef`, `ServiceSection.PublishedLineName` → `text()`, `ServiceSection.DirectionRef`, `ServiceSection.Mode.PtMode`, `ServiceSection.Mode.Name` → `text()`, `OriginText`/`DestinationText` → `text()`).
  `cancelled`: `Service.Cancellation === 'true' || CallAtStop.Cancellation === 'true'`.
  **Wenn `StopEventResponse` fehlt**: `{ departures: [], dateOutOfRange: false, noEventFound: false }`.
- `parseTrips`: `body.TripResponse` → `ErrorMessage` → `notripfound` = `errorText === 'TRIP_NOTRIPFOUND'`. Je `TripResult`: `Trip.StartTime`, `Trip.EndTime`, `Trip.Duration` → Minuten (lokaler Regex-Helfer `durMinutes`, **kein** Import aus `time.ts`, um Kreisabhängigkeiten zu vermeiden), `Trip.Interchanges` → `Number`. `Trip.TripLeg` → `toArray`, je Bein:
  - `InterchangeLeg` vorhanden → `kind: 'interchange'`, `origin` = `text(il.LegStart.LocationName)`, `destination` = `text(il.LegEnd.LocationName)`, `departureTime` = `il.TimeWindowStart`, `arrivalTime` = `il.TimeWindowEnd`, `durationMinutes` = `durMinutes(il.Duration)`, `intermediateStops: []`
  - `ContinuousLeg` vorhanden → `kind: 'continuous'`, gleiche Felder
  - sonst `TimedLeg` → `kind: 'timed'`, `line` = `text(Service.ServiceSection.PublishedLineName)`, `mode` = `Service.ServiceSection.Mode.PtMode`, `origin` = `text(LegBoard.StopPointName)`, `destination` = `text(LegAlight.StopPointName)`, `departureTime` = `LegBoard.ServiceDeparture.TimetabledTime`, `arrivalTime` = `LegAlight.ServiceArrival.TimetabledTime`, `platform` = `text(LegBoard.PlannedBay)`, `intermediateStops` = `toArray(tl.IntermediateCall).map(ic => ({ name: text(ic.StopPointName) ?? '', arrivalTime: ic.ServiceArrival?.TimetabledTime, departureTime: ic.ServiceDeparture?.TimetabledTime }))`
- `refPrefix(ref)`: Regex `/^([a-z]{2,4}:\d+:\d+)/` → Treffer[1], sonst `ref` selbst.
- `responseContainsRef(parsed, prefix)`: **die Kernprüfung aus Spec 4.9.1.** Kandidaten-Refs sammeln aus:
  - `StopEventResponse.StopEventResult[]` → `StopEvent.ThisCall.CallAtStop.StopPointRef`, `StopEvent.Service.OriginStopPointRef`, `StopEvent.Service.DestinationStopPointRef`
  - `TripResponse.TripResult[]` → `Trip.TripLeg[]` → `TimedLeg.LegBoard.StopPointRef`, `TimedLeg.LegAlight.StopPointRef`, `TimedLeg.Service.OriginStopPointRef`, `TimedLeg.Service.DestinationStopPointRef`, `InterchangeLeg.LegStart.StopPointRef`, `InterchangeLeg.LegEnd.StopPointRef`
  Ergebnis: `true`, wenn **irgendeine** gesammelte Ref nach `refPrefix` dem gesuchten `prefix` entspricht.

- [ ] **Step 4: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/parse.test.ts` — Expected: PASS. **Falls „39 Treffer" fehlschlägt:** `LocationResult` muss über `toArray` normalisiert werden (39 → Array, 1 → Objekt).

- [ ] **Step 5: Review-Focus-Punkt 2 als Test festnageln (Fremd-Refs bei gültigem Präfix)**

Ergänze in `tests/parse.test.ts`:
```ts
it('erkennt die angefragte Ref auch trotz fremder Refs mit gleicher Nummer', () => {
  // de:03152:33817::1 (gültig) und de:03159:33817::5 (anderer Ort, gleiche Nummer)
  const parsed = parseTriasDocument(fixture('stop_event_realtime.xml'));
  expect(responseContainsRef(parsed, 'de:03152:33817')).toBe(true);
});
```
Erwartung: **PASS**. Wenn der Test fehlschlägt, ist der Vergleich zu strikt (exakt statt Präfix).

- [ ] **Step 6: Commit**

```bash
git add src/trias/parse.ts tests/parse.test.ts
git commit -m "feat: TRIAS XML parser for locations, stop events and trips"
```

---

## Task 5: HTTP-Client mit Fallback, Quota und Fehlerklassifikation

**Files:** Create `src/trias/client.ts`; Test `tests/client.test.ts`

**Interfaces:**
- Produces: `class TriasClient` — `constructor(cfg: Config, quota: Quota)`
  - `locationRequest(query: string, type: string, maxResults: number): Promise<{ locations: ParsedLocation[]; errorText?: string }>`
  - `stopEventRequest(stopPointRef: string, when: string, includeRealtime: boolean, locationName?: string): Promise<{ departures: RawDeparture[]; errorCode?: string; errorText?: string; dateOutOfRange: boolean; noEventFound: boolean; containsRequestedRef: boolean }>`
  - `tripRequest(fromRef: string, toRef: string, when: string, maxResults: number, includeRealtime: boolean, fromName?: string, toName?: string): Promise<{ journeys: RawJourney[]; notripfound: boolean; errorText?: string; containsRequestedRef: boolean }>`
- Consumes: `buildLocationRequest`/`buildStopEventRequest`/`buildTripRequest` (Task 3), `parseLocations`/`parseStopEvents`/`parseTrips`/`parseTriasDocument`/`responseContainsRef`/`refPrefix` (Task 4), `Quota` (Task 2), `Config` (Task 1)

**Verhalten:**
- **Reihenfolge:** Primär-URL → bei Netzwerkfehler/5xx/Timeout → Fallback-URL. **Beide** Versuche belasten die Quota.
- **Fehlerklassifikation:** HTTP ≠ 200 → `HttpError`; leerer Body → `EmptyResponseError`; Body ohne `Trias`-Wurzelelement → `ParseError`; Timeout → `TimeoutError`.
- **`siri:Status` ist immer `true`** und wird **nicht** als Fehlerkriterium verwendet (Spec 4.8.1). Fehler stecken in `<trias:ErrorMessage>` und werden an den Aufrufer durchgereicht, **nicht** geworfen.
- `containsRequestedRef`: für `stopEventRequest` gegen das Präfix der angefragten Ref; für `tripRequest` gegen **beide** Präfixe (`every`).

- [ ] **Step 1: `tests/helpers.ts` anlegen (geteilter Fixture-Server)**

```ts
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TriasClient } from '../src/trias/client.js';
import { Resolver } from '../src/resolve.js';
import { TtlCache } from '../src/cache.js';
import { Quota } from '../src/quota.js';
import { loadConfig, type Config } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (n: string): string => readFileSync(join(here, 'fixtures', n), 'utf8');

export interface FakeServer {
  url: string;
  setBody: (b: string) => void;
  setMode: (m: 'ok' | 'empty' | 'http500' | 'garbage') => void;
  hits: () => number;
  close: () => Promise<void>;
}

export async function startFakeServer(): Promise<FakeServer> {
  let body = '';
  let mode: 'ok' | 'empty' | 'http500' | 'garbage' = 'ok';
  let hits = 0;
  const server: Server = createServer((_req, res) => {
    hits += 1;
    if (mode === 'http500') { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(mode === 'empty' ? '' : mode === 'garbage' ? 'kein xml <<<' : body);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/trias`,
    setBody: b => { body = b; },
    setMode: m => { mode = m; },
    hits: () => hits,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}

export function makeCtx(url: string, quota = new Quota(10000, 0.8)) {
  const cfg: Config = { ...loadConfig(), baseUrl: url, fallbackUrl: url };
  const client = new TriasClient(cfg, quota);
  return { client, resolver: new Resolver(client, cfg, new TtlCache(300)), cfg, quota };
}
```

- [ ] **Step 2: Failing test für `client.ts` schreiben**

`tests/client.test.ts` — nutzt `startFakeServer()`:
- Antwortet der Server mit `stop_event_response.xml`, liefert `stopEventRequest('de:03152:33924', …)` **40** departures, und `quota.used` === 1
- Modus `empty` → `rejects.toThrowError(/leere Antwort/i)`
- Modus `garbage` → `rejects.toThrowError(/konnte nicht gelesen werden/i)`
- `stopEventRequest('de:09999:33924', …)` gegen `stop_event_response.xml` → `containsRequestedRef` === **false**

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/client.test.ts` — Expected: FAIL.

- [ ] **Step 4: `src/trias/client.ts` implementieren**

- `messageId`-Zähler im Client, `nextMessageId()` liefert `++this.messageId` (an den Builder übergeben).
- `private async post(url, xml): Promise<string>`
  - `this.quota.consume()` **zuerst** — zählt auch Fehlversuche
  - `fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Accept': 'text/xml' }, body: xml, signal })` mit `AbortController` und `setTimeout(…, this.cfg.timeoutMs)`
  - `!res.ok` → `throw new HttpError(res.status, (await res.text().catch(() => '')).slice(0, 300))`
  - Body trimmen; leer → `throw new EmptyResponseError()`
  - Body enthält weder `<trias:Trias` noch `<Trias` → `throw new ParseError('Kein Trias-Wurzelelement.')`
  - `catch`: `e.name === 'AbortError'` → `throw new TimeoutError(this.cfg.timeoutMs)`; sonst weiterwerfen
  - `finally`: `clearTimeout(timer)`
- `private async postWithFallback(xml)`: `try` Primär; im `catch` ist der Fehler **retryable**, wenn `e instanceof HttpError && e.status >= 500` **oder** `e instanceof TimeoutError`; wenn nicht retryable **oder** `fallbackUrl === baseUrl` → weiterwerfen; sonst Fallback. **Beide** Versuche haben bereits `quota.consume()` aufgerufen.
- `locationRequest`: XML bauen, `postWithFallback`, `parseTriasDocument` für `errorText` (`DeliveryPayload.LocationInformationResponse.ErrorMessage.Text.Text`), `parseLocations` für die Liste.
- `stopEventRequest`: XML bauen, `postWithFallback`, `parseStopEvents` + `containsRequestedRef: responseContainsRef(doc, refPrefix(stopPointRef))`.
- `tripRequest`: XML bauen, `postWithFallback`, `parseTrips` + `containsRequestedRef`: `refPrefix(fromRef)` **und** `refPrefix(toRef)` müssen beide im Dokument vorkommen (`every`).

- [ ] **Step 5: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/client.test.ts` — Expected: PASS.

- [ ] **Step 6: Fallback-Test ergänzen (zählt beide Versuche)**

Ergänze in `tests/client.test.ts`: Server im Modus `http500` → `stopEventRequest` wirft; `quota.used` === **2** (Primär + Fallback). Zusatzlich prüfen, dass bei Modus `empty` **kein** Fallback versucht wird (ein leerer Body ist kein Serverfehler) → `hits()` === 1.

- [ ] **Step 7: Commit**

```bash
git add src/trias/client.ts tests/helpers.ts tests/client.test.ts
git commit -m "feat: TRIAS HTTP client with fallback, quota accounting and error classification"
```

---

## Task 6: Haltestellen-Auflösung (fuzzy) — Kernstück

**Files:** Create `src/resolve.ts`; Test `tests/resolve.test.ts`, `tests/resolve.integration.test.ts`

**Interfaces:**
- Produces: `class Resolver` — `constructor(client: TriasClient, cfg: Config, cache: TtlCache<ResolvedStop>)`
  - `resolveStop(input: string): Promise<ResolvedStop>`
  - `classify(probability: number | undefined): Confidence`
  - `isLocal(locality: string | undefined): boolean`
- Produces: `selectBest(candidates: ParsedLocation[], query: string): ParsedLocation | undefined`

**Regeln (Spec 4.5, alle empirisch belegt):**
1. Ist `input` eine StopPointRef (`/^[a-z]{2,4}:\d+:\d+/`), wird sie **direkt** verwendet — **kein** Suchaufruf, **keine** Formatprüfung. Die Verifikation erfolgt später über den Präfix-Vergleich in der Antwort.
2. Sonst: `client.locationRequest(input, 'stop', 20)` → Kandidaten.
3. **Auswahl** (`selectBest`): primär `probability` absteigend; bei Δ < 0.02 gewinnt der **exakte Namens-Treffer**; dann alphabetisch.
   „Exakter Namens-Treffer": normalisierte Namen (lowercase, Leerraum zusammengezogen) sind identisch **oder** haben dieselbe Wortliste in derselben Reihenfolge.
4. **Konfidenz** (`classify`): `probability >= cfg.confidenceCertain` → `'certain'`; `>= cfg.confidenceLow` → `'high'`; sonst `'low'`. `undefined` → `'low'`.
5. **Kein Fehler** bei 0 Kandidaten: nur wenn die API `LOCATION_NORESULTS` meldet → `NotFoundError` (mit Kontingent-Hinweis). Sonst leere `ResolvedStop` mit `confidence: 'low'` und `note`.
6. `isLocal`: **exakter** Vergleich `cfg.localities.includes(locality)` — **kein** `startsWith` („Göttingen (Westf)" ist ein anderer Ort).
7. **Cache**: Key `ref:<id>` für IDs, `name:<normalisiert>` für Namen. `ResolvedStop` wird gecacht.

- [ ] **Step 1: Failing tests für `selectBest` schreiben**

`tests/resolve.test.ts` — Kandidaten als `{ stopPointRef, name, locality, probability, modes }`:
- Bevorzugt den exakten Namens-Treffer bei praktisch gleichem probability: Kandidaten `('de:1:1', 'Göttingen Landgericht/Bahnhof', 0.2399)` und `('de:2:2', 'Göttingen Bahnhof', 0.25)`, Query `'Göttingen Bahnhof'` → gewählt wird `de:2:2`
- Bevorzugt den höheren probability, wenn die Namen gleichwertig sind: `('de:1:1','Irgendetwas',0.10)` vs `('de:2:2','Anderes',0.23)`, Query `'X'` → `de:2:2`
- Bevorzugt den Treffer aus dem gemeinten Ort: `('de:1:1','Friedland(Kr Göttingen) Bahnhof/Ostseite',0.105,'Friedland (Kr GÖ)')` vs `('de:2:2','Göttingen Bahnhof',0.25,'Göttingen')`, Query `'Göttingen Bahnhof'` → `de:2:2`
- Leere Kandidatenliste → `undefined`

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/resolve.test.ts` — Expected: FAIL.

- [ ] **Step 3: `src/resolve.ts` implementieren**

- `REF_RE = /^[a-z]{2,4}:\d+:\d+/`
- `normalize(s)` → `s.toLowerCase().replace(/\s+/g, ' ').trim()`
- `isExactName(candidateName, query)` → normalisiert identisch **oder** gleiche Wortliste in gleicher Reihenfolge
- `selectBest(candidates, query)` → sortiert eine **Kopie**: zuerst `probability` absteigend, aber nur wenn `|pa - pb| >= 0.02`; bei kleinerem Delta zuerst `isExactName` (true zuerst), dann `localeCompare(b.name, 'de')`. Rückgabe `sorted[0]`
- `class Resolver`:
  - `classify(probability)`: Schwellen aus `this.cfg` wie in Regel 4
  - `isLocal(locality)`: `!!locality && this.cfg.localities.includes(locality)`
  - `private toStop(loc: ParsedLocation): Stop` — setzt `confidence` via `classify` und `isLocal` via `isLocal`
  - `resolveStop(input)`:
    - `input.trim()` leer → `NotFoundError('Es wurde keine Haltestelle angegeben.', 'Bitte einen Haltestellennamen oder eine StopPointRef angeben, z. B. "Göttingen Bahnhof" oder "de:03152:33817".')`
    - `REF_RE.test(trimmed)` → Cache-Key `ref:${trimmed}`; sonst direkt eine `ResolvedStop` bauen: `chosen` = `{ stopPointRef: trimmed, name: trimmed, confidence: 'low', isLocal: false, modes: [] }`, `alternatives: []`, `query: trimmed`; cachen und zurückgeben
    - sonst Cache-Key `name:${normalize(trimmed)}`
    - `const { locations, errorText } = await this.client.locationRequest(trimmed, 'stop', 20)`
    - `locations.length === 0`:
      - `errorText === 'LOCATION_NORESULTS'` → `NotFoundError(\`Zur Eingabe "${trimmed}" wurde keine Haltestelle gefunden.\`, 'Möglicherweise ist das Tageskontingent (10.000 Aufrufe/Tag) erschöpft, oder der Name ist unbekannt. Prüfe die Schreibweise oder nutze stop_search.')`
      - sonst leere `ResolvedStop` mit `chosen.name = trimmed`, `confidence: 'low'`, `note: 'Die Schnittstelle lieferte keine Treffer.'` — cachen und zurückgeben
    - `best = selectBest(locations, trimmed)!`; `alternatives` = alle anderen Kandidaten, über `toStop` gemappt
    - `ResolvedStop` = `{ query: trimmed, chosen: toStop(best), alternatives }`; cachen und zurückgeben

- [ ] **Step 4: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/resolve.test.ts` — Expected: PASS.

- [ ] **Step 5: Integrationstest gegen den Fake-Server (Review-Focus-Punkt 3)**

`tests/resolve.integration.test.ts` — nutzt `startFakeServer()` und `makeCtx()`:
- Server liefert `location_goettingen.xml` → `resolveStop('Göttingen Bahnhof')`:
  - `chosen.stopPointRef` === `'de:03152:33817'`
  - `chosen.name` === `'Bahnhof'`
  - `chosen.locality` === `'Göttingen'`
  - `chosen.isLocal` === true
  - `chosen.confidence` === `'high'` (probability 0.25)
  - `alternatives.length` > 0
- Server liefert `location_weak_match.xml` → `resolveStop('XYZZYNOTAPLACE99')`:
  - `chosen.confidence` === `'low'`
  - `chosen.name` === `'Staplack/Enervie Zentrale'`
  - `chosen.isLocal` === false
- `resolveStop('de:03152:33817')` → `chosen.stopPointRef` === `'de:03152:33817'` **und** der Fake-Server wurde **nicht** angefragt (kein HTTP-Request)

- [ ] **Step 6: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/resolve.test.ts tests/resolve.integration.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/resolve.ts tests/resolve.test.ts tests/resolve.integration.test.ts
git commit -m "feat: fuzzy stop resolution with probability-based confidence"
```

---

## Task 7: Tool `stop_search` und gemeinsame Antwort-Hülle

**Files:** Create `src/tools/common.ts`, `src/tools/stop_search.ts`; Test `tests/stop_search.test.ts`

**Interfaces:**
- Produces (`common.ts`): `DISCLAIMER = 'Alle Angaben ohne Gewähr.'`; `ToolEnvelope` = `{ source: 'TRIAS'; requestUrl: string; retrievedAt: string; disclaimer: string; warnings: string[]; data: unknown }`; `ToolContext` = `{ client: TriasClient; resolver: Resolver; cfg: Config; quota: Quota }`; `buildEnvelope(data: unknown, opts: { requestUrl: string; warnings?: string[] }): ToolEnvelope`
- Produces (`stop_search.ts`): `stopSearch(args: { query: string; type?: string; maxResults?: number }, ctx: ToolContext): Promise<ToolEnvelope>`

**Verhalten:**
- `query` leer → `NotFoundError('Es wurde kein Suchbegriff angegeben.', 'Bitte z. B. "Göttingen Bahnhof" angeben.')`
- `type` Default `'stop'`; `maxResults` Default 20, begrenzt auf 1..50
- `client.locationRequest(query, type, maxResults)` → `locations`
- 0 Treffer **und** `errorText === 'LOCATION_NORESULTS'` → `NotFoundError` mit Kontingent-Hinweis
- Ergebnis: `data.stops` = je Kandidat `{ stopPointRef, name, locality, latitude, longitude, probability, confidence, isLocal, modes }` — **`confidence` und `isLocal` kommen aus dem `Resolver`** (`ctx.resolver.classify`, `ctx.resolver.isLocal`)
- `warnings`: `ctx.quota.warning()` falls vorhanden

- [ ] **Step 1: `src/tools/common.ts` anlegen** — genau die oben definierten Typen. `buildEnvelope` setzt `source: 'TRIAS'`, `requestUrl: opts.requestUrl`, `retrievedAt: new Date().toISOString()`, `disclaimer: DISCLAIMER`, `warnings: [...(opts.warnings ?? [])]`, `data`.

- [ ] **Step 2: Failing test für `stop_search` schreiben**

`tests/stop_search.test.ts` — Fake-Server liefert `location_goettingen.xml`:
- `env.source` === `'TRIAS'`
- `env.disclaimer` === `'Alle Angaben ohne Gewähr.'`
- `env.warnings` === `[]`
- `env.data.stops.length` > 0
- `env.data.stops[0].stopPointRef` === `'de:03152:33817'`
- `env.data.stops[0].isLocal` === true

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/stop_search.test.ts` — Expected: FAIL.

- [ ] **Step 4: `src/tools/stop_search.ts` implementieren** — nach der Verhaltensliste oben. Die Stop-Objekte aus `ParsedLocation` übernehmen: `stopPointRef`, `name`, `locality`, `latitude`, `longitude`, `probability` direkt; `confidence` = `ctx.resolver.classify(l.probability)`; `isLocal` = `ctx.resolver.isLocal(l.locality)`; `modes` = `l.modes`.

- [ ] **Step 5: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/stop_search.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/common.ts src/tools/stop_search.ts tests/stop_search.test.ts
git commit -m "feat: stop_search tool with response envelope and disclaimer"
```

---

## Task 8: Tools `departures` und `timetable`

**Files:** Create `src/tools/departures.ts`, `src/tools/timetable.ts`; Test `tests/departures.test.ts`, `tests/timetable.test.ts`

**Interfaces:**
- Produces: `departures(args: { stop: string; when?: string; maxResults?: number; includeRealtime?: boolean }, ctx: ToolContext): Promise<ToolEnvelope>`
- Produces: `timetable(args: { stop: string; date?: string }, ctx: ToolContext): Promise<ToolEnvelope>`
- Beide nutzen `ctx.resolver.resolveStop(input)` und `ctx.client.stopEventRequest(...)`

**`departures`:**
- Fenster **120 Minuten** ab `when` (Default: jetzt, ISO ohne Millisekunden). `maxResults` Default 20 (max 50), `includeRealtime` Default true.
- Die API liefert 40 Treffer ab `when`; der Server filtert **zusätzlich** auf `when <= zeit <= when + 120min`.
- **Präfix-Mismatch** (`containsRequestedRef === false`) → **kein Fehler**: `resolved.chosen` wird auf die gelieferte Haltestelle umgeschrieben (`stopPointRef`, `name` aus `departures[0]`), `confidence: 'low'`; `resolved.note` und eine `warnings[]`-Zeile nennen die Abweichung.
- `dateOutOfRange` → **Warnung + leere Liste**, kein Fehler.
- `data` = `{ resolved, stop: { stopPointRef, name, locality }, departures }`

**`timetable`:**
- `date` Default: heute in `cfg.timezone`, Format `JJJJ-MM-TT` (`Intl.DateTimeFormat('en-CA', { timeZone })`).
- `date` ungültiges Format → `ValidationError(\`Ungültiges Datum: "${date}".\`, 'Erwartet wird das Format JJJJ-MM-TT, z. B. 2026-10-20.')`
- `includeRealtime` **immer false**. `DepArrTime` = Beginn des **lokalen** Tages (UTC-ISO).
- Filter auf den gewünschten lokalen Kalendertag. `data` = `{ resolved, stop, date, departures }`
- `maxResults` Default 100 (max 300) — wird gekürzt, mit `warnings[]`-Notiz.

**Umrechnung UTC → lokale Tagesbeginn:** `localDayStart(dateStr, tz): string` — der Beginn des lokalen Tages, als UTC-ISO. Ansatz: `Date.UTC(y, m-1, d, 0, 0, 0)` als Ziel, dann in **drei** Iterationen den Offset der Zone bestimmen und korrigieren (analog zur Offset-Berechnung in `toLocalIso`, Task 2). Für `Europe/Berlin` ist der lokale Tagesbeginn 22:00/23:00 UTC des Vortags.

**Das Tagesende** ist `localDayStart(des Folgetags)` — **nicht** `dayStart + 24*60`. Der Unterschied ist eine Stunde an den Tagen mit Zeitumstellung (Oktober 2026: der 25.10. hat 25 Stunden, der 20.10. hat 24). Berechne das Folgetag-`dateStr` durch Addition eines Tages auf dem Kalenderfeld (`new Date(Date.UTC(y, m-1, d+1))` → `JJJJ-MM-TT`) und rufe `localDayStart` erneut auf.

- [ ] **Step 1: Failing test für `departures` schreiben**

`tests/departures.test.ts` — Fake-Server:
- liefert `stop_event_realtime.xml` → `departures({ stop: 'de:03152:33817', when: '2026-10-20T11:00:00Z' })`:
  - `env.data.departures.length` > 0
  - `departures[0].timetabledTime` passt auf `/Z$/`
  - `departures[0].timetabledTimeLocal` passt auf `/[+-]\d{2}:\d{2}$/`
- liefert `unknown_ref_foreign_stop.xml` → `departures({ stop: 'de:09999:33924', when: '2026-10-20T11:00:00Z' })` (**Review-Focus 1**):
  - `env.data.resolved.chosen.name` === `'Geretsried, Keplerweg'`
  - `env.data.resolved.chosen.confidence` === `'low'`
  - `env.warnings.join(' ')` passt auf `/existiert nicht/i`
  - **kein** Fehler

- [ ] **Step 2: Failing test für `timetable` schreiben**

`tests/timetable.test.ts` — Fake-Server:
- liefert `stop_event_response.xml` → `timetable({ stop: 'de:03152:33924', date: '2026-10-20' })`:
  - `env.data.date` === `'2026-10-20'`
  - `env.data.departures.length` > 0
  - **Alle** Abfahrten liegen im **lokalen** Kalendertag `2026-10-20` (Europe/Berlin). Die Abfahrten des Fixtures liegen zwischen `12:09Z` und `14:35Z` — das sind **14:09 bis 15:35 Ortszeit**, also alle am 20.10. Der Filter darf eine Abfahrt um `22:30Z` (= 23:30 Ortszeit am 20.10.) **nicht** verlieren, darf eine um `21:30Z` (= 23:30 Ortszeit am 19.10.) aber **nicht** mitnehmen.
  - Prüfe das über die Zeitangaben, nicht über den UTC-Datum-Präfix: `departures.every(d => d.timetabledTimeLocal.startsWith('2026-10-20'))`
- liefert `error_no_event_found.xml` → `timetable({ stop: 'de:03152:33924', date: '2027-07-15' })` (**Review-Focus 5**):
  - `env.data.departures` ist **leer**
  - `env.warnings.length` > 0
  - **kein** Fehler

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run tests/departures.test.ts tests/timetable.test.ts` — Expected: FAIL.

- [ ] **Step 4: `src/tools/departures.ts` implementieren**

- `const WINDOW_MINUTES = 120`
- `toDeparture(d: RawDeparture, tz: string): Departure` — `timetabledTime`/`estimatedTime` durchreichen, `timetabledTimeLocal` = `toLocalIso(d.timetabledTime, tz)`, `estimatedTimeLocal` = `toLocalIso(d.estimatedTime, tz)` **nur wenn** `estimatedTime` vorhanden, `realtime: d.estimatedTime !== undefined`, `cancelled: d.cancelled`
- `resolveStop(args.stop)` → `client.stopEventRequest(resolved.chosen.stopPointRef, when, includeRealtime, resolved.chosen.name)`
- Mismatch-Behandlung und `dateOutOfRange`-Warnung wie oben
- Filtern: `isoToMinutes(d.timetabledTime)` zwischen `from` und `from + 120`; bei `NaN` **beibehalten** (nicht wegfiltern)
- Kürzen auf `maxResults` mit `warnings.push(\`Es wurden ${maxResults} von mehr Abfahrten zurückgegeben.\`)`

- [ ] **Step 5: `src/tools/timetable.ts` implementieren**

- `date` Default über `Intl.DateTimeFormat('en-CA', { timeZone: ctx.cfg.timezone }).format(new Date())`
- Format-Check `/^\d{4}-\d{2}-\d{2}$/` → sonst `ValidationError`
- `localDayStart(date, ctx.cfg.timezone)` als `DepArrTime`
- `includeRealtime` **false**
- Mismatch- und `dateOutOfRange`-Behandlung wie bei `departures`
- Filtern auf den lokalen Tag: `dayStart = localDayStart(date, tz)`, `dayEnd = localDayStart(nextDay, tz)`; `dayStartMin = isoToMinutes(dayStart)`, `dayEndMin = isoToMinutes(dayEnd)`; eine Abfahrt gehört zum Tag, wenn `dayStartMin <= t < dayEndMin`
- `Departure`-Objekte ohne Echtzeit (`realtime: false`, `estimatedTime` undefined)

- [ ] **Step 6: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/departures.test.ts tests/timetable.test.ts` — Expected: PASS.

- [ ] **Step 6b: Grenztest für den lokalen Kalendertag ergänzen**

Der Filter muss auf den **lokalen** Tag arbeiten, nicht auf den UTC-Tag — in Europe/Berlin beginnt der 20.10. um `2026-10-19T22:00:00Z`. Ergänze in `tests/timetable.test.ts` einen Test mit einem **eigenen** Response-Body, der beide Seiten der Grenze enthält:

Baue ein minimal gültiges `StopEventResponse` mit genau zwei Abfahrten:
- `2026-10-20T21:30:00Z` → 23:30 Ortszeit am **20.10.** → **muss drin sein**
- `2026-10-20T22:30:00Z` → 23:30 Ortszeit am **21.10.** → **muss raus**

Setze den Fake-Server auf diesen Body, rufe `timetable({ stop: 'de:03152:33924', date: '2026-10-20' })` und erwarte **genau eine** Abfahrt mit `timetabledTime === '2026-10-20T21:30:00Z'`.

*Warum dieser Test:* Er pinnt die UTC-Grenze `2026-10-19T22:00Z` bis `2026-10-20T22:00Z` fest. Ein Filter, der fälschlich auf den UTC-Tag arbeitet, würde **beide** Abfahrten behalten (UTC-Datum ist bei beiden `2026-10-20`) — der Test schlägt dann fehl. Ein Filter mit `+24*60` statt des echten Tagesendes würde die erste verlieren.

- [ ] **Step 7: Commit**

```bash
git add src/tools/departures.ts src/tools/timetable.ts tests/departures.test.ts tests/timetable.test.ts
git commit -m "feat: departures and timetable tools with fuzzy stop handling"
```

---

## Task 9: Tool `journey`

**Files:** Create `src/tools/journey.ts`; Test `tests/journey.test.ts`

**Interfaces:**
- Produces: `journey(args: { from: string; to: string; when?: string; maxResults?: number; includeRealtime?: boolean }, ctx: ToolContext): Promise<ToolEnvelope>`
- Consumes: `ctx.resolver.resolveStop` (für **beide** Endpunkte), `ctx.client.tripRequest`

**Verhalten:**
- `from` und `to` sind **Namen oder IDs**; beide werden fuzzy aufgelöst (Spec 4.5.3).
- **Der `TripRequest` kann keine Namen verarbeiten** (gemessen: `TRIP_NOTRIPFOUND`) — deshalb wird **immer** vorher aufgelöst und die **Ref** übergeben.
- `when` Default jetzt, `maxResults` Default 3 (max 10), `includeRealtime` Default true.
- `data` = `{ resolvedFrom, resolvedTo, journeys }`; `Journey.legs` enthält die `interchange`-Beine.
- `Duration` (`PT48M`) → `durationMinutes`; `Interchanges` bleibt Zahl.
- `containsRequestedRef === false` → Warnung, `confidence` von `resolvedFrom`/`resolvedTo` auf `'low'`.
- `notripfound` → Warnung mit Kontingent-Hinweis.

- [ ] **Step 1: Failing test schreiben**

`tests/journey.test.ts` — Fake-Server liefert `trip_response.xml`:
- `journey({ from: 'de:03152:33817', to: 'de:03152:33924', when: '2026-10-20T11:00:00Z' })`:
  - `env.data.resolvedFrom.chosen.stopPointRef` === `'de:03152:33817'`
  - `env.data.resolvedTo.chosen.stopPointRef` === `'de:03152:33924'`
  - `env.data.journeys` hat 3 Einträge
  - `journeys[0].durationMinutes` === 48
  - `journeys[0].interchanges` === 2
  - `journeys[0].legs.map(l => l.kind)` === `['timed', 'interchange', 'timed', 'timed']`
  - `journeys[0].departureTimeLocal` passt auf `/[+-]\d{2}:\d{2}$/`

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/journey.test.ts` — Expected: FAIL.

- [ ] **Step 3: `src/tools/journey.ts` implementieren**

- `toLeg(l: RawJourney['legs'][number], tz: string): Leg` — übernimmt `kind`, `line`, `mode`, `origin`, `destination`, `platform`, `durationMinutes`, `intermediateStops`; `departureTimeLocal`/`arrivalTimeLocal` = `toLocalIso(...)` nur wenn vorhanden
- Ablauf: `resolvedFrom` = `resolveStop(args.from)`, `resolvedTo` = `resolveStop(args.to)`, dann `client.tripRequest(resolvedFrom.chosen.stopPointRef, resolvedTo.chosen.stopPointRef, when, maxResults, includeRealtime, resolvedFrom.chosen.name, resolvedTo.chosen.name)`
- Warnungen und `data` nach der Verhaltensliste

- [ ] **Step 4: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/journey.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/journey.ts tests/journey.test.ts
git commit -m "feat: journey tool with fuzzy resolution of both endpoints"
```

---

## Task 10: MCP-Server, Tool-Registrierung, README

**Files:** Create `src/index.ts`, `README.md`; Test `tests/server.test.ts`

**Interfaces:**
- Produces: `createServer(ctx: ToolContext): McpServer` aus `src/index.ts` (exportiert für Tests)
- Verwendet: `McpServer` aus `@modelcontextprotocol/sdk/server/mcp.js`, `StdioServerTransport` aus `.../server/stdio.js`, `z` aus `zod`
- `registerTool(name, { title, description, inputSchema }, cb)` — `inputSchema` ist ein **zod raw shape** (kein `z.object`)

**Tool-Schemas (zod raw shape):**
- `stop_search`: `{ query: z.string(), type: z.string().optional(), maxResults: z.number().optional() }`
- `departures`: `{ stop: z.string(), when: z.string().optional(), maxResults: z.number().optional(), includeRealtime: z.boolean().optional() }`
- `journey`: `{ from: z.string(), to: z.string(), when: z.string().optional(), maxResults: z.number().optional(), includeRealtime: z.boolean().optional() }`
- `timetable`: `{ stop: z.string(), date: z.string().optional() }`

**Antwortform:**
- Erfolg → `{ content: [{ type: 'text', text: JSON.stringify(env, null, 2) }], structuredContent: env }`
- Fehler → `{ isError: true, content: [{ type: 'text', text: \`${message}\n\n${hint}\` }], structuredContent: { error: { code, message, hint: hint ?? null } } }`
- Unbekannte Fehler → in `TriasError('API_ERROR', 'Unerwarteter Fehler im Server.', originalMessage)` verpacken

- [ ] **Step 1: Failing test für die Tool-Registrierung schreiben**

`tests/server.test.ts`:
- `createServer(ctx)` registriert **genau** die vier Tools. Prüfe die registrierten Namen über die interne Struktur des `McpServer` — **schau vor dem Schreiben des Tests in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` nach, wie sie in 1.32 heißt** (in 1.32 ist es `_registeredTools`). Der Test soll die Registrierung belegen, nicht an einer Implementierungsdetails-Variante scheitern.
- Zusätzlich: die Tool-**Beschreibungen** enthalten „stopPointRef" bzw. „Echtzeit", damit ein LLM die Werkzeuge zuordnen kann.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/server.test.ts` — Expected: FAIL.

- [ ] **Step 3: `src/index.ts` implementieren**

- `new McpServer({ name: 'busse-goettingen', version: '0.1.0' }, { instructions: '…' })`
  Die `instructions` erklären dem LLM: TRIAS-Schnittstelle, Zeiten in UTC **und** Ortszeit, `data.resolved` nennt die verwendete Haltestelle, `warnings` nennt Abweichungen.
- Vier `registerTool`-Aufrufe mit den obigen Schemas; jede `description` auf Deutsch und inhaltlich (was kommt zurück, welche Eingabe, welche Besonderheit).
- Callback: `try { return ok(await tool(args, ctx)); } catch (e) { return fail(e); }`
- `main()`: `loadConfig()` → `new Quota(cfg.dailyLimit, cfg.quotaWarnThreshold)` → `new TriasClient(cfg, quota)` → `new Resolver(client, cfg, new TtlCache(cfg.cacheTtlSeconds))` → `createServer(ctx)` → `server.connect(new StdioServerTransport())`
- `main()`-Aufruf nur, wenn die Datei direkt ausgeführt wird (`import.meta.url === \`file://${process.argv[1]}\``)
- Fehler beim Start: `console.error('Server startet nicht:', message)` auf **stderr**, `process.exit(1)`

- [ ] **Step 4: Tests laufen lassen — müssen durchlaufen**

Run: `npx vitest run tests/server.test.ts` — Expected: PASS.

- [ ] **Step 5: Kompilieren**

Run: `npx tsc --noEmit` — Expected: keine Ausgabe, Exit 0. Bei Typfehlern die Interfaces aus Task 1–9 als Vertrag behandeln.

- [ ] **Step 6: `README.md` schreiben**

Abschnitte: Zweck; Voraussetzungen (Node ≥ 22); Installation (`npm install`, `.env` aus `.env.example`, `RequestorRef` eintragen); Start (`npm run build && npm start`, bzw. `npm run dev`); MCP-Client-Config (JSON-Block aus Spec Abschnitt 6); die vier Tools mit Eingabeparametern; **Bekannte Einschränkungen** (GET wird von der WAF blockiert → nur POST; Tageskontingent 10.000/Tag; `RequestorRef` wird von der API nicht validiert; die Haltestellen-Auflösung ist unscharf und `data.resolved` nennt immer die verwendete Haltestelle; Zeiten in UTC **und** Europe/Berlin); Nutzungsbedingungen Connect (Daten nur für eigene Zwecke, kein Weiterverkauf, Hinweis „Alle Angaben ohne Gewähr").

- [ ] **Step 7: Manueller End-to-End-Test**

Run: `npm run build && node dist/index.js` (mit `.env` im Projektverzeichnis) — der Server startet und wartet auf stdio-Eingaben, beendet sich nicht.
Run: `env -u RequestorRef node dist/index.js; echo "exit=$?"` — Expected: `RequestorRef fehlt.` auf stderr und `exit=1`.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts README.md tests/server.test.ts
git commit -m "feat: MCP server with four TRIAS tools, stdio transport and README"
```

---

## Task 11: Live-Abnahme gegen die echte Schnittstelle

**Files:** Create `scripts/smoke.ts`; Modify `README.md` (Abschnitt „Verifizierte Beispiele")

**Interfaces:**
- Produces: `scripts/smoke.ts` — ruft die vier Tools live gegen `v4-api.efa.de` auf und gibt die Ergebnisse aus

**Warum eigener Task:** Die bisherigen Tests laufen gegen Fixtures oder einen lokalen Mock. Dieser Task prüft die **echte** API — WAF-Verhalten, echte Response-Formate, Echtzeitdaten. Er ist bewusst separat, damit ein Fehler hier die übrigen Tasks nicht blockiert.

- [ ] **Step 1: `scripts/smoke.ts` schreiben**

Rufe nacheinander `stopSearch({ query: 'Göttingen Bahnhof' })`, `departures({ stop: 'de:03152:33817' })`, `timetable({ stop: 'Göttingen Bahnhof', date: '2026-10-20' })` und `journey({ from: 'Göttingen Bahnhof', to: 'de:03152:33924' })` auf. Gib pro Tool `JSON.stringify(env.data, null, 2)` **gekürzt auf 1200 Zeichen** aus, dazu `env.warnings` falls vorhanden. Am Ende `console.log(\`API-Aufrufe: ${quota.used}\`)`.

- [ ] **Step 2: Smoke-Test live ausführen**

Run: `npx tsx scripts/smoke.ts`
Expected:
- `stop_search` liefert Treffer mit `de:03152:33817` an erster Stelle
- `departures` liefert eine nicht-leere Liste mit `timetabledTime` **und** `timetabledTimeLocal`
- `timetable` liefert Soll-Abfahrten
- `journey` liefert mindestens eine Verbindung mit `legs`
- `API-Aufrufe:` ≤ 10

**Wenn ein Tool fehlschlägt:** die Fehlermeldung zur Eingrenzung nutzen. Häufigste Ursache: die echte Antwort enthält ein Element, das der Parser nicht kennt — dann einen **Parser-Test mit dem echten Fragment** ergänzen, nicht die Ausgabe verschlucken.

- [ ] **Step 3: Unbekannte Haltestellen-ID live prüfen (Review-Focus 1)**

Rufe `departures({ stop: 'de:09999:33924' })` auf und gib `env.data.resolved` und `env.warnings` aus.
Expected: `chosen.name` === `'Geretsried, Keplerweg'`, `confidence` === `'low'`, `warnings` enthält „existiert nicht". **Kein Fehler.**

- [ ] **Step 4: `README.md` um verifizierte Beispiele ergänzen**

Füge einen Abschnitt „Verifizierte Beispiele" mit der **echten** Ausgabe des Smoke-Tests hinzu (je Tool auf ~10 Zeilen gekürzt) plus das Verifikationsdatum. Die README wird damit eine belegbare Referenz statt einer Behauptung.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke.ts README.md
git commit -m "test: live smoke test against the real TRIAS endpoint, verified README examples"
```

---

## Nachabschluss

- [ ] `npx vitest run` — **alle** Tests grün
- [ ] `npx tsc --noEmit` — keine Fehler
- [ ] `npm run build` — `dist/` entsteht
- [ ] `.env` steht in `.gitignore`, `.env.example` ist eingecheckt
- [ ] `grep -rn "RequestorRef=" src/ tests/ scripts/` liefert **nur** den Zugriff über `process.env` in `src/config.ts` — der tatsächliche Wert steht nirgends im Code, in den Tests oder in den Dokumenten
- [ ] `git log --oneline` zeigt 11 Commits

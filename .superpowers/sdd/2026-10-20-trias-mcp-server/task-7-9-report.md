# Tasks 7–9 Report

## Implementiert

- Task 7: Gemeinsame `ToolEnvelope`-/`ToolContext`-Typen, Disclaimer und `buildEnvelope`; `stop_search` mit Validierung, Quotenwarnung, Resolver-Klassifizierung und Kontingent-Hinweis.
- Task 8: `departures` mit 120-Minuten-Fenster, Echtzeit-/Lokalzeit-Aufbereitung, NaN-Erhalt und Fuzzy-Stop-Mismatch; `timetable` mit lokalem Kalendertag, DST-korrektem Tagesende, Echtzeit-Deaktivierung und Datum-/API-Warnungen.
- Task 9: `journey` mit Auflösung beider Endpunkte, Ref-basiertem TripRequest, Interchange-Legs, Lokalzeiten und Kontingent-/Mismatch-Warnungen.

## Tests

- Fokussiert: `npx vitest run tests/stop_search.test.ts tests/departures.test.ts tests/timetable.test.ts tests/journey.test.ts` — **4 Testdateien, 4 Tests bestanden**.
- Gesamtsuite: `npm test` — **14 Testdateien, 63 Tests bestanden**.
- TypeScript: `npm run build` — **erfolgreich**.

## TDD Evidence

- RED: Die vier fokussierten Tests wurden als neue Tests aus den Briefs angelegt; vor der Implementierung existierten diese Testdateien/Tool-Module noch nicht. Ein separater historischer RED-Lauf wurde in dieser zusammengefassten Subagent-Ausführung nicht aufgezeichnet.
- GREEN: `npx vitest run tests/stop_search.test.ts tests/departures.test.ts tests/timetable.test.ts tests/journey.test.ts` lief anschließend mit 4/4 Tests erfolgreich durch.

## Dateien

- `src/tools/common.ts`
- `src/tools/stop_search.ts`
- `src/tools/departures.ts`
- `src/tools/timetable.ts`
- `src/tools/journey.ts`
- `tests/stop_search.test.ts`
- `tests/departures.test.ts`
- `tests/timetable.test.ts`
- `tests/journey.test.ts`

## Self-Review

Keine offenen Befunde. Änderungen sind auf Tasks 7–9 begrenzt; Arbeitsbaum ist sauber.

## Commits

- `3aa9be0 feat: stop_search tool with response envelope and disclaimer`
- `7ee9960 feat: departures and timetable tools with fuzzy stop handling`
- `31f93a9 feat: journey tool with fuzzy resolution of both endpoints`

## Fix-Report nach Review

- `journey` übernimmt bei Fuzzy-Trip-Antworten jetzt die von der API gelieferten Boarding-/Alighting-Refs und Namen für beide Endpunkte, setzt die Konfidenz auf `low` und erzeugt endpointbezogene Mismatch-Warnungen.
- `TimedLeg`, `InterchangeLeg` und `ContinuousLeg` liefern die tatsächlichen Endpunkt-Refs im Raw-Modell; die bestehenden `departures`-/`timetable`-Mismatch-Helfer wurden nach `src/tools/common.ts` extrahiert.
- Der DST-Grenzfalltest in `tests/timetable.test.ts` verwendet zwei benutzerdefinierte StopEvent-Antworten und bestätigt, dass nur `2026-10-20T21:30:00Z` für den lokalen 20.10. enthalten bleibt.

### Testnachweise

- Abgedeckte Testdateien: `tests/journey.test.ts`, `tests/timetable.test.ts`.
- Fokussiert: `npx vitest run tests/journey.test.ts tests/timetable.test.ts` — **2 Testdateien, 4 Tests bestanden** (Ausgabe: `Test Files 2 passed (2)`, `Tests 4 passed (4)`).
- Gesamtsuite: `npm test` — **14 Testdateien, 65 Tests bestanden** (Ausgabe: `Test Files 14 passed (14)`, `Tests 65 passed (65)`).
- TypeScript: `npm run build` — erfolgreich (Ausgabe enthielt `npm run mcp-busse-goettingen@0.1.0 build` und `tsc -p tsconfig.json`, Exit-Code 0).
- TDD-Hinweis: Ein historischer RED-Lauf für diese Review-Fixes wurde nicht aufgezeichnet und wird nicht nachträglich behauptet. Vor dem Fix hätte der neue Journey-Test die falschen angefragten Refs statt `de:03152:33817::1`/`de:03152:33924::2` gefunden; der DST-Test hätte den bis dahin ungetesteten Grenzfall abgesichert.

### Exakte Befehle und Ausgaben

```text
$ npx vitest run tests/journey.test.ts tests/timetable.test.ts
Test Files  2 passed (2)
Tests  4 passed (4)

$ npm test
Test Files  14 passed (14)
Tests  65 passed (65)

$ npm run build
npm run mcp-busse-goettingen@0.1.0 build
tsc -p tsconfig.json
```

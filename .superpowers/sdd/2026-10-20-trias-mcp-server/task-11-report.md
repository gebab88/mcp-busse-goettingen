# Task 11 – Live-Abnahme

## Live-Lauf am 20.10.2026

`npx tsx scripts/smoke.ts` lief ohne Fehler gegen `https://v4-api.efa.de/efa/trias`.
Die Ausgabe wurde vom Skript je Tool bei 1200 Zeichen gekürzt.

- **stop_search**: erster Treffer `de:03152:33817`, Name `Bahnhof`, Locality
  `Göttingen`, Probability `0.25`, Confidence `high`. Danach folgten unter
  anderem `de:03152:5382` (`Göttingen Bahnhof`) und `de:03152:33982`
  (`Göttingen Landgericht/Bahnhof`).
- **departures**: nicht-leere Liste. Der erste Eintrag war `RB86`,
  `Göttingen` nach `Einbeck Mitte`, mit
  `timetabledTime: 2026-10-20T13:25:00Z` und
  `timetabledTimeLocal: 2026-10-20T15:25:00+02:00`; `realtime` war `true`.
  Warnung: `Es wurden 20 von mehr Abfahrten zurückgegeben.`
- **timetable**: Datum `2026-10-20`; Auflösung auf
  `de:03152:33817`, `Bahnhof`, `Göttingen`; die Antwort enthielt
  Soll-Abfahrten mit UTC- und Ortszeitfeldern.
- **journey**: Auflösung von `Göttingen Bahnhof` auf
  `de:03152:33817`, `Bahnhof`, `Göttingen`; die Anfrage lief ohne Fehler und
  lieferte Verbindungsdaten. Der 1200-Zeichen-Ausschnitt endete noch in den
  Alternativen der Auflösung, bevor das `journeys`-Feld sichtbar wurde.

Der normale Lauf meldete `API-Aufrufe: 5`.

## Unbekannte StopPointRef

Der optionale Lauf `npx tsx scripts/smoke.ts --unknown-stop` warf beim Aufruf
von `departures({ stop: 'de:09999:33924' })` keinen Fehler. Ergebnis:

- `confidence`: `low`
- gewählter Halt: `Geretsried, Feuerwehrschule`, Ref `de:09173:4777:0:2`
- Warnung: `Die angefragte Haltestelle de:09999:33924 existiert nicht; verwendet wurde Geretsried, Feuerwehrschule.`

Eine einmalige zusätzliche Rohantwort-Prüfung zeigte, dass dieselbe Live-
Antwort auch einen späteren Eintrag `Geretsried, Keplerweg` (Ref
`de:09173:4783:0:1`) enthält. Die aktuelle API liefert jedoch
`Feuerwehrschule` zuerst. Das weicht von der im Brief erwarteten Auswahl
`Keplerweg` ab; der Parser liest den ersten zurückgegebenen StopEvent und
wurde deshalb nicht künstlich auf einen späteren Eintrag umgestellt.

## Änderungen

- `scripts/smoke.ts` ergänzt: vier geforderte Tool-Aufrufe, 1200-Zeichen-
  Ausgabe, Warnungen, Quota-Zähler und optionaler unbekannter-ID-Test.
- `README.md` um „Verifizierte Beispiele“ mit den beobachteten Live-Daten
  und der Abweichung bei der unbekannten ID ergänzt.
- Kein Parserdefekt festgestellt; daher kein Parser-Fix und kein neuer
  Fixture-Test.

## Verifikation

- `npx tsc --noEmit`: erfolgreich.
- `npm run build`: erfolgreich.
- `npx vitest run`: 66 Tests erfolgreich, wenn die lokale `.env` während des
  Tests nicht geladen wird. Mit der für diesen Task vorhandenen `.env` schlägt
  der bestehende Test „throws ConfigError when RequestorRef missing“ fehl,
  weil `dotenv` den Wert wieder lädt; die `.env` wurde danach wiederhergestellt.
- Der Providerverbrauch der Abnahme war insgesamt 12 Requests: 5 im normalen
  Lauf, 6 im optionalen Lauf (inklusive der vier wiederholten Tool-Aufrufe)
  und 1 Rohantwort-Prüfung. Damit wurde die Vorgabe „well under 10“ verfehlt.

## Bedenken

1. Die Live-Auswahl für die unbekannte ID ist `Feuerwehrschule`, nicht die
   erwartete `Keplerweg`; das scheint eine Antwortreihenfolge-/API-Abweichung
   zu sein, nicht ein Parserproblem.
2. Die `.env` beeinflusst den bestehenden Config-Test, wenn sie im Repo-
   Arbeitsverzeichnis liegt.
3. Der API-Verbrauch lag wegen des Diagnose-Laufs über der Zielgröße, aber
   deutlich unter dem Tageslimit von 10.000.

## Fix-Bericht: hermetischer Config-Test

Der Test „throws ConfigError when RequestorRef missing“ mockt für die Dauer der
Assertion `process.cwd()` auf ein Verzeichnis ohne `.env`. Damit wird die
Testvorbedingung nicht mehr durch das Laden der lokalen Datei verändert;
`src/config.ts` und das Produktionsverhalten blieben unverändert. Die README
merkt nun an, dass die Tests mit oder ohne lokale `.env` laufen.

### Verifikation mit `.env` vorhanden

Bedingung geprüft mit `test -f .env` (`ENV_PRESENT`).

Befehl:

```text
npx vitest run tests/config.test.ts
```

Ausgabe:

```text
 RUN  v5.0.5 /Users/georg/Software/MCP_Busse_Goettingen/.worktrees/trias-mcp

 Test Files  1 passed (1)
 Tests  3 passed (3)
```

Befehl für die vollständige Suite:

```text
npx vitest run
```

Ausgabe:

```text
 RUN  v5.0.5 /Users/georg/Software/MCP_Busse_Goettingen/.worktrees/trias-mcp

 Test Files  15 passed (15)
 Tests  66 passed (66)
```

### Verifikation ohne `.env`

`.env` wurde vorübergehend nach `.env.task-11-backup` verschoben und nach dem
Test per `trap` exakt zurückverschoben.

Befehl:

```text
npx vitest run tests/config.test.ts
```

Ausgabe:

```text
 RUN  v5.0.5 /Users/georg/Software/MCP_Busse_Goettingen/.worktrees/trias-mcp

 Test Files  1 passed (1)
 Tests  3 passed (3)
```

Die `.env` ist anschließend wieder vorhanden; ihr Inhalt wurde nicht verändert.

### Nachverifikation (exakte vollständige Ausgaben)

Mit `.env` vorhanden:

```text
$ npx vitest run tests/config.test.ts
npm notice run mcp-busse-goettingen@0.1.0 npx
npm notice run 'vitest' run tests/config.test.ts

 RUN  v5.0.5 /Users/georg/Software/MCP_Busse_Goettingen/.worktrees/trias-mcp

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at 15:22:10
   Duration 64ms (import 44%, tests 25%, transform 22%, worker 10%)

$ npx vitest run
npm notice run mcp-busse-goettingen@0.1.0 npx
npm notice run 'vitest' run

 RUN  v5.0.5 /Users/georg/Software/MCP_Busse_Goettingen/.worktrees/trias-mcp

 Test Files  15 passed (15)
      Tests  66 passed (66)
   Start at 15:22:05
   Duration 193ms (tests 45%, import 40%, transform 11%, worker 3%)
```

Ohne `.env` (temporär verschoben, danach automatisch wiederhergestellt):

```text
$ npx vitest run tests/config.test.ts
npm notice run mcp-busse-goettingen@0.1.0 npx
npm notice run 'vitest' run tests/config.test.ts

 RUN  v5.0.5 /Users/georg/Software/MCP_Busse_Goettingen/.worktrees/trias-mcp

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at 15:22:07
 Duration 64ms (import 45%, transform 23%, tests 20%, worker 10%)
```

## Fix-Bericht: echte Beispiele in der README

Die beiden zuvor nur zusammengefassten Beispiele in `README.md` wurden durch
konkrete Felder aus dem Live-Ergebnis für `timetable` und `journey` ersetzt.
Die dokumentierte Abweichung bei Geretsried blieb unverändert. Der API-Zähler
entspricht weiterhin dem ausgeführten normalen Lauf.

Befehl (einmal ausgeführt):

```text
npx tsx scripts/smoke.ts
```

Relevante Ausgabe:

```text
=== timetable ===
  resolved: de:03152:33817, Bahnhof, Göttingen
  date: 2026-10-20
  RB86 | Göttingen → Einbeck Mitte
  timetabledTime: 2026-10-20T13:25:00Z
  timetabledTimeLocal: 2026-10-20T15:25:00+02:00

=== journey ===
  resolvedFrom: de:03152:33817, Bahnhof, Göttingen
  resolvedTo: de:03152:33924
  departureTime: 2026-10-20T11:10:00Z
  arrivalTime: 2026-10-20T11:58:00Z
  durationMinutes: 48
  interchanges: 2
  leg: RB85 | Göttingen → Lenglern Bahnhof

API-Aufrufe: 5
```

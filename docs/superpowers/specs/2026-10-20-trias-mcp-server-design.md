# MCP-Server für Busse in Göttingen — Design

**Datum:** 2026-10-20
**Status:** Entwurf zur Freigabe
**Autor:** brainstorming-Session mit Georg

---

## 1. Zweck und Warum

Georg möchte einen MCP-Server, über den ein LLM die **Fahrtzeiten der Busse in Göttingen** abfragen kann.
Die Abfrage läuft gegen die **TRIAS-Schnittstelle (VDV 431-2)**, die von der Connect Fahrplanauskunft GmbH
bereitgestellt wird (Zugangsdaten per E-Mail, `.env` liegt vor).

Der Server soll vier Auskünfte liefern:

| Tool | Zweck |
|---|---|
| `stop_search` | Haltestelle nach Namen finden → StopPointRef + Name + Koordinaten |
| `departures` | Kommende Abfahrten an einer Haltestelle (Echtzeit) |
| `journey` | Verbindung A → B mit Umstiegen |
| `timetable` | Aushangfahrplan (Soll, ganzer Tag) |

**Warum MCP statt eines Skripts:** Die Abfrage soll in natürlicher Sprache durch ein LLM steuerbar sein.
Der LLM muss dafür Haltestellen-IDs auflösen können — deshalb `stop_search` als erster Schritt.

---

## 2. Ziele / Nicht-Ziele / Anti-Ziele

### Ziele
- Alle vier Tools liefern **strukturierte JSON** (maschinenlesbar, LLM-freundlich).
- `RequestorRef` kommt **ausschließlich** aus der Umgebung (`.env`), ist nirgends hardcodiert.
- Funktioniert für **Göttingen** und Umgebung (Landkreis Northeim, Eichsfeld, Hann. Münden) — der TRIAS-Endpunkt
  deckt bundesweite Soll-Fahrplandaten plus Echtzeit in Niedersachsen/Bremen ab.
- Fehler der API werden verständlich zurückgegeben, nicht als Exception-Crash.
- **Fuzzy statt hartem Fehler:** Unklare oder unbekannte Haltestellen liefern trotzdem ein Ergebnis;
  die tatsächlich verwendete Haltestelle wird **immer** mitgeteilt (`data.resolved`).
- Läuft als **stdio-Server** (Standard für MCP-Server, in OpenCode/Claude Code einbindbar).

### Nicht-Ziele (bewusst nicht gebaut)
- Keine Karten-/Geodaten-Darstellung, kein WMS-Haltestellenlayer.
- Keine Ticket-/Fahrpreis-Berechnung (TRIAS kann `IncludeFares` — wird ausgelassen, da Göttingen-Tarife
  über den Verbund laufen und der Nutzer das nicht braucht).
- Keine historischen Fahrplandaten, keine GTFS-Anbindung, kein Routing über andere Verkehrsverbünde
  jenseits der über EFA erreichbaren Gebiete.
- Kein GUI, keine Web-Oberfläche.

### Anti-Ziele (wäre ein Fehler)
- **Nicht** die EFA-native rapidJSON-Schnittstelle als Primärweg. Der Endpunkt ist der in der E-Mail
  genannte TRIAS-Endpunkt; die rapidJSON-Schnittstelle ist eine EFA-Implementierungsdetail-URL.
- Kein Hardcoding von Haltestellen-IDs, Liniennummern oder Zeiten im Code.
- Kein stilles Verschlucken von API-Fehlern (ein leeres Ergebnis muss unterscheidbar sein von „Haltestelle nicht gefunden").
- **Kein stilles Weiterreichen falscher Daten:** Weil die API unbekannte IDs mit einer *anderen*
  Haltestelle beantwortet, muss der Server die Abweichung **immer** melden — nicht nur im Fehlerfall.

---

## 3. Erzwungene Randbedingungen (durch Recherche festgestellt)

Diese Punkte sind **gemessen**, nicht vermutet. Sie begrenzen die Architektur.

### 3.1 Der funktionierende TRIAS-Endpunkt

**`POST https://v4-api.efa.de/efa/trias`** mit XML-Body im TRIAS-Format.

- Genau die URL aus der Connect-E-Mail (`v4-api.efa.de`), plus der Pfad `/efa/trias`.
- Der Pfad `/efa/trias` folgt dem vom BKA (MobiData BW) dokumentierten Muster: *ein* Pfad für alle
  Operationen, der Request-Typ steht im XML-Body, nicht in der URL.
  Referenz: https://mobidata-bw.de/data/MobiData-BW-Factsheet-TRIAS.pdf
- **POST funktioniert, GET nicht.** `v3-api.efa.de` und `v4-api.efa.de` liefern auf *jede* GET-Anfrage
  `403 Forbidden` (auch auf `/robots.txt`) — eine host-basierte WAF-Regel, nicht eine IP-Sperre
  (alle `*.efa.de`-Hosts teilen sich 62.154.206.91, `www.efa.de` ist erreichbar).
  POST wird von dieser Regel nicht erfasst.
- Auch `https://www.efa.de/efa/trias` funktioniert und ist der **Fallback**.

### 3.2 Verifizierte Operationen

Alle drei gegen echte Göttinger Daten geprüft:

| TRIAS-Operation | Body-Element | Ergebnis |
|---|---|---|
| Ortsidentifikation | `<LocationInformationRequest>` | 200, 39–40 StopPointRefs mit `de:03152:xxxx` |
| Abfahrten | `<StopEventRequest>` | 200, 40 `<trias:StopEventResult>` |
| Fahrverbindungen | `<TripRequest>` | 200, 3 `<trias:TripResult>` (bei `NumberOfResults=3`) |

Beispiel TripRequest Göttingen Bahnhof → Göttingen Grüner Weg ergab Linien
`RB85, 220, 180, RB85, 9186, 185, RE2, 181` und Ziele `Paderborn Hbf, Göttingen Bahnhof/ZOB,
Nörten-Hardenberg Göttinger Straße, …`.

### 3.3 Echtzeit-Daten

`<trias:EstimatedTime>` ist vorhanden, z. B.

```xml
<trias:ServiceDeparture>
  <trias:TimetabledTime>2026-10-20T12:01:00Z</trias:TimetabledTime>
  <trias:EstimatedTime>2026-10-20T12:02:00Z</trias:EstimatedTime>
</trias:ServiceDeparture>
```

`EstimatedTime` fehlt, wenn keine Prognose vorliegt → dann gilt `TimetabledTime`.

### 3.4 Verhalten der API — wichtige Eigenheiten

- **`RequestorRef` wird nicht validiert.** Ein Test mit `BOGUS-REF-9999` lieferte identische Daten.
  Der Wert wird trotzdem gesetzt (Vorgabe der Nutzungsbedingungen), ist aber kein Zugriffsschutz.
- **Ungültige `StopPointRef` wird ignoriert**, nicht als Fehler gemeldet: `de:99:99:99` lieferte
  40 Ergebnisse für *Geretsried, Keplerweg* (ein anderer Ort!). Der Server muss also selbst validieren:
  Ergebnis-Haltestelle plausibilisieren oder die Ref-ID prüfen.
- **Fehlerhafte XML-Eingabe** → HTTP 200 mit **leerem Body** (kein XML, kein Fehler). Der Client muss
  einen leeren Body als Fehler behandeln.
- **`LocationInformationRequest` mit nur `LocationName`** funktioniert (ohne GeoPosition) und liefert
  Treffer für Göttingen Bahnhof: `de:03152:33817`, `de:03152:5382`, `de:03152:33982`, …
- **Der `TripRequest` braucht `StopPointRef`**, keine freien Namen (sonst „multiple matches"-Fehler).
  `stop_search` ist deshalb zwingende Vorstufe für `journey`.
- **`siri:MessageIdentifier`** ist optional, wird aber gesetzt (Integer, hochzählen).
- **Zeitformat:** TRIAS verlangt Zulu/UTC. Die API rechnet intern korrekt, aber der Client muss
  durchgehend UTC rechnen und in der Ausgabe als ISO-8601 mit `Z` ausgeben.

### 3.5 Zeitfenster der Soll-Fahrpläne

Der Server meldet in der StopEvent-Antwort
`<trias:OperatingDayRef>2026-10-20</trias:OperatingDayRef>` und ein Fahrplanzelt-Fenster
`ttpFrom="20260817" ttpTo="20261212"`. Die Daten sind tagesaktuell (`dataBuild` im EFA-Protokoll:
2026-10-19 für den 20.10.).

### 3.6 Mengenbegrenzung: 10.000 Aufrufe pro Tag

**Von Connect mitgeteilt:** Der Zugang ist auf **10.000 Aufrufe pro Tag** begrenzt. Sind sie
ausgeschöpft, erfolgt an diesem Tag keine weitere Berechnung.

**Was das praktisch bedeutet:**
- 10.000 Aufrufe/Tag sind für einen interaktiven MCP-Server **sehr großzügig** — ein Nutzer, der
  100 Fragen stellt und pro Frage 3 Tools aufruft, verbraucht 300 Aufrufe, also 3 % des Kontingents.
- **Das Kontingent ist kein technisches Limit, sondern ein vertragliches.** Es wird nicht durch
  429/503 signalisiert, sondern schlicht: ab dem Moment der Erschöpfung **liefert die API keine
  Ergebnisse mehr**.
- Der Server kann die Erschöpfung **nicht zuverlässig erkennen**: Es gibt keinQuota-Signal, und
  „leeres Ergebnis" ist mehrdeutig (Haltestelle unbekannt, Tagesende, Kontingent leer).

**Konsequenzen für die Architektur:**

1. **Kein aggressives Caching-Umgehen.** Der Cache (4.13) ist eine Optimierung, kein Kontingent-Schutz.
2. **Ein eigener Zähler im Server** (`TRIAS_DAILY_LIMIT`, Default `10000`) mit Warnung ab 80 %:
   Der Server zählt seine eigenen API-Aufrufe und hängt ab 80 % Auslastung einen Hinweis an jede
   Antwort (`warnings[]`: „8000/10000 Aufrufe heute verbraucht"). So sieht Georg, wie viel Luft ist —
   **bevor** die API stillschweigend leer zurückgibt.
3. **Zählerstand ist nur eine Schätzung.** Andere Clients (z. B. die EFA-Web-App) verbrauchen
   dasselbe Kontingent. Der Server kann nur den eigenen Verbrauch zählen, nicht den gesamt.
   Deshalb: `warnings[]` sagt „nach eigener Zählung", nicht „verbraucht".
4. **Kein Refund.** Ein 4xx/5xx/Timeout zählt vermutlich als Aufruf. Der Server zählt deshalb
   **jeden** an die API gesendeten Request, nicht nur erfolgreiche.
5. **Der Zähler lebt nur im Prozess.** Beim Neustart des MCP-Servers ist er weg. Persistenz wäre
   bei 10.000/Tag vertretbar, wird aber **nicht** gebaut (siehe 8) — der Verbrauch ist für
   interaktive Nutzung so niedrig, dass der Verlust durch einen Neustart unerheblich ist.
6. **Der `Retry` auf den Fallback-Host zählt doppelt.** Wenn der Primärhost 5xx liefert und der
   Fallback antwortet, sind das potenziell zwei Kontingent-Verbrauche. Der Zähler zählt daher
   **beide** Versuche.

**Was passiert, wenn das Kontingent erschöpft ist:** Die API liefert leere oder unvollständige
Antworten. Der Server erkennt das nicht zuverlässig, liefert aber **keine falschen Daten**:
- Bei `StopEventRequest` mit 0 Ergebnissen → `NOT_FOUND` mit dem Hinweis „Keine Abfahrten gefunden.
  Falls die Abfrage plausibel ist, kann das Tageskontingent (10.000/Tag) erschöpft sein."
- Bei `LocationInformationRequest` mit 0 Ergebnissen → dito.

Diese **Hinweis-Zeile** ist der wichtigste Teil: Sie macht aus einem kryptischen Leerergebnis eine
verständliche Ursache.

### 3.7 API-Nutzungsbedingungen beachten

Aus https://connect-fahrplanauskunft.de/datenbereitstellung:
- Kostenlos für registrierte Nutzer, **aber**: Daten nur für eigene Zwecke, Weitergabe des Zugangs
  nur mit schriftlicher Zustimmung, kein Weiterverkauf.
- **Tageslimits** (Abrufe/Tag) werden mit den Zugangsdaten mitgeteilt — der Server muss davon ausgehen,
  dass ein Limit existiert, und sollte einen kleinen In-Memory-Cache vorsehen.
  → **Konkret: 10.000/Tag** (s. 3.6).
- Bei öffentlicher Darstellung: Hinweis „Alle Angaben ohne Gewähr" voranstellen.

---

## 4. Architekturentscheidungen

### 4.1 Stack

**TypeScript / Node.js 22**, ESM, offizielles `@modelcontextprotocol/sdk`.

Begründung: Node v22.22.2 ist auf der Maschine vorhanden, das MCP-SDK hat volle TS-Unterstützung,
und die Verarbeitung von XML → JSON ist mit `fast-xml-parser` unkritisch. Kein Build-Schritt nötig
(wir nutzen `tsx` für Dev bzw. tsc für Build).

### 4.2 Schichten

```
src/
  index.ts          MCP-Server-Entry (stdio), Tool-Registrierung
  config.ts         .env laden, Config validieren, Fail-Fast
  trias/
    client.ts       HTTP-Client: POST XML → XML parsen → typisierte Objekte
    build.ts        Request-XML-Builder (je Operation)
    parse.ts        Response-XML → interne Domänenmodelle
    types.ts        Domänenmodelle (Stop, Departure, Journey, ...)
  resolve.ts       Haltestellen-Auflösung: Name oder ID → StopPointRef (fuzzy, 4.5)
  tools/
    stop_search.ts
    departures.ts
    journey.ts
    timetable.ts
  cache.ts          TTL-Cache (Stops, Fahrpläne, Auflösungen)
  quota.ts          Tageskontingent-Zähler (10.000/Tag)
  errors.ts         Fehlertypen + verständliche Texte
```

**Die `trias/`-Schicht ist der einzige Ort, der die API kennt.** Die Tool-Schicht arbeitet ausschließlich
mit den Domänenmodellen aus `types.ts`. Damit bleibt ein späterer Wechsel des Endpunkts oder ein
zweiter Adapter (z. B. HAFAS) auf eine Datei begrenzt.

### 4.3 XML-Verarbeitung

`fast-xml-parser` mit:
- `ignoreAttributes: false` (Attribute wie `xsi:schemaLocation` sind Teil der Struktur)
- `removeNSPrefix: true` → `<trias:StopPointRef>` wird zu `StopPointRef`, `<siri:Status>` zu `Status`.
  Das vereinfacht die Parser enorm und ist sicher, weil die Namensräume disjunkt sind
  (trias / siri / acsb / ifopt / datex2 verwenden verschiedene Tag-Namen).
- `parseTagValue: false` für Zeitstempel, damit `2026-10-20T12:01:00Z` als String erhalten bleibt
  und nicht zu einem `Date`-Objekt mit impliziter Zeitzone mutiert.

### 4.4 Konfiguration

`.env` (bereits vorhanden, enthält `RequestorRef`):

```
RequestorRef=<REQUESTOR-REF>
```

Zusätzlich optional, jeweils mit Default:

| Variable | Default | Zweck |
|---|---|---|
| `TRIAS_BASE_URL` | `https://v4-api.efa.de/efa/trias` | Primärer Endpunkt |
| `TRIAS_FALLBACK_URL` | `https://www.efa.de/efa/trias` | Fallback bei Netzwerkfehler/5xx |
| `TRIAS_TIMEOUT_MS` | `20000` | Request-Timeout |
| `TRIAS_LANGUAGE` | `de` | `trias:Language` |
| `TRIAS_CACHE_TTL_SECONDS` | `300` | Cache-TTL für Stops/Fahrpläne |
| `TRIAS_USER_AGENT` | `MCP-Busse-Goettingen/0.1` | HTTP-UA |
| `TRIAS_DAILY_LIMIT` | `10000` | Tageskontingent (von Connect mitgeteilt) |
| `TRIAS_QUOTA_WARN_THRESHOLD` | `0.8` | Ab wann gewarnt wird |
| `TRIAS_CONFIDENCE_LOW` | `0.20` | Unterhalb → `confidence: "low"` (gemessen, s. 4.5.0) |
| `TRIAS_CONFIDENCE_CERTAIN` | `0.90` | Ab hier → `confidence: "certain"` (gemessen, s. 4.5.0) |
| `GÖTTINGEN_LOCALITIES` | `Göttingen` | Komma-getrennte Liste lokaler Orte (s. 4.10) |
| `TRIAS_TIMEZONE` | `Europe/Berlin` | Zeitzone für lokale Zeitangaben |

**Regel:** `RequestorRef` wird **niemals** in Code oder Log-Ausgaben geschrieben. `config.ts` wirft beim
Start, wenn `RequestorRef` fehlt oder leer ist.

### 4.5 Haltestellen-Auflösung: fuzzy statt Fehler (Georgs Vorgabe)

> **Vorgabe:** Kein harter Fehler bei unklarer oder unbekannter Haltestelle. Stattdessen **fuzzy**
> auflösen, das Ergebnis liefern und **mitteilen, welche Haltestelle genommen wurde.**

Diese Regel gilt **einheitlich** für `stop_search`, `departures`, `journey` und `timetable`.

#### 4.5.0 Die Konfidenzschwelle: 0,3 ist unbrauchbar — empirisch korrigiert

Georgs ursprüngliche Schwelle `probability < 0.3` wurde **durch Messung widerlegt**. Die
`trias:Probability` der EFA ist **kein absoluter Konfidenzwert**, sondern ein **relativer,
gewichteter Bruchteil innerhalb der Ergebnismenge** (die Summe über die Trefferliste liegt bei ca. 1,0).

Gemessene Werte (alle live gegen `v4-api.efa.de`):

| Abfrage | Kandidaten | max `probability` | Einordnung |
|---|---|---|---|
| `Hauptbahnhof` | 5 | **1.0000** | exakt, eindeutig |
| `ZOB` | 5 | **0.9910** | exakt, eindeutig |
| `Göttingen Markt` | 1 | **0.2500** | exakt, 1 Treffer |
| `Göttingen Grüner` | 1 | 0.2450 | exakt, 1 Treffer |
| `Göttingen Söseweg` | 1 | 0.2500 | exakt, 1 Treffer |
| `Göttingen Bahnhof` | 6 | 0.2500 | exakt, 6 Treffer |
| `Göttingen` | 32 | 0.2500 | breite Menge |
| `Bahnof` (Tippfehler) | 3 | **0.2340** | Tippfehler, trotzdem Treffer |
| `Göttingen Sösewe` (Tippfehler) | 1 | 0.2380 | Tippfehler |
| `Wegn` | 5 | 0.2280 | Teilwort |
| `XYZZYNOTAPLACE99` | 1 | **0.0500** | kein Treffer |
| `Qwertzuiopasdf` | 4 | **0.0460** | kein Treffer |

**Folgerung:** Bei breiten Ergebnismengen und bei exakten Einzeltreffern liegt der Wert bei
**0,23 – 0,25**; nur bei *eindeutiger* Auflösung steigt er auf ~1,0. Der Wert 0,3 liegt **über
beiden Klassen** — mit Schwelle 0,3 würde **jeder** Treffer als „unsicher" gemeldet, auch ein
exakter.

**Die tatsächliche Trennlinie liegt bei ~0,2** (Faktor 5 zwischen den Klassen):

| Wert | Bedeutung |
|---|---|
| `probability >= 0.20` | Treffer (auch mit Tippfehler) → `confidence: "high"` |
| `probability < 0.20` | Kein brauchbarer Treffer → `confidence: "low"` + Warnung |
| `probability >= 0.90` | Eindeutig → `confidence: "certain"` |

Die Konfidenz ist damit **dreistufig**, und `0.90` trennt den Fall „eindeutig aufgelöst"
(„ZOB", „Hauptbahnhof") von „mehrere gleichwertige Treffer" sauber ab.

**Schwellen sind konfigurierbar** über `TRIAS_CONFIDENCE_LOW` (Default `0.20`) und
`TRIAS_CONFIDENCE_CERTAIN` (Default `0.90`). Die Defaults sind **gemessen**, nicht geraten.

**Warum nicht der Abstand zum Zweitbesten?** Geprüft und verworfen: der Quotient
`p_max / p_zweitbest` liegt für alle Queries zwischen 1,00 und 1,15 und trennt die Klassen
**nicht**. Ebenso unbrauchbar: `p_max * n` (0,25 – 5,0, ohne Trennschärfe).

#### 4.5.1 Zwei Fälle, die unterschiedlich behandelt werden

**Fall A — Der Aufrufer nennt einen *Namen* (z. B. „Bahnhof"):**
1. `LocationInformationRequest` mit `LocationName` → Kandidatenliste mit `probability` je Treffer.
2. Sortierung: `probability` absteigend, dann exakter Name-Treffer vor Teiltreffer, dann alphabetisch.
3. **Bester Treffer wird gewählt** — die Abfrage läuft mit dessen `stopPointRef`.
4. Das Ergebnis enthält **immer** die gewählte Haltestelle und — falls mehr als ein Treffer vorlag —
   die Alternativen:

```jsonc
"resolved": {
  "query": "Göttingen Bahnhof",
  "chosen": {
    "stopPointRef": "de:03152:33817",
    "name": "Göttingen, Bahnhof",
    "locality": "Göttingen",
    "probability": 0.25,
    "confidence": "high"
  },
  "alternatives": [
    { "stopPointRef": "de:03152:5382",  "name": "Göttingen, Göttingen Bahnhof",       "probability": 0.25 },
    { "stopPointRef": "de:03152:33853", "name": "Göttingen, Bahnhof/ZOB",           "probability": 0.235 },
    { "stopPointRef": "de:03152:28563", "name": "Friedland (Kr GÖ), Bahnhof/Ostseite", "probability": 0.105 }
  ]
}
```

- `confidence` (Schwellen aus 4.5.0):
  - `certain` — `probability >= 0.90` (**eindeutig aufgelöst**)
  - `high` — `probability >= 0.20` (Treffer, ggf. mit Tippfehler)
  - `low` — `probability < 0.20` (**unsichere Wahl**)
- Ist `confidence: "low"`, hängt das Ergebnis zusätzlich eine Warnung an:
  > „Unsichere Haltestellenwahl: „XYZZYNOTAPLACE99" hat nur 5 % Übereinstimmung — gewählt wurde
  > „Staplack/Enervie Zentrale, Hagen". Bitte prüfe die Haltestelle oder nenne eine ID."

**Sortierung der Kandidaten:** primär nach `probability` absteigend. Bei praktisch gleichem
Wert (Δ < 0,02) — was bei breiten Ergebnismengen der Regelfall ist — entscheidet der **exakte
Namens-Treffer**: `Göttingen Bahnhof` (exakt) wird vor `Göttingen Landgericht/Bahnhof` (Teiltreffer)
und vor `Friedland(Kr Göttingen) Bahnhof/Ostseite` (anderer Ort) gewählt. Das ist wichtiger als
der `probability`-Vergleich, weil die EFA bei gleichen Werten keine Rangfolge liefert.
Erst danach: alphabetisch.

#### Fall B — Der Aufrufer nennt eine *ID*, die der API unbekannt ist:

Die API verweigert keine unbekannte ID, sondern liefert **40 Ergebnisse einer ganz anderen
Haltestelle** (gemessen: `de:09999:33924` → „Geretsried, Keplerweg").

Der Server erkennt das anhand der **Antwort**, nicht anhand der Eingabe:

- Die Antwort enthält `<trias:StopPointName>` — der Name der tatsächlich gelieferten Haltestelle.
- Der Server vergleicht das **Präfix** der gelieferten Refs mit dem Präfix der angefragten Ref
  (`de:03152:33924` ↔ `de:03152:33924::2`).
  - **Präfix passt** → die Haltestelle stimmt, Antwort ist gültig.
  - **Präfix passt nicht** → die API hat eine andere Haltestelle geliefert.

**Antwort bei Präfix-Mismatch (kein Fehler, sondern fuzzy):**
Der Server löst die gelieferte Haltestelle auf und gibt **beide** zurück:

```jsonc
"resolved": {
  "query": "de:09999:33924",
  "requested": { "stopPointRef": "de:09999:33924" },
  "chosen": {
    "stopPointRef": "de:09173:4783",
    "name": "Geretsried, Keplerweg",
    "locality": "Geretsried",
    "probability": 0.05,
    "confidence": "low"
  },
  "alternatives": [],
  "note": "Die angefragte Haltestelle-ID existiert nicht. Stattdessen wurde die ähnlichste gefundene Haltestelle verwendet."
}
```

**Ein Präfix-Mismatch ist per Definition `confidence: "low"`**, unabhängig vom `probability`-Wert:
Die vom Aufrufer gewünschte Haltestelle wurde in jedem Fall **nicht** geliefert. Der Server
versucht zusätzlich, den **Ort** der gelieferten Haltestelle zu bestimmen (per
`LocationInformationRequest` mit dem gefundenen `StopPointName`) und nimmt ihn in die
`warnings[]`-Meldung auf — „Geretsried" liegt 500 km entfernt und muss erkennbar sein.

**Grundregel: Der Server wirft nie einen „Haltestelle nicht gefunden"-Fehler.** Er liefert immer
eine Antwort und sagt transparent, was er genommen hat. `NOT_FOUND` bleibt nur für den Fall
übrig, dass die API **gar nichts** liefert (0 Ergebnisse) — und auch dann mit dem Hinweis auf ein
mögliches erschöpftes Tageskontingent.

#### 4.5.2 Präfix-Vergleich: warum nicht exakt?

Gemessen: Anfrage `de:03152:33817`, Antwort enthält `de:03152:33817::1` — **und** zusätzlich
`de:03159:33817::5` … `de:03159:33817::11` (andere Halte mit derselben Haltestellennummer in
einem anderen Bereich). Ein exakter Vergleich würde also **valide Antworten verwerfen** und
`de:03159:33817::5` fälschlich als „fremde Haltestelle" werten.

Deshalb: **Präfixvergleich** `^([a-z]{2,4}:\d+:\d+)` — Bereich + Haltestellennummer, ohne
Gleis-Suffix (`::2`) und ohne zusätzliche Ebenen (`de:09173:4783:0:1`).

Zusätzlich gilt: Wenn der Präfix-Match **nur** über `OriginStopPointRef`/`DestinationStopPointRef`
zustande kommt (nicht über `CallAtStop`/`LegBoard`), ist das Ergebnis ebenfalls gültig — bei
`TripRequest` ist das der Normalfall, weil der Einstieg über einen Vorgängerhalt läuft.

#### 4.5.3 Auswirkung auf die Tool-Eingaben

Weil die Auflösung fuzzy ist, akzeptieren **alle** Tools einen Namen **oder** eine ID:

| Tool | Eingabe | Auflösung |
|---|---|---|
| `stop_search` | `query: string` | — (ist selbst die Auflösung) |
| `departures` | `stop: string` | Name oder `stopPointRef` → `stop_search`, dann `StopEventRequest` |
| `timetable` | `stop: string` | dito |
| `journey` | `from: string`, `to: string` | beide werden aufgelöst, **zwei** API-Aufrufe für die Suche + einer für die Route |

**Kostenwirkung:** `journey` mit zwei Namen kostet **3** Kontingent-Aufrufe (2 × Suche + 1 × Route)
statt 1. Bei 10.000/Tag ist das unkritisch (s. 3.6), und der Cache (4.13) macht wiederholte
Namensauflösungen kostenlos. **Der Cache deckt Namensauflösungen ab** — das ist wichtig, weil ein
LLM typischerweise erst sucht und dann mit der Ref weiterarbeitet.

#### 4.5.4 Weitere Änderungen an `stop_search`

- `NumberOfResults` Default **20** (damit mehrere Kandidaten sichtbar sind).
- **Kein `NOT_FOUND` bei 0 Treffern**, wenn die API stattdessen einen schwachen Treffer liefert
  (siehe 4.8.2: Unsinn-Namen ergeben einen 5-%-Treffer statt eines Fehlers).
- Nur wenn die API **wirklich 0 Ergebnisse** liefert (`LOCATION_NORESULTS`), wird `NOT_FOUND`
  ausgegeben — mit dem Kontingent-Hinweis.

### 4.6 Zeitangaben: UTC **und** lokale Zeit

Der API-Verkehr ist durchgehend UTC. **Die Ausgabe enthält beides**, weil ein LLM `12:01:00Z` sonst
als 12:01 weitergibt (am 20.10.2026 sind das 14:01 Ortszeit):

```jsonc
{
  "timetabledTime": "2026-10-20T12:01:00Z",
  "timetabledTimeLocal": "2026-10-20T14:01:00+02:00",
  "estimatedTime": "2026-10-20T12:02:00Z",
  "estimatedTimeLocal": "2026-10-20T14:02:00+02:00"
}
```

**Hinweis zur Zeitumstellung:** Deutschland stellt 2026 am letzten Sonntag im Oktober um, also am
**25.10.2026** — vor diesem Datum gilt **CEST (+02:00)**, danach **CET (+01:00)**. Die Beispiele
hier und in den Tests nutzen bewusst Daten **vor** und **nach** dieser Grenze.

Lokale Zeit = `Europe/Berlin` via `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'`.
Umrechnung passiert **im Parser**, nicht in den Tools — eine Stelle, ein Test.

### 4.7 MCP-Rückgabeformat

- **Erfolg:** `structuredContent` (MCP Structured Output) **plus** `outputSchema` je Tool.
  Das Schema wird beim Tool-Registrieren mitgegeben, damit Schema-Drift clientseitig als Fehler
  auffällt und nicht als stillschweigend falsche Antwort.
  Zusätzlich `content: [{ type: 'text', text: <JSON-String> }]` als Fallback für Clients ohne
  Structured-Output-Support.
- **Fehler:** `isError: true` mit `content[].text` = verständliche deutsche Meldung
  (kein Stacktrace), plus `structuredContent: { error: { code, message, hint } }`.
  `code` ist einer aus `errors.ts`: `CONFIG`, `VALIDATION`, `HTTP`, `EMPTY_RESPONSE`,
  `PARSE`, `API_ERROR`, `NOT_FOUND`, `TIMEOUT`.

### 4.8 Fehlerbehandlung

Da die API bei Fehlern oft `200` liefert (leerer Body, ignorierte Eingaben), prüft der Client:

1. HTTP-Status ≠ 200 → `TriasHttpError` mit Status und gekürztem Body.
2. Body leer → `TriasEmptyResponseError` („Die Schnittstelle hat eine leere Antwort geliefert —
   das deutet auf einen fehlerhaften Request hin.").
3. Body nicht parsebar / kein `<trias:Trias>`-Wurzelelement → `TriasParseError`.
4. `<siri:Status>false</siri:Status>` oder `<trias:ErrorMessage>` vorhanden → `TriasApiError` mit
   der Meldung aus der Antwort.
5. `EstimatedTime`-Feld: `null` → auf `TimetabledTime` zurückfallen (kein Fehler).

Alle Fehler werden als **Text** an das LLM zurückgegeben (mit kontextueller Erklärung, welche
Eingabe korrigiert werden kann), nicht als Stacktrace.

#### 4.8.1 Fehlercodes der Schnittstelle (empirisch + VDV 431-2)

Die API liefert Fehler als
```xml
<trias:ErrorMessage>
  <trias:Code>-4030</trias:Code>
  <trias:Text><trias:Text>STOPEVENT_NOEVENTFOUND</trias:Text><trias:Language>de</trias:Language></trias:Text>
</trias:ErrorMessage>
```
Der **Text** (`STOPEVENT_NOEVENTFOUND`) ist aussagekräftiger als der numerische Code. Beide werden
intern erfasst; der Text wird ins Fehler-Mapping aufgenommen.

| Fehlercode (Text) | Bedeutung | Verhalten im Server |
|---|---|---|
| `LOCATION_NORESULTS` | Keine Ortsobjekte gefunden | `NOT_FOUND` + Hinweis auf Tageskontingent |
| `LOCATION_UNSUPPORTEDTYPE` | Objekttyp nicht unterstützt | `VALIDATION` |
| `LOCATION_UNSUPPORTEDPTMODES` | Verkehrsmittel-Einschränkung nicht unterstützt | `VALIDATION` |
| `STOPEVENT_NOEVENTFOUND` | Keine Abfahrt im Zeitraum | `NOT_FOUND` + Kontingent-Hinweis |
| `STOPEVENT_LOCATIONUNKNOWN` | Haltestelle unbekannt | `NOT_FOUND` |
| `STOPEVENT_LOCATIONUNSERVED` | Haltestelle wird nicht bedient | `NOT_FOUND` |
| `STOPEVENT_DATEOUTOFRANGE` | Kein Fahrplan für das Datum | **Warnung + leere Liste** (kein Fehler) + gültiger Zeitraum |
| `STOPEVENT_NOREALTIME` | Keine Echtzeitdaten verfügbar | **kein Fehler**, `warnings[]` |
| `TRIP_NOTRIPFOUND` | Keine Verbindung gefunden | `NOT_FOUND` + Kontingent-Hinweis |
| `TRIASGENERIC_*` | Generische Serverfehler | `API_ERROR` |

**Wichtig:** `siri:Status` ist bei der EFA **immer `true`**, auch wenn Fehler im Payload stehen.
Der Check auf `<siri:Status>false</siri:Status>` greift also praktisch nie — die Fehlererkennung
läuft über `<trias:ErrorMessage>`.

#### 4.8.2 Unbekannte Orte liefern statt eines Fehlers einen schwachen Treffer

Für `LocationName=XYZZYNOTAPLACE99` lieferte die API **keinen Fehler**, sondern einen Treffer:
`Staplack/Enervie Zentrale, Hagen` mit `<trias:Probability>0.05</trias:Probability>`.

Konsequenz: **`stop_search` erkennt einen "nichts gefunden"-Fall nicht am Fehler, sondern an der
Wahrscheinlichkeit.** Der Server:
- gibt `probability` je Treffer aus,
- setzt `confidence` nach den Schwellen aus 4.5.0 (`low` < 0.20, `high` < 0.90, sonst `certain`),
- und liefert **auch dann ein Ergebnis** — nach dem fuzzy-Grundsatz (4.5) wird **nicht** mit
  `NOT_FOUND` abgebrochen. Stattdessen hängt er eine Warnung an:
  > „Unsichere Haltestellenwahl: die beste Übereinstimmung ist „Staplack/Enervie Zentrale,
  > Hagen" (5 %). Bitte prüfe die Haltestelle oder nenne eine ID."

Damit wird aus „Irgendwas in Hagen" eine verständliche Aussage **mit** einer Handlungsanweisung.

#### 4.8.3 Tageskontingent-Zähler

Neues Modul `src/quota.ts`:

```ts
interface QuotaState {
  used: number;          // heute gesendete API-Requests
  limit: number;         // aus TRIAS_DAILY_LIMIT, Default 10000
  day: string;           // 'YYYY-MM-DD' (lokale Zeit)
  warnThreshold: number; // Default 0.8
}
```

- `quota.consume()` wird **vor** jedem HTTP-Aufruf aufgerufen (auch bei Fehlern und Fallback-Versuchen).
- Bei Tageswechsel: Zähler auf 0.
- `quota.warning()` liefert `undefined`, solange `used/limit < warnThreshold`, sonst einen Text für `warnings[]`.
- Der Zähler ist **prozesslokal** (kein File, keine DB) — s. 3.6 Punkt 5.

### 4.9 Antwort-Prüfung: die stillschweigende Haltestellen-Verwechslung

Das in 3.4 beschriebene Verhalten — eine unbekannte `StopPointRef` wird stillschweigend durch
irgendeine andere Haltestelle ersetzt — ist die größte Korrektheitsgefahr der ganzen Architektur.

**Gemessenes Beispiel:** Anfrage `de:09999:33924` → 40 Ergebnisse für **„Geretsried, Keplerweg"**.

Die Prüfung liegt im **Client/Parse-Layer**, nicht in den Tools — sie ist eine Invariante der
API-Kommunikation. Sie ist **ein** Vergleich, der in zwei Ausprägungen vorkommt:

#### 4.9.1 Präfix-Vergleich (statt exaktem Vergleich)

Geprüft wird das **Präfix** `^([a-z]{2,4}:\d+:\d+)` der gelieferten Refs gegen das Präfix der
angefragten Ref. Begründung für den Präfix- statt Exaktvergleich steht in 4.5.2 — ein exakter
Vergleich würde valide Antworten verwerfen, weil die API zusätzlich Refs anderer Halte mit
gleicher Nummer liefert (`de:03159:33817::5` neben `de:03152:33817::1`).

Geprüft wird an diesen Stellen der Antwort:
- `CallAtStop/StopPointRef` (StopEventResponse)
- `LegBoard/StopPointRef`, `LegAlight/StopPointRef` (TripResponse)
- `OriginStopPointRef`, `DestinationStopPointRef` (Service-Element)

**Trifft eines davon das Präfix** → die Antwort gehört zur Anfrage, alles gut.
**Trifft keines** → die API hat eine andere Haltestelle geliefert.

#### 4.9.2 Reaktion auf einen Präfix-Mismatch: **kein Fehler**

Gemäß Georgs Vorgabe (4.5) wird **nicht** geworfen. Stattdessen:

1. Der Server übernimmt die **gelieferte** Haltestelle als Ergebnis.
2. Er löst sie über `LocationInformationRequest` mit dem gelieferten `StopPointName` auf, um
   Name, Locality und `probability` zu erhalten.
3. Das Ergebnis enthält `resolved.chosen` (die tatsächlich gelieferte Haltestelle) und
   `resolved.note` mit dem Hinweis, dass die angefragte ID nicht existiert (4.5.1, Fall B).
4. Eine `warnings[]`-Zeile macht die Abweichung unübersehbar:
   > „Die angefragte Haltestelle-ID `de:09999:33924` existiert nicht. Verwendet wurde
   > „Geretsried, Keplerweg" (Geretsried)."

#### 4.9.3 Kein Input-Format-Check mehr

Es gibt **keine** Vorab-Validierung von `stopPointRef` mehr. Frühere Entwurfsstände hatten eine
Regex `^[a-z]{2,4}:\d{2,6}:\d{1,8}(::\d{1,4})?$` mit hartem Fehler — das ist **gestrichen**,
weil es dem fuzzy-Grundsatz widerspricht. Eine formal gültige, aber unbekannte ID ist genau der
Fall, der auffallen soll, und er wird über 4.9.1/4.9.2 abgefangen.

#### 4.9.4 Was weiterhin ein Fehler bleibt

| Situation | Verhalten |
|---|---|
| API liefert 0 Ergebnisse (`LOCATION_NORESULTS`, `STOPEVENT_NOEVENTFOUND`) | `NOT_FOUND` + Kontingent-Hinweis |
| `STOPEVENT_DATEOUTOFRANGE` | **Warnung + leere Liste** (kein Fehler) |
| `TRIP_NOTRIPFOUND` | `NOT_FOUND` + Kontingent-Hinweis |
| Leerer Response-Body | `EMPTY_RESPONSE` (Fehler) |
| HTTP ≠ 200, Timeout | `HTTP` / `TIMEOUT` (Fehler) |
| XML nicht parsebar | `PARSE` (Fehler) |

#### 4.9.5 Locality-Info bei `LocationInformationRequest`

Die `LocalityRef`s der Treffer werden mitgeführt, damit Aufrufer außerhalb Göttingens die Treffer
erkennen und verwerfen können (kein automatisches Filtern — der Nutzer soll auch bundesweit suchen
können, s. 4.10).

### 4.10 Geografischer Umfang: bundesweit liefern, lokal kennzeichnen

Die API liefert bundesweite Soll-Daten. Der Server **filtert nicht** — das würde legitime Fragen
(„Bus nach Hann. Münden", „ICE ab Göttingen") kaputt machen. Stattdessen:

- Jeder StopPoint in `stop_search` trägt `locality` (der `trias:LocationName` der Antwort).
- Ein `locality` gilt als **lokal**, wenn es in der konfigurierbaren Liste `GÖTTINGEN_LOCALITIES` steht.
- `stop_search` markiert Treffer mit `isLocal: boolean`; die lokale Liste ist **nur** ein Hinweis,
  kein Filter.
- `journey`/`departures` liefern `stop.locality` mit, damit das LLM „Bus nach X" einordnen kann.

**Default-Liste: nur `Göttingen`.**

```
GÖTTINGEN_LOCALITIES=Göttingen
```

**Warum ausgerechnet diese Liste?** Gemessen an der echten API: Eine Suche nach „Göttingen" liefert
32 Treffer mit genau **5** verschiedenen `locality`-Werten:

| locality | Treffer | Ort |
|---|---|---|
| `Göttingen` | 20 | **Göttingen** — die Stadt |
| `Göttingen (Westf)` | 9 | **Böntrup, Menne, Schrade, Teigeler, Töcker, Weber, Wirxel** — Kreis Höxter, NRW |
| `Göttingen (Württ)` | 1 | **Hirsch** — Baden-Württemberg |
| `Cappel (Lippstadt)` | 1 | Abzw. Göttingen |
| `Halle (Saale)` | 1 | Göttinger Bogen |

Die Klammer-Suffixe sind **Ortsdisambiguationen** nach gleichnamigen Orten — „Göttingen (Westf)" ist
**nicht** Göttingen. Genau deshalb darf „Göttingen (Westf)" **nicht** in der lokalen Liste stehen,
obwohl der Ortsname mit „Göttingen" beginnt.

**Die Liste ist bewusst eng.** „Nur Göttingen" ist die Vorgabe; Landkreis Northeim, Eichsfeld und
Hann. Münden sind **nicht** enthalten. Das ist unkritisch, weil die Liste **kein Filter** ist —
ein Bus nach Nörten-Hardenberg wird weiterhin gefunden und geliefert, er wird nur nicht als
„lokal" markiert. Die Liste dient der **Einordnung** durch das LLM, nicht der Auswahl.

**Beim Abgleich wird exakt verglichen** (kein Präfix, kein `startsWith`), denn `Göttingen (Westf)`
startet zwar mit „Göttingen", ist aber ein anderer Ort. Soll künftig ein größerer Umkreis gewünscht
sein, ist das eine Zeile in der `.env`.

### 4.11 Zeitfenster und Standard-Größen

| Tool | Zeitfenster | Default `maxResults` | Max |
|---|---|---|---|
| `departures` | ab `when` (Default: jetzt), **120 Minuten** Fenster | 20 | 50 |
| `timetable` | **ganzer angefragter Tag** (Default: heute) | 100 | 300 |
| `journey` | `when` (Default: jetzt) | 3 | 10 |

- `departures`: TRIAS-`StopEventRequest` mit `DepArrTime` = `when`; der Server filtert nachträglich
  auf `when <= zeit <= when + 120min`, weil die API standardmäßig 40 Treffer ab `when` liefert.
- `timetable`: `StopEventRequest` mit `DepArrTime` = Tagesbeginn (00:00 UTC des gewünschten Datums),
  `IncludeRealtimeData=false`. Ergebnis wird auf den gewünschten Kalendertag (lokale Zeit) gefiltert.
  Bei 150+ Abfahrten am ZOB ist die Antwort groß — deshalb `maxResults` als Parameter und eine
  `warnings[]`-Notiz, wenn gekürzt wurde.
- Datum außerhalb des Datenfensters (`ttpFrom`/`ttpTo`, aktuell 2026-08-17 bis 2026-12-12):
  Die API antwortet mit `STOPEVENT_DATEOUTOFRANGE`. Nach dem fuzzy-Grundsatz (4.5) ist das
  **kein Fehler**, sondern eine **Warnung + leere Liste**:
  > „Für den 15.07.2027 liegen keine Fahrplandaten vor (verfügbar: 17.08.2026 – 12.12.2026)."
  Die Grenzen werden aus der letzten Antwort gelesen und im Server zwischengespeichert.
  **Ausnahme:** Ein syntaktisch unparsbares `date` (z. B. „gestern") bleibt `VALIDATION` —
  das ist ein Eingabefehler, kein Datenmangel.

### 4.12 Pflicht-Hinweis „Alle Angaben ohne Gewähr"

Die Nutzungsbedingungen von Connect verlangen diesen Hinweis bei öffentlicher Darstellung.
Er wird **in jeder Tool-Antwort** mitgeführt, in einem eigenen Feld:

```jsonc
{ "disclaimer": "Alle Angaben ohne Gewähr." }
```

Bewusste Entscheidung: Ein Feld pro Antwort statt nur im README, weil der Hinweis eine
**Pflichtangabe** der Nutzungsbedingungen ist und ein MCP-Server seine Ausgaben unkontrolliert
weiterreicht. Kosten: ~6 Token pro Antwort.

### 4.13 Cache

- `stop_search`: 300 s (Haltestellen ändern sich selten).
- **Auflösungen (`Name → stopPointRef`)**: 300 s, über denselben Cache-Key-Mechanismus.
  Wichtig, weil ein LLM typischerweise erst sucht und dann mit der Ref weiterarbeitet — und weil
  `journey` mit zwei Namen sonst 3 Kontingent-Aufrufe pro Aufruf verbraucht (4.5.3).
- `timetable`: 300 s.
- `departures`: **kein Cache** (Echtzeit).
- `journey`: **kein Cache** (Echtzeit, Routing).

Key = normalisierte Anfrage (normalisierte Query + Body-Hash). LRU mit max. 100 Einträgen.
**Nur In-Memory** — kein On-Disk-Cache: Der Daily-Limit ist 10.000/Tag (s. 3.6), aber die APIs haben
ein Datenfenster von ~100 Tagen, und ein Persistenz-Layer würde beim Neustart veraltete Daten liefern.
Ein Cache ist bewusst eine Optimierung, keine Korrektheitsgrundlage.

### 4.14 Tool-Schnittstellen

Alle Tools geben **strukturiertes JSON** zurück. Gemeinsame Hülle:

```jsonc
{
  "source": "TRIAS",
  "requestUrl": "https://v4-api.efa.de/efa/trias",
  "retrievedAt": "2026-10-20T12:05:00Z",
  "disclaimer": "Alle Angaben ohne Gewähr.",
  "warnings": ["..."],       // optional
  "data": { /* op-spezifisch */ }
}
```

**Grundregel für alle Tools:** Das Feld `resolved` ist **immer** vorhanden und nennt die
tatsächlich verwendete Haltestelle (4.5). Ohne dieses Feld ist die Antwort nicht
interpretierbar, weil die API unbekannte IDs stillschweigend mit einer anderen Haltestelle
beantwortet.

#### `stop_search`
**Input:** `{ query: string, type?: "stop"|"any"|"locality", maxResults?: number }`
**Output:** `data: { stops: [{ stopPointRef, name, locality, isLocal, latitude, longitude, probability, confidence, modes }] }`
- Sortiert nach `probability` (4.5.1).
- `confidence`: `certain` (≥ 0.90) / `high` (≥ 0.20) / `low` (< 0.20) — Schwellen aus 4.5.0.
- **Kein `NOT_FOUND`**, solange die API Treffer liefert (4.5.4).

#### `departures`
**Input:** `{ stop: string, when?: string (ISO, default now), maxResults?: number, includeRealtime?: boolean }`
- `stop` ist **Name oder `stopPointRef`**. Die Auflösung passiert intern (4.5.3).
**Output:**
```jsonc
"data": {
  "resolved": { /* s. 4.5.1 */ },
  "stop": { "stopPointRef": "de:03152:33924", "name": "Göttingen Grüner Weg", "locality": "Göttingen" },
  "departures": [
    { "line": "32", "destination": "Weende-Nord", "origin": "Göttingen Kauf Park-West",
      "direction": "inward", "platform": "2",
      "timetabledTime": "2026-10-20T12:09:00Z", "timetabledTimeLocal": "2026-10-20T14:09:00+02:00",
      "estimatedTime": "2026-10-20T12:11:00Z", "estimatedTimeLocal": "2026-10-20T14:11:00+02:00",
      "realtime": true, "cancelled": false, "mode": "bus", "tripCode": "rbb:08032::R:j26:24" }
  ]
}
```

#### `journey`
**Input:** `{ from: string, to: string, when?: string, maxResults?: number, includeRealtime?: boolean }`
- `from` / `to` sind **Namen oder `stopPointRef`s**.
**Output:**
```jsonc
"data": {
  "resolvedFrom": { /* s. 4.5.1 */ },
  "resolvedTo":   { /* s. 4.5.1 */ },
  "journeys": [
    { "departureTime": "…Z", "departureTimeLocal": "…+01:00",
      "arrivalTime": "…Z",   "arrivalTimeLocal": "…+01:00",
      "durationMinutes": 48, "interchanges": 2,
      "legs": [ { "line": "RB85", "mode": "rail", "origin": "Göttingen", "destination": "Lenglern Bahnhof",
                  "departureTime": "…Z", "departureTimeLocal": "…+01:00",
                  "arrivalTime": "…Z",   "arrivalTimeLocal": "…+01:00",
                  "platform": "4", "intermediateStops": [ … ] } ] }
  ]
}
```

#### `timetable`
**Input:** `{ stop: string, date?: string (YYYY-MM-DD, default heute) }`
**Output:** `data: { resolved, stop, date, departures: [...] }` — Sollzeiten des ganzen Tages, ohne Echtzeit.

### 4.15 Validierung der Eingaben (wegen der API-Eigenheiten aus 3.4)

- **`stopPointRef` wird NICHT mehr hart validiert.** Es gibt keine Formatprüfung, die den Aufruf
  verhindert — der Server versucht es und löst fuzzy auf (4.5.1, Fall B). Das ist Georgs Vorgabe.
- **`stop` / `from` / `to` sind immer Strings** (Name oder ID). Kein Union-Typ, kein Fehler bei
  unbekannter ID.
- `when` muss ISO-8601 sein und wird nach UTC normalisiert.
- `maxResults` wird auf die in 4.11 genannten Grenzen begrenzt.
- `date` muss im verfügbaren Datenfenster liegen, sonst `VALIDATION` mit Zeitraum-Hinweis.
  → **Ausnahme:** Auch hier gilt der fuzzy-Grundsatz. Liegt das Datum außerhalb des Fensters,
  antwortet die API mit `STOPEVENT_DATEOUTOFRANGE`. Der Server meldet das als
  **Warnung + leere Liste**, nicht als Fehler:
  > „Für den 15.07.2027 liegen keine Fahrplandaten vor (verfügbar: 17.08.2026 – 12.12.2026)."

---

## 5. Datenfluss

```
LLM
 │  tool call
 ▼
tools/*.ts  ── Eingabe ist Name ODER ID (kein Format-Check)
 │
 ├─► resolve.ts ── Name? → LocationInformationRequest → beste(r) Treffer
 │                 ID?   → StopEventRequest → Präfix-Vergleich (4.9.1)
 │
 ▼
trias/build.ts  ── baut XML
 │
 ▼
quota.ts  ── consume() (zählt auch Fehlversuche)
 │
 ▼
trias/client.ts ── POST (primary → fallback bei Netzwerkfehler/5xx)
 │                 prüft: Status, leerer Body, parsebar, ErrorMessage
 │                 prüft: Ref-Präfix (4.9.1)
 ▼
trias/parse.ts  ── XML → Domänenmodell (+ lokale Zeit aus UTC)
 │                 Fehlercodes → Fehlertypen (4.8.1)
 ▼
tools/*.ts  ── Formt JSON-Hülle (source, disclaimer, warnings, data)
 │                 data.resolved nennt IMMER die genommene Haltestelle (4.5)
 │                 warnings: quota.warning() + Probability-Hinweis + ID-Abweichung
 ▼
LLM  ← structuredContent + outputSchema, bei Fehler isError: true
```

---

## 6. Konfiguration des MCP-Clients

Für OpenCode / Claude Code in der MCP-Config:

```json
{
  "mcpServers": {
    "busse-goettingen": {
      "command": "node",
      "args": ["/Users/georg/Software/MCP_Busse_Goettingen/dist/index.js"],
      "env": {
        "RequestorRef": "…",
        "TRIAS_BASE_URL": "https://v4-api.efa.de/efa/trias"
      }
    }
  }
}
```

Der Server liest zusätzlich `.env` im Projektverzeichnis (via `dotenv`), damit der RequestorRef
nicht doppelt eingetragen werden muss. **CLI-Env schlägt `.env`.**

---

## 7. Projektstruktur

```
MCP_Busse_Goettingen/
├── .env                      # RequestorRef (existiert bereits)
├── .env.example              # Vorlage ohne Geheimnis
├── .gitignore                # .env, node_modules, dist
├── package.json
├── tsconfig.json
├── README.md                 # Setup, Nutzung, bekannte Einschränkungen
├── docs/superpowers/specs/
│   └── 2026-10-20-trias-mcp-server-design.md
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── errors.ts
│   ├── cache.ts
│   ├── quota.ts
│   ├── resolve.ts             # Haltestellen-Auflösung (fuzzy, 4.5)
│   ├── trias/{client,build,parse,types}.ts
│   └── tools/{stop_search,departures,journey,timetable}.ts
├── tests/                    # Vitest: Parser-Tests gegen aufgezeichnete XML-Fixtures
│   └── fixtures/             # aufgezeichnete echte TRIAS-Antworten
└── scripts/
    └── capture-fixtures.ts   # einmaliges Skript zum Aufzeichnen der Fixtures
```

**Tests:** Die aufgezeichneten echten Antworten liegen unter `tests/fixtures/`. Damit testen die
Parser ohne Netzwerk — wichtig, weil die API ein Tageslimit hat (10.000/Tag).

**Fixture-Erstellung:** Die Fixtures sind bereits aufgezeichnet. Connect nennt ein Tageslimit von
10.000 (s. 3.6) — die Fixture-Aufnahme ist mit 3–5 Aufrufen vernachlässigbar. Ein Skript
`scripts/capture-fixtures.ts` kann sie erneuern; es prüft vorher, ob sie existieren, und macht sonst
**keinen** API-Call.

**Testfälle, die die Fixtures abdecken müssen:**
- StopEventResponse mit `EstimatedTime` vorhanden **und** fehlend (Fallback auf `TimetabledTime`).
- LocationInformationResponse mit mehreren `LocationResult` → Sortierung nach `Probability`.
- LocationInformationResponse mit **schwachem** Treffer (Probability 0.05) → `confidence: "low"`.
- TripResponse mit `TripLeg`/`TimedLeg` → Aufteilung in `LegBoard`/`LegAlight`/`IntermediateCall`.
- Response ohne `trias:EstimatedTime`, mit `trias:PlannedBay` (Gleis) und ohne.
- Leere Response (0 Bytes) → `EMPTY_RESPONSE`, kein Parse-Crash.
- **Präfix-Mismatch:** Response enthält `de:09173:4783:0:1` statt der angefragten `de:09999:33924`
  → **kein Fehler**, sondern `resolved.chosen` = Geretsried + `warnings[]`-Hinweis (4.9.2).
- **Präfix-Match trotz Fremd-Refs:** Response enthält `de:03152:33817::1` **und** `de:03159:33817::5`
  → gültig, **kein** Fehler (4.5.2).
- UTC→Europe/Berlin-Umrechnung, auch über die Winterzeitgrenze (Oktober) und über ein Sommerdatum.
- `quota.ts`: Zähler-Reset bei Tageswechsel, Warnung ab 80 %.

---

## 8. Offene Punkte / bewusste Entscheidungen des Builders

| Punkt | Entscheidung |
|---|---|
| Primär-URL | `v4-api.efa.de/efa/trias` (die URL aus der E-Mail). Fallback `www.efa.de/efa/trias`. |
| GET vs. POST | Ausschließlich POST — GET wird von der WAF blockiert. |
| Trailing-Dot-Trick | **Nicht verwendet.** Der WAF-Bypass ist undokumentiert und könnte jederzeit wegfallen; POST braucht ihn nicht. |
| `RequestorRef` im Log | Nie. |
| XML → JSON | `fast-xml-parser`, Namespace-Präfixe entfernt. |
| Zeitzone | Intern UTC; Ausgabe **UTC + lokal** (Europe/Berlin), s. 4.6. |
| Tageslimit | **10.000/Tag** (von Connect). Eigener Zähler + Warnung ab 80 % (s. 3.6, 4.8.3). |
| `IncludeFares` | Nein. |
| `timetable` vs. `departures` | `timetable` = Soll, ganzer Tag, über `StopEventRequest` mit `IncludeRealtimeData=false` und Datum. `departures` = Echtzeit ab jetzt, 120-Minuten-Fenster. |
| Haltestellen-Validierung | **Fuzzy, kein harter Fehler.** Präfix-Vergleich (4.9.1), Abweichung → Warnung + die tatsächlich gelieferte Haltestelle (4.9.2). Konfidenzschwellen **0.20 / 0.90** (gemessen, s. 4.5.0). |
| Paketmanager | npm (Node 22 vorhanden). |
| Test-Framework | Vitest. |
| MCP-Ausgabeformat | `structuredContent` + `outputSchema`, Fehler als `isError: true`, s. 4.7. |
| Mehrdeutige Haltestellen | **Fuzzy:** bester Treffer wird verwendet, `resolved` nennt ihn + Alternativen, `confidence` dreistufig nach probability. s. 4.5. |
| `journey` bei Namens-Eingabe | **Wie Frage 2:** automatisch auflösen, gewählte Haltestelle melden, Alternativen mitgeben. s. 4.5. |
| Geografischer Filter | Kein Filter, nur `isLocal`-Kennzeichnung, s. 4.10. |
| Disclaimer | In jeder Antwort, s. 4.12. |

---

## 9. Offene Fragen an Georg

### Frage 1 — Zugangsdaten: Reicht der RequestorRef allein? ✅ BEANTWORTET

Das Tageskontingent beträgt **10.000 Aufrufe/Tag** (s. 3.6). Damit ist der RequestorRef praktisch
ausreichend — die API validiert ihn ohnehin nicht.

Offen bleibt nur eine **Rechtsfrage**, keine Technikfrage: Die Nutzungsbedingungen von Connect
verlangen, dass der Zugang **nicht ohne schriftliche Zustimmung weitergegeben** wird und die Daten
**nur für eigene Zwecke** genutzt werden. Für einen privaten MCP-Server auf deinem Rechner ist das
unkritisch. Falls du den Server später öffentlich teilst (z. B. in einem Repo), wäre das eine
Weitergabe — dann vorher mit Connect klären. **Ich baue den Server so, dass beide Fälle funktionieren**
(Zugangsdaten nur aus `.env`, `.env` ist gitignored, `.env.example` ohne Geheimnis).

### Frage 2 — Umgang mit unbekannten Haltestellen ✅ ENTSCHIEDEN

> **Georg:** „Kein harter Fehler → das soll fuzzy sein → gib wieder welche Haltestelle du genommen hast."

Umgesetzt in 4.5 (Fall A und Fall B) und 4.9. Der Server löst immer auf, liefert immer ein
Ergebnis und nennt in `data.resolved` die **tatsächlich genommene** Haltestelle. Abweichungen
werden über `warnings[]` und `confidence` sichtbar. Schwellen: **0.20 / 0.90** (gemessen, s. 4.5.0).

### Frage 3 — `journey` bei Namens-Eingabe ✅ ENTSCHIEDEN

> **Georg:** „Gehe wie bei Frage 2 damit um."

Gleiche Regel: automatisch auflösen, gewählte Haltestelle melden, Alternativen mitgeben.
Implementiert in 4.5.3 — `from` und `to` sind Strings (Name oder ID), Auflösung intern,
`resolvedFrom` / `resolvedTo` im Ergebnis.

### Verbleibende offene Punkte (keine Blockierer)

1. ~~Lokale Ortsliste~~ → **entschieden: nur `Göttingen`** (s. 4.10). Erweiterung jederzeit über
   `GÖTTINGEN_LOCALITIES` in der `.env` möglich.
2. **Rechtsfrage zur Weitergabe** — relevant nur, wenn der Server öffentlich geteilt wird.

### Anmerkung zur Konfidenzschwelle

Die ursprünglich vorgesehene Schwelle `0.3` hat sich bei der Messung als **unbrauchbar erwiesen**
(s. 4.5.0): Die `trias:Probability` der EFA ist ein *relativer* Wert, der bei exakten Treffern bei
0,23–0,25 liegt. Mit 0,3 wäre **jeder** Treffer als „unsicher" gemeldet worden. Die Defaults
`0.20` / `0.90` sind **gemessen**, nicht geschätzt, und trennen die Klassen mit Faktor 5.

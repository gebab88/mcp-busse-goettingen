# Busse Göttingen – MCP-Server

## Zweck

Dieser MCP-Server liefert Abfahrten, Tagesfahrpläne und Verbindungen im Göttinger Nahverkehr über die TRIAS-Schnittstelle (VDV 431-2, XML über HTTP POST).

## Voraussetzungen und Installation

- Node.js **≥ 22**

```sh
npm install
cp .env.example .env
```

Trage in `.env` den von Connect Fahrplanauskunft GmbH erhaltenen Wert für `RequestorRef` ein.

## Start

Für den Produktivbetrieb:

```sh
npm run build && npm start
```

Während der Entwicklung:

```sh
npm run dev
```

Die Tests sind hermetisch und laufen mit oder ohne lokale `.env`-Datei.

Der Server verwendet stdio; stdout ist ausschließlich der MCP-Protokollkanal.

## MCP-Client-Konfiguration

Beispiel für OpenCode oder Claude Code:

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

Alternativ liest der Server `.env` im Projektverzeichnis. Umgebungsvariablen der Kommandozeile haben Vorrang.

## Werkzeuge

- **`stop_search`** – `query` (erforderlich), optional `type` und `maxResults`. Sucht Haltestellen und liefert unter anderem `stopPointRef`; die Suche ist unscharf.
- **`departures`** – `stop` (Name oder `stopPointRef`, erforderlich), optional `when` (UTC), `maxResults` und `includeRealtime`. Liefert Abfahrten in einem zweistündigen Zeitfenster mit UTC- und Ortszeit.
- **`journey`** – `from` und `to` (Namen oder `stopPointRef`, erforderlich), optional `when` (UTC), `maxResults` und `includeRealtime`. Liefert Verbindungen, Fahrzeiten und Umstiege.
- **`timetable`** – `stop` (Name oder `stopPointRef`, erforderlich), optional `date` im Format `JJJJ-MM-TT`. Liefert den Tagesfahrplan ohne Echtzeitabfrage.

Bei unscharfer Auflösung nennen `data.resolved`, `data.resolvedFrom` oder `data.resolvedTo` die tatsächlich verwendete Haltestelle. Abweichungen stehen in `warnings`.

## Umgang mit dem RequestorRef

Der `RequestorRef` ist eine Zugangskennung und bleibt auf diesem Rechner:

- Er steht ausschließlich in `.env`, die in `.gitignore` liegt. `.env.example` enthält nur die Vorlage ohne Wert.
- Er wird nie protokolliert. Der Server schreibt nichts auf stdout außer dem MCP-Protokoll, und Fehlermeldungen gehen auf stderr.
- Er wird aus Fehlertexten entfernt, bevor sie das Werkzeug verlassen (`<RequestorRef>` als Platzhalter). Das betrifft auch den Antworttext der Schnittstelle, falls diese den eigenen Request-Body zurückgibt.
- Er wird nicht weitergegeben. Die Nutzungsbedingungen von Connect erlauben die Weitergabe des Zugangs nur mit schriftlicher Zustimmung; dieser Server ist für den eigenen Gebrauch gedacht.

## Bekannte Einschränkungen

- Die WAF blockiert GET-Anfragen; TRIAS wird deshalb ausschließlich per POST angesprochen.
- Das Tageskontingent beträgt 10.000 Aufrufe pro Tag. Der Server zählt seine eigenen Aufrufe mit und weist ab 80 % Auslastung darauf hin.
- `RequestorRef` wird von der API nicht validiert; ein falscher Wert kann erst durch eine API-Antwort auffallen.
- Die Haltestellen-Auflösung ist unscharf. `data.resolved` nennt immer die verwendete Haltestelle.
- Zeiten werden in UTC und in der Zeitzone `Europe/Berlin` ausgegeben.
- Als lokal gekennzeichnet (`isLocal`) sind nur die Orte aus `GÖTTINGEN_LOCALITIES`; voreingestellt ist allein `Göttingen`. Gleichnamige Orte wie „Göttingen (Westf)" zählen nicht als lokal.

## Verifizierte Beispiele

Live gegen `https://v4-api.efa.de/efa/trias` geprüft am **20.10.2026** mit
`npx tsx scripts/smoke.ts` (5 API-Aufrufe):

```text
stop_search
  de:03152:33817  Bahnhof, Göttingen (probability 0.25, high)
  de:03152:5382    Göttingen Bahnhof (probability 0.25, high)
  de:03152:33982   Göttingen Landgericht/Bahnhof (probability 0.239999995)

departures
  de:03159:33817::7 | RB86 | Göttingen → Einbeck Mitte
  timetabledTime: 2026-10-20T13:25:00Z
  timetabledTimeLocal: 2026-10-20T15:25:00+02:00 | realtime: true
  warning: Es wurden 20 von mehr Abfahrten zurückgegeben.

timetable
  resolved: de:03152:33817, Bahnhof, Göttingen
  date: 2026-10-20
  RB86 | Göttingen → Einbeck Mitte
  timetabledTime: 2026-10-20T13:25:00Z
  timetabledTimeLocal: 2026-10-20T15:25:00+02:00
  ICE 771 InterCityExpress | Kiel Hbf → Göttingen
  timetabledTime: 2026-10-20T13:31:00Z
  timetabledTimeLocal: 2026-10-20T15:31:00+02:00

journey
  resolvedFrom: de:03152:33817, Bahnhof, Göttingen
  resolvedTo: de:03152:33924
  departureTime: 2026-10-20T11:10:00Z | departureTimeLocal: 2026-10-20T13:10:00+02:00
  arrivalTime: 2026-10-20T11:58:00Z | arrivalTimeLocal: 2026-10-20T13:58:00+02:00
  durationMinutes: 48 | interchanges: 2
  leg: RB85 | Göttingen → Lenglern Bahnhof

API-Aufrufe: 5
```

Der separate Live-Test der unbekannten ID `de:09999:33924` war fehlerfrei und
lieferte `confidence: low` sowie den Hinweis, dass die ID nicht existiert.
Die aktuelle API-Antwort verwendete dabei **Geretsried, Feuerwehrschule**;
„Geretsried, Keplerweg“ war ebenfalls in der Antwort enthalten, aber nicht
der zuerst gelieferte Halt. Das ist eine Abweichung von der erwarteten
Fixture-Ausgabe und wird deshalb nicht verschwiegen.

## Nutzungsbedingungen Connect

Die Daten dürfen nur für eigene Zwecke verwendet und nicht weiterverkauft werden. **Alle Angaben ohne Gewähr.**

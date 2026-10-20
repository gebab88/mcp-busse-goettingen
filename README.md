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

## Bekannte Einschränkungen

- Die WAF blockiert GET-Anfragen; TRIAS wird deshalb ausschließlich per POST angesprochen.
- Das Tageskontingent beträgt 10.000 Aufrufe pro Tag.
- `RequestorRef` wird von der API nicht validiert; ein falscher Wert kann erst durch eine API-Antwort auffallen.
- Die Haltestellen-Auflösung ist unscharf. `data.resolved` nennt immer die verwendete Haltestelle.
- Zeiten werden in UTC und in der Zeitzone `Europe/Berlin` ausgegeben.

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
  Soll-Abfahrten wurden geliefert (UTC und Europe/Berlin-Ortszeit).

journey
  resolvedFrom: de:03152:33817, Bahnhof, Göttingen
  resolvedTo: de:03152:33924
  Mindestens eine Verbindung mit legs wurde geliefert.

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

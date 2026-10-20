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

## Nutzungsbedingungen Connect

Die Daten dürfen nur für eigene Zwecke verwendet und nicht weiterverkauft werden. **Alle Angaben ohne Gewähr.**

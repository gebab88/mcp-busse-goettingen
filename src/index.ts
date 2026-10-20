import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { TtlCache } from './cache.js';
import { TriasError } from './errors.js';
import { Quota } from './quota.js';
import { Resolver } from './resolve.js';
import { TriasClient } from './trias/client.js';
import { departures } from './tools/departures.js';
import { journey } from './tools/journey.js';
import type { ToolContext, ToolEnvelope } from './tools/common.js';
import { stopSearch } from './tools/stop_search.js';
import { timetable } from './tools/timetable.js';

const INSTRUCTIONS = `Du stellst Abfahrts- und Verbindungsdaten über die TRIAS-Schnittstelle des Göttinger Nahverkehrs bereit. Die Zeitfelder enthalten sowohl UTC-Zeit als auch Ortszeit in Europe/Berlin. Die Haltestellenauflösung ist unscharf: data.resolved beziehungsweise data.resolvedFrom und data.resolvedTo nennen die Haltestelle, die tatsächlich verwendet wurde. Das Feld warnings nennt Abweichungen, etwa eine ersetzte Haltestelle oder fehlende Daten. Gib diese Hinweise an den Nutzer weiter und behandle die Daten als ohne Gewähr.`;

function ok(env: ToolEnvelope) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(env, null, 2) }], structuredContent: env as unknown as Record<string, unknown> };
}

function asTriasError(error: unknown): TriasError {
  if (error instanceof TriasError) return error;
  const originalMessage = error instanceof Error ? error.message : String(error);
  return new TriasError('API_ERROR', 'Unerwarteter Fehler im Server.', originalMessage);
}

function fail(error: unknown) {
  const triasError = asTriasError(error);
  const hint = triasError.hint;
  const message = hint ? `${triasError.message}\n\n${hint}` : triasError.message;
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { error: { code: triasError.code, message: triasError.message, hint: hint ?? null } },
  };
}

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'busse-goettingen', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('stop_search', {
    title: 'Haltestellen suchen',
    description: 'Sucht Haltestellen und liefert stopPointRef, Namen, Orte und Koordinaten. query ist ein Name oder eine Ortsangabe; die Suche ist unscharf. type filtert den TRIAS-Ortstyp, maxResults begrenzt die Treffer.',
    inputSchema: { query: z.string(), type: z.string().optional(), maxResults: z.number().optional() },
  }, async (args) => {
    try { return ok(await stopSearch(args, ctx)); } catch (error: unknown) { return fail(error); }
  });

  server.registerTool('departures', {
    title: 'Abfahrten',
    description: 'Liefert Abfahrten einer Haltestelle für ein Zeitfenster von zwei Stunden. stop kann ein Haltestellenname oder eine stopPointRef sein und wird unscharf aufgelöst; when ist ein UTC-Zeitpunkt. includeRealtime steuert Echtzeitdaten, maxResults die Anzahl.',
    inputSchema: { stop: z.string(), when: z.string().optional(), maxResults: z.number().optional(), includeRealtime: z.boolean().optional() },
  }, async (args) => {
    try { return ok(await departures(args, ctx)); } catch (error: unknown) { return fail(error); }
  });

  server.registerTool('journey', {
    title: 'Fahrten suchen',
    description: 'Liefert mögliche Verbindungen zwischen zwei Haltestellen mit Strecke, Umstiegen und Zeiten. from und to sind Namen oder stopPointRefs und werden unscharf aufgelöst; when ist UTC. includeRealtime aktiviert Echtzeitdaten, maxResults begrenzt die Verbindungen.',
    inputSchema: { from: z.string(), to: z.string(), when: z.string().optional(), maxResults: z.number().optional(), includeRealtime: z.boolean().optional() },
  }, async (args) => {
    try { return ok(await journey(args, ctx)); } catch (error: unknown) { return fail(error); }
  });

  server.registerTool('timetable', {
    title: 'Tagesfahrplan',
    description: 'Liefert den Tagesfahrplan einer Haltestelle für ein Datum. stop kann ein Name oder eine stopPointRef sein und wird unscharf aufgelöst; date ist JJJJ-MM-TT in Europe/Berlin. Echtzeit wird hier nicht abgefragt.',
    inputSchema: { stop: z.string(), date: z.string().optional() },
  }, async (args) => {
    try { return ok(await timetable(args, ctx)); } catch (error: unknown) { return fail(error); }
  });

  return server;
}

export async function main(): Promise<void> {
  try {
    const cfg = loadConfig();
    const quota = new Quota(cfg.dailyLimit, cfg.quotaWarnThreshold);
    const client = new TriasClient(cfg, quota);
    const resolver = new Resolver(client, cfg, new TtlCache(cfg.cacheTtlSeconds));
    const ctx: ToolContext = { client, resolver, cfg, quota };
    const server = createServer(ctx);
    await server.connect(new StdioServerTransport());
  } catch (error: unknown) {
    const triasError = asTriasError(error);
    console.error('Server startet nicht:', triasError.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

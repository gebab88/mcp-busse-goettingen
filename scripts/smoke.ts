import { loadConfig } from '../src/config.js';
import { TtlCache } from '../src/cache.js';
import { Quota } from '../src/quota.js';
import { Resolver } from '../src/resolve.js';
import { TriasClient } from '../src/trias/client.js';
import type { ToolContext, ToolEnvelope } from '../src/tools/common.js';
import { departures } from '../src/tools/departures.js';
import { journey } from '../src/tools/journey.js';
import { stopSearch } from '../src/tools/stop_search.js';
import { timetable } from '../src/tools/timetable.js';

function printResult(name: string, envelope: ToolEnvelope): void {
  console.log(`\n=== ${name} ===`);
  const data = JSON.stringify(envelope.data, null, 2);
  console.log(data.length > 1200 ? `${data.slice(0, 1200)}\n…` : data);
  if (envelope.warnings.length > 0) {
    console.log(`warnings: ${JSON.stringify(envelope.warnings)}`);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const quota = new Quota(cfg.dailyLimit, cfg.quotaWarnThreshold);
  const client = new TriasClient(cfg, quota);
  const resolver = new Resolver(client, cfg, new TtlCache(cfg.cacheTtlSeconds));
  const ctx: ToolContext = { client, resolver, cfg, quota };

  printResult('stop_search', await stopSearch({ query: 'Göttingen Bahnhof' }, ctx));
  printResult('departures', await departures({ stop: 'de:03152:33817' }, ctx));
  printResult('timetable', await timetable({ stop: 'Göttingen Bahnhof', date: '2026-10-20' }, ctx));
  printResult('journey', await journey({ from: 'Göttingen Bahnhof', to: 'de:03152:33924' }, ctx));

  if (process.argv.includes('--unknown-stop')) {
    const result = await departures({ stop: 'de:09999:33924' }, ctx);
    console.log('\n=== unknown stop id ===');
    console.log(JSON.stringify((result.data as { resolved: unknown }).resolved, null, 2));
    console.log(`warnings: ${JSON.stringify(result.warnings)}`);
  }

  console.log(`\nAPI-Aufrufe: ${quota.used}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

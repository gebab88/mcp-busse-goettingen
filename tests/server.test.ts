import { describe, expect, it } from 'vitest';
import { createServer } from '../src/index.js';
import type { ToolContext } from '../src/tools/common.js';

describe('MCP-Server', () => {
  it('registriert genau die vier TRIAS-Werkzeuge mit hilfreichen Beschreibungen', () => {
    const ctx = {} as ToolContext;
    const server = createServer(ctx);
    const registered = (server as unknown as {
      _registeredTools: Record<string, { description?: string }>;
    })._registeredTools;

    expect(Object.keys(registered).sort()).toEqual(['departures', 'journey', 'stop_search', 'timetable']);
    expect(registered.stop_search?.description).toContain('stopPointRef');
    expect(registered.departures?.description).toContain('Echtzeit');
  });
});

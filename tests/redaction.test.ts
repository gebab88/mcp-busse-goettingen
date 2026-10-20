import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { redactSecret, redactSecretText } from '../src/errors.js';
import { TriasClient } from '../src/trias/client.js';
import { Quota } from '../src/quota.js';
import { loadConfig } from '../src/config.js';

const SECRET = 'SECRET-REQUESTOR-REF-4711';

describe('redactSecret', () => {
  it('ersetzt das RequestorRef in einem Text', () => {
    expect(redactSecret(`<siri:RequestorRef>${SECRET}</siri:RequestorRef>`, SECRET))
      .toBe('<siri:RequestorRef><RequestorRef></siri:RequestorRef>');
  });

  it('lässt Texte ohne das RequestorRef unverändert', () => {
    expect(redactSecret('HTTP 400 Bad Request', SECRET)).toBe('HTTP 400 Bad Request');
  });

  it('ersetzt jedes Vorkommen', () => {
    expect(redactSecret(`${SECRET} und ${SECRET}`, SECRET)).toBe('<RequestorRef> und <RequestorRef>');
  });

  it('behandelt fehlende Werte', () => {
    expect(redactSecret(undefined, SECRET)).toBeUndefined();
    expect(redactSecret('Text', undefined)).toBe('Text');
  });

  it('liefert über redactSecretText garantiert einen String', () => {
    expect(redactSecretText(`mit ${SECRET}`, SECRET)).toBe('mit <RequestorRef>');
  });
});

describe('Der Client gibt das RequestorRef nicht im Fehlerhinweis weiter', () => {
  let server: Server;
  let base: string;
  let body = '';

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'text/xml' });
      res.end(body);
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/trias`;
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

  it('redigiert ein Request-Echo der Schnittstelle', async () => {
    // Die Schnittstelle könnte den eigenen Request-Body zurückgeben.
    body = `<html><body>Echo: <siri:RequestorRef>${SECRET}</siri:RequestorRef></body></html>`;
    const cfg = { ...loadConfig(), requestorRef: SECRET, baseUrl: base, fallbackUrl: base };
    const client = new TriasClient(cfg, new Quota(100, 0.8));
    await expect(client.locationRequest('Göttingen', 'stop', 5)).rejects.toThrowError(
      expect.objectContaining({ hint: expect.not.stringContaining(SECRET) }) as never,
    );
  });

  it('behält den Fehlerhinweis ohne RequestorRef unverändert', async () => {
    body = '<html><body>HTTP/1.1 400 Bad Request</body></html>';
    const cfg = { ...loadConfig(), requestorRef: SECRET, baseUrl: base, fallbackUrl: base };
    const client = new TriasClient(cfg, new Quota(100, 0.8));
    try {
      await client.locationRequest('Göttingen', 'stop', 5);
      throw new Error('Es hätte ein Fehler geworfen werden müssen.');
    } catch (error) {
      const hint = (error as { hint?: string }).hint ?? '';
      expect(hint).toContain('400 Bad Request');
      expect(hint).not.toContain(SECRET);
    }
  });
});

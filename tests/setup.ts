import { beforeEach } from 'vitest';

/**
 * Gemeinsame Testumgebung.
 *
 * `loadConfig()` wirft einen `ConfigError`, wenn kein RequestorRef gesetzt ist.
 * Ohne diese Vorkonfiguration laufen die Tests nur, wenn im Arbeitsverzeichnis
 * eine echte `.env` liegt — das war weder hermetisch noch auf einem frischen
 * Clone reproduzierbar.
 *
 * Der hier gesetzte Wert ist ein Platzhalter: Kein Test spricht mit der echten
 * Schnittstelle, alle laufen gegen einen lokalen Fake-Server. Er überschreibt
 * deshalb auch einen echten RequestorRef aus der Umgebung.
 */
beforeEach(() => {
  process.env.RequestorRef = 'TEST-REF';
});

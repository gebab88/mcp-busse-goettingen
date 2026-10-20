import type { Config } from '../config.js';
import { EmptyResponseError, HttpError, ParseError, TimeoutError, redactSecret } from '../errors.js';
import { Quota } from '../quota.js';
import { buildLocationRequest, buildStopEventRequest, buildTripRequest } from './build.js';
import { parseLocations, parseStopEvents, parseTrips, parseTriasDocument, refPrefix, responseContainsRef } from './parse.js';
import type { RawDeparture, RawJourney } from './types.js';

export class TriasClient {
  private messageId = 0;

  constructor(private readonly cfg: Config, private readonly quota: Quota) {}

  private nextMessageId(): number { return ++this.messageId; }

  private async post(url: string, xml: string): Promise<string> {
    this.quota.consume();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Accept': 'text/xml' },
        body: xml,
        signal: controller.signal,
      });
      const body = await response.text().catch(() => '');
      if (response.status !== 200) {
        // Der Antworttext der Schnittstelle wird als Fehlerhinweis weitergegeben.
        // Er könnte den eigenen Request-Body und damit den RequestorRef enthalten —
        // deshalb wird er hier bereits redigiert.
        throw new HttpError(response.status, redactSecret(body.slice(0, 300), this.cfg.requestorRef) ?? '');
      }
      const trimmed = body.trim();
      if (trimmed === '') throw new EmptyResponseError();
      if (!trimmed.includes('<trias:Trias') && !trimmed.includes('<Trias')) throw new ParseError('Kein Trias-Wurzelelement.');
      return trimmed;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw new TimeoutError(this.cfg.timeoutMs);
      throw error;
    } finally { clearTimeout(timer); }
  }

  private async postWithFallback(xml: string): Promise<string> {
    try { return await this.post(this.cfg.baseUrl, xml); }
    catch (error: unknown) {
      const retryable = (error instanceof HttpError && error.status >= 500) || error instanceof TimeoutError;
      if (!retryable || this.cfg.fallbackUrl === this.cfg.baseUrl) throw error;
      return this.post(this.cfg.fallbackUrl, xml);
    }
  }

  async locationRequest(query: string, type: string, maxResults: number): Promise<{ locations: ReturnType<typeof parseLocations>; errorText?: string }> {
    const xml = buildLocationRequest({ requestorRef: this.cfg.requestorRef, language: this.cfg.language, query, type, maxResults, messageId: this.nextMessageId() });
    const response = await this.postWithFallback(xml);
    const doc = parseTriasDocument(response);
    const error = doc?.Trias?.ServiceDelivery?.DeliveryPayload?.LocationInformationResponse?.ErrorMessage;
    const text = error?.Text?.Text ?? error?.Text;
    return { locations: parseLocations(response), ...(text === undefined ? {} : { errorText: String(text) }) };
  }

  async stopEventRequest(stopPointRef: string, when: string, includeRealtime: boolean, locationName?: string): Promise<{ departures: RawDeparture[]; errorCode?: string; errorText?: string; dateOutOfRange: boolean; noEventFound: boolean; containsRequestedRef: boolean }> {
    const xml = buildStopEventRequest({ requestorRef: this.cfg.requestorRef, language: this.cfg.language, stopPointRef, when, includeRealtime, locationName, messageId: this.nextMessageId() });
    const response = await this.postWithFallback(xml);
    const parsed = parseStopEvents(response);
    return { ...parsed, containsRequestedRef: responseContainsRef(parseTriasDocument(response), refPrefix(stopPointRef)) };
  }

  async tripRequest(fromRef: string, toRef: string, when: string, maxResults: number, includeRealtime: boolean, fromName?: string, toName?: string): Promise<{ journeys: RawJourney[]; notripfound: boolean; errorText?: string; containsRequestedRef: boolean }> {
    const xml = buildTripRequest({ requestorRef: this.cfg.requestorRef, language: this.cfg.language, fromRef, toRef, when, maxResults, includeRealtime, fromName, toName, messageId: this.nextMessageId() });
    const response = await this.postWithFallback(xml);
    const doc = parseTriasDocument(response);
    const parsed = parseTrips(response);
    const refs = [refPrefix(fromRef), refPrefix(toRef)];
    return { ...parsed, containsRequestedRef: refs.every((prefix) => responseContainsRef(doc, prefix)) };
  }
}

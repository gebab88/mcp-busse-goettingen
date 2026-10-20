import { XMLParser } from 'fast-xml-parser';
import type { RawDeparture, RawJourney } from './types.js';

export interface ParsedLocation {
  stopPointRef: string;
  name: string;
  locality?: string;
  latitude?: number;
  longitude?: number;
  probability?: number;
  modes: string[];
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });

function toArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'Text' in value) return String(value.Text);
  return undefined;
}

function deliveryBody(doc: any): any {
  return doc?.Trias?.ServiceDelivery?.DeliveryPayload ?? {};
}

function durMinutes(value: unknown): number | undefined {
  const match = typeof value === 'string' ? value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/) : null;
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) + Number(match[3] ?? 0) / 60;
}

export function parseTriasDocument(xml: string): any {
  return parser.parse(xml);
}

export function parseLocations(xml: string): ParsedLocation[] {
  const response = deliveryBody(parseTriasDocument(xml)).LocationInformationResponse;
  return toArray(response?.LocationResult).map((result: any) => {
    const location = result?.Location ?? {};
    const stopPoint = location.StopPoint ?? {};
    const ref = String(stopPoint.StopPointRef ?? '');
    const geo = location.GeoPosition;
    const probability = result?.Probability === undefined ? undefined : Number(result.Probability);
    return {
      stopPointRef: ref,
      name: text(stopPoint.StopPointName) ?? ref,
      ...(text(location.LocationName) === undefined ? {} : { locality: text(location.LocationName) }),
      ...(geo?.Latitude === undefined ? {} : { latitude: Number(geo.Latitude) }),
      ...(geo?.Longitude === undefined ? {} : { longitude: Number(geo.Longitude) }),
      ...(probability === undefined ? {} : { probability }),
      modes: toArray(result?.Mode).map((mode: any) => String(mode?.PtMode ?? '')).filter(Boolean),
    };
  });
}

export function parseStopEvents(xml: string): {
  departures: RawDeparture[]; errorCode?: string; errorText?: string; dateOutOfRange: boolean; noEventFound: boolean;
} {
  const response = deliveryBody(parseTriasDocument(xml)).StopEventResponse;
  if (!response) return { departures: [], dateOutOfRange: false, noEventFound: false };
  const error = response.ErrorMessage;
  const errorCode = error?.Code === undefined ? undefined : String(error.Code);
  const errorText = text(error?.Text);
  const departures = toArray(response.StopEventResult).map((result: any): RawDeparture => {
    const stopEvent = result?.StopEvent ?? {};
    const call = stopEvent.ThisCall?.CallAtStop ?? {};
    const departure = call.ServiceDeparture ?? {};
    const service = stopEvent.Service ?? {};
    const section = service.ServiceSection ?? {};
    const mode = section.Mode ?? {};
    return {
      stopPointRef: call.StopPointRef,
      stopName: text(call.StopPointName),
      platform: text(call.PlannedBay),
      timetabledTime: String(departure.TimetabledTime ?? ''),
      estimatedTime: departure.EstimatedTime,
      line: text(section.PublishedLineName),
      mode: mode.PtMode,
      modeName: text(mode.Name),
      direction: section.DirectionRef,
      origin: text(service.OriginText),
      destination: text(service.DestinationText),
      tripCode: service.JourneyRef,
      cancelled: service.Cancellation === 'true' || call.Cancellation === 'true',
    };
  });
  return { departures, ...(errorCode === undefined ? {} : { errorCode }), ...(errorText === undefined ? {} : { errorText }), dateOutOfRange: errorText === 'STOPEVENT_DATEOUTOFRANGE', noEventFound: errorText === 'STOPEVENT_NOEVENTFOUND' };
}

export function parseTrips(xml: string): { journeys: RawJourney[]; notripfound: boolean } {
  const response = deliveryBody(parseTriasDocument(xml)).TripResponse;
  if (!response) return { journeys: [], notripfound: false };
  const errorText = text(response.ErrorMessage?.Text);
  const journeys = toArray(response.TripResult).map((result: any): RawJourney => {
    const trip = result?.Trip ?? {};
    const legs = toArray(trip.TripLeg).map((leg: any) => {
      const il = leg?.InterchangeLeg;
      const cl = leg?.ContinuousLeg;
      if (il || cl) {
        const value = il ?? cl;
        const kind: 'interchange' | 'continuous' = il ? 'interchange' : 'continuous';
        return { kind, origin: text(value.LegStart?.LocationName), destination: text(value.LegEnd?.LocationName), originStopPointRef: value.LegStart?.StopPointRef, destinationStopPointRef: value.LegEnd?.StopPointRef, departureTime: value.TimeWindowStart, arrivalTime: value.TimeWindowEnd, durationMinutes: durMinutes(value.Duration), intermediateStops: [] };
      }
      const timed = leg?.TimedLeg ?? {};
      const service = timed.Service ?? {};
      const section = service.ServiceSection ?? {};
      return { kind: 'timed' as const, line: text(section.PublishedLineName), mode: section.Mode?.PtMode, origin: text(timed.LegBoard?.StopPointName), destination: text(timed.LegAlight?.StopPointName), originStopPointRef: timed.LegBoard?.StopPointRef, destinationStopPointRef: timed.LegAlight?.StopPointRef, departureTime: timed.LegBoard?.ServiceDeparture?.TimetabledTime, arrivalTime: timed.LegAlight?.ServiceArrival?.TimetabledTime, platform: text(timed.LegBoard?.PlannedBay), intermediateStops: toArray(timed.IntermediateCall ?? timed.LegIntermediates).map((call: any) => ({ name: text(call.StopPointName) ?? '', arrivalTime: call.ServiceArrival?.TimetabledTime, departureTime: call.ServiceDeparture?.TimetabledTime })) };
    });
    return { startTime: trip.StartTime, endTime: trip.EndTime, durationMinutes: durMinutes(trip.Duration) ?? 0, interchanges: Number(trip.Interchanges ?? 0), legs };
  });
  return { journeys, notripfound: errorText === 'TRIP_NOTRIPFOUND' };
}

export function refPrefix(ref: string): string {
  return ref.match(/^([a-z]{2,4}:\d+:\d+)/)?.[1] ?? ref;
}

export function responseContainsRef(parsed: any, prefix: string): boolean {
  const body = deliveryBody(parsed);
  const refs: unknown[] = [];
  for (const result of toArray(body.StopEventResponse?.StopEventResult)) {
    const event = result?.StopEvent;
    refs.push(event?.ThisCall?.CallAtStop?.StopPointRef, event?.Service?.OriginStopPointRef, event?.Service?.DestinationStopPointRef);
  }
  for (const result of toArray(body.TripResponse?.TripResult)) {
    for (const wrapper of toArray(result?.Trip?.TripLeg)) {
      const timed = wrapper?.TimedLeg;
      const interchange = wrapper?.InterchangeLeg;
      const continuous = wrapper?.ContinuousLeg;
      refs.push(timed?.LegBoard?.StopPointRef, timed?.LegAlight?.StopPointRef, timed?.Service?.OriginStopPointRef, timed?.Service?.DestinationStopPointRef, interchange?.LegStart?.StopPointRef, interchange?.LegEnd?.StopPointRef, continuous?.LegStart?.StopPointRef, continuous?.LegEnd?.StopPointRef);
    }
  }
  return refs.some((ref) => typeof ref === 'string' && refPrefix(ref) === prefix);
}

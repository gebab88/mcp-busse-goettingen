export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function header(requestorRef: string, language: string, messageId: number): string {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Trias version="1.2" xmlns="http://www.vdv.de/trias" xmlns:siri="http://www.siri.org.uk/siri">` +
    '<ServiceRequest>' +
    `<siri:RequestTimestamp>${ts}</siri:RequestTimestamp>` +
    `<siri:RequestorRef>${escapeXml(requestorRef)}</siri:RequestorRef>` +
    `<siri:MessageIdentifier>${messageId}</siri:MessageIdentifier>` +
    '<RequestPayload>'
  );
}

export function footer(): string {
  return '</RequestPayload></ServiceRequest></Trias>';
}

export function buildLocationRequest(req: {
  requestorRef: string;
  language: string;
  query: string;
  type: string;
  maxResults: number;
  messageId: number;
}): string {
  return (
    header(req.requestorRef, req.language, req.messageId) +
    '<LocationInformationRequest>' +
    '<InitialInput>' +
    `<LocationName>${escapeXml(req.query)}</LocationName>` +
    '</InitialInput>' +
    '<Restrictions>' +
    `<Type>${escapeXml(req.type)}</Type>` +
    `<Language>${escapeXml(req.language)}</Language>` +
    `<NumberOfResults>${req.maxResults}</NumberOfResults>` +
    '<IncludePtModes>true</IncludePtModes>' +
    '</Restrictions>' +
    '</LocationInformationRequest>' +
    footer()
  );
}

export function buildStopEventRequest(req: {
  requestorRef: string;
  language: string;
  stopPointRef: string;
  locationName?: string;
  when: string;
  includeRealtime: boolean;
  messageId: number;
}): string {
  const locationName = req.locationName
    ? `<LocationName><Text>${escapeXml(req.locationName)}</Text></LocationName>`
    : '';
  return (
    header(req.requestorRef, req.language, req.messageId) +
    '<StopEventRequest>' +
    '<Location>' +
    '<LocationRef>' +
    `<StopPointRef>${escapeXml(req.stopPointRef)}</StopPointRef>` +
    locationName +
    '</LocationRef>' +
    `<DepArrTime>${escapeXml(req.when)}</DepArrTime>` +
    '</Location>' +
    '<Params>' +
    `<IncludeRealtimeData>${req.includeRealtime ? 'true' : 'false'}</IncludeRealtimeData>` +
    '</Params>' +
    '</StopEventRequest>' +
    footer()
  );
}

export function buildTripRequest(req: {
  requestorRef: string;
  language: string;
  fromRef: string;
  fromName?: string;
  toRef: string;
  toName?: string;
  when: string;
  maxResults: number;
  includeRealtime: boolean;
  messageId: number;
}): string {
  const fromName = req.fromName
    ? `<LocationName><Text>${escapeXml(req.fromName)}</Text></LocationName>`
    : '';
  const toName = req.toName
    ? `<LocationName><Text>${escapeXml(req.toName)}</Text></LocationName>`
    : '';
  return (
    header(req.requestorRef, req.language, req.messageId) +
    '<TripRequest>' +
    '<Origin>' +
    '<LocationRef>' +
    `<StopPointRef>${escapeXml(req.fromRef)}</StopPointRef>` +
    fromName +
    '</LocationRef>' +
    `<DepArrTime>${escapeXml(req.when)}</DepArrTime>` +
    '</Origin>' +
    '<Destination>' +
    '<LocationRef>' +
    `<StopPointRef>${escapeXml(req.toRef)}</StopPointRef>` +
    toName +
    '</LocationRef>' +
    '</Destination>' +
    '<Params>' +
    `<NumberOfResults>${req.maxResults}</NumberOfResults>` +
    '<AlgorithmType>minChanges</AlgorithmType>' +
    `<IncludeRealtimeData>${req.includeRealtime ? 'true' : 'false'}</IncludeRealtimeData>` +
    '</Params>' +
    '</TripRequest>' +
    footer()
  );
}
export type Confidence = 'low' | 'high' | 'certain';

export interface Stop {
  stopPointRef: string;
  name: string;
  locality?: string;
  latitude?: number;
  longitude?: number;
  probability?: number;
  confidence: Confidence;
  isLocal: boolean;
  modes: string[];
}

export interface ResolvedStop {
  query: string;
  requested?: { stopPointRef: string };
  chosen: Stop;
  alternatives: Stop[];
  note?: string;
}

export interface Departure {
  line?: string;
  mode?: string;
  modeName?: string;
  direction?: string;
  origin?: string;
  destination?: string;
  platform?: string;
  timetabledTime: string;
  timetabledTimeLocal: string;
  estimatedTime?: string;
  estimatedTimeLocal?: string;
  realtime: boolean;
  cancelled: boolean;
  tripCode?: string;
  stopPointRef?: string;
}

export interface Leg {
  kind: 'timed' | 'interchange' | 'continuous';
  line?: string;
  mode?: string;
  origin?: string;
  destination?: string;
  departureTime?: string;
  departureTimeLocal?: string;
  arrivalTime?: string;
  arrivalTimeLocal?: string;
  platform?: string;
  durationMinutes?: number;
  intermediateStops: { name: string; arrivalTime?: string; departureTime?: string }[];
}

export interface Journey {
  departureTime: string;
  departureTimeLocal: string;
  arrivalTime: string;
  arrivalTimeLocal: string;
  durationMinutes: number;
  interchanges: number;
  legs: Leg[];
}

export interface RawDeparture {
  stopPointRef?: string;
  stopName?: string;
  platform?: string;
  timetabledTime: string;
  estimatedTime?: string;
  line?: string;
  mode?: string;
  modeName?: string;
  direction?: string;
  origin?: string;
  destination?: string;
  tripCode?: string;
  cancelled: boolean;
}

export interface RawJourney {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  interchanges: number;
  legs: {
    kind: 'timed' | 'interchange' | 'continuous';
    line?: string;
    mode?: string;
    origin?: string;
    destination?: string;
    departureTime?: string;
    arrivalTime?: string;
    platform?: string;
    durationMinutes?: number;
    intermediateStops: { name: string; arrivalTime?: string; departureTime?: string }[];
  }[];
}
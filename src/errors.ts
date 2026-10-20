export type ErrorCode =
  | 'CONFIG'
  | 'VALIDATION'
  | 'HTTP'
  | 'EMPTY_RESPONSE'
  | 'PARSE'
  | 'API_ERROR'
  | 'NOT_FOUND'
  | 'TIMEOUT';

export class TriasError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = 'TriasError';
  }
}

export class ConfigError extends TriasError {
  constructor(message: string, hint?: string) {
    super('CONFIG', message, hint);
    this.name = 'ConfigError';
  }
}

export class ValidationError extends TriasError {
  constructor(message: string, hint?: string) {
    super('VALIDATION', message, hint);
    this.name = 'ValidationError';
  }
}

export class HttpError extends TriasError {
  constructor(readonly status: number, body: string) {
    const hint = body ? body.slice(0, 300) : undefined;
    super('HTTP', `Die Schnittstelle antwortete mit HTTP ${status}.`, hint);
    this.name = 'HttpError';
  }
}

export class EmptyResponseError extends TriasError {
  constructor() {
    super('EMPTY_RESPONSE', 'Die Schnittstelle hat eine leere Antwort geliefert — das deutet auf einen fehlerhaften Request hin.');
    this.name = 'EmptyResponseError';
  }
}

export class ParseError extends TriasError {
  constructor(detail?: string) {
    super('PARSE', 'Die Antwort der Schnittstelle konnte nicht gelesen werden.', detail);
    this.name = 'ParseError';
  }
}

export class ApiError extends TriasError {
  constructor(readonly apiCode: string, message: string) {
    super('API_ERROR', `Die Schnittstelle meldet einen Fehler: ${message}`);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends TriasError {
  constructor(message: string, hint?: string) {
    super('NOT_FOUND', message, hint);
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends TriasError {
  constructor(ms: number) {
    super('TIMEOUT', `Die Schnittstelle hat nach ${ms} ms nicht geantwortet.`);
    this.name = 'TimeoutError';
  }
}

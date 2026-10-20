import { describe, it, expect } from 'vitest';
import { NotFoundError, ConfigError } from '../src/errors.js';

describe('errors', () => {
  it('NotFoundError has code NOT_FOUND', () => {
    expect(new NotFoundError('x').code).toBe('NOT_FOUND');
  });

  it('ConfigError stores hint', () => {
    expect(new ConfigError('m', 'h').hint).toBe('h');
  });
});

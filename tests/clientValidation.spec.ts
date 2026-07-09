import {describe, expect, it} from 'vitest';
import {validationOk, validationReason} from '../src/client/validation';

describe('client validation helpers', () => {
  it('treats successful validations as enabled without a reason', () => {
    const validate = () => ({ok: true, errors: []});

    expect(validationReason(validate)).toBeUndefined();
    expect(validationOk(validate)).toBe(true);
  });

  it('joins validation errors into one display reason', () => {
    const validate = () => ({ok: false, errors: ['First error', 'Second error']});

    expect(validationReason(validate)).toBe('First error; Second error');
    expect(validationOk(validate)).toBe(false);
  });

  it('converts thrown rule exceptions into disabled reasons', () => {
    const validate = () => {
      throw new Error('Stale selected target');
    };

    expect(validationReason(validate)).toBe('Stale selected target');
    expect(validationOk(validate)).toBe(false);
  });

  it('uses a stable fallback for non-error thrown validation failures', () => {
    expect(validationReason(() => {
      throw '  String failure  ';
    })).toBe('String failure');
    expect(validationReason(() => {
      throw new Error('   ');
    })).toBe('Validation failed');
    expect(validationReason(() => {
      throw {message: 'internal shape'};
    })).toBe('Validation failed');
  });

  it('uses a stable fallback for malformed validation results', () => {
    expect(validationReason(() => ({ok: false, errors: []}))).toBe('Validation failed');
    expect(validationReason(() => ({ok: false, errors: [undefined, 'Rule failed', '   ']} as never))).toBe('Rule failed');
    expect(validationReason(() => undefined as never)).toBe('Validation failed');
    expect(validationOk(() => undefined as never)).toBe(false);
  });
});

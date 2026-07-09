import type {ValidationResult} from '../common/types';

function validationFallbackReason(value: unknown): string {
  if (value instanceof Error) {
    return value.message.trim() || 'Validation failed';
  }
  if (typeof value === 'string') {
    return value.trim() || 'Validation failed';
  }
  return 'Validation failed';
}

export function validationReason(validate: () => ValidationResult): string | undefined {
  try {
    const result = validate() as unknown;
    if (typeof result !== 'object' || result === null || !('ok' in result)) {
      return 'Validation failed';
    }
    if ((result as ValidationResult).ok === true) {
      return undefined;
    }
    const errors = Array.isArray((result as Partial<ValidationResult>).errors)
      ? (result as Partial<ValidationResult>).errors?.filter((error) => typeof error === 'string' && error.trim().length > 0)
      : [];
    return errors && errors.length > 0 ? errors.join('; ') : 'Validation failed';
  } catch (error) {
    return validationFallbackReason(error);
  }
}

export function validationOk(validate: () => ValidationResult): boolean {
  return validationReason(validate) === undefined;
}

/**
 * Custom error classes and error handling utilities
 */

/**
 * Base error class for all synth-related errors
 */
export class SynthError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'SynthError';
    Object.setPrototypeOf(this, SynthError.prototype);
  }
}

/**
 * Audio context initialization errors
 */
export class AudioContextError extends SynthError {
  constructor(message: string) {
    super(message, 'AUDIO_CONTEXT_ERROR');
    this.name = 'AudioContextError';
  }
}

/**
 * Pattern validation errors
 */
export class PatternError extends SynthError {
  constructor(message: string) {
    super(message, 'PATTERN_ERROR');
    this.name = 'PatternError';
  }
}

/**
 * Sample loading errors
 */
export class SampleError extends SynthError {
  constructor(message: string) {
    super(message, 'SAMPLE_ERROR');
    this.name = 'SampleError';
  }
}

/**
 * Parameter validation errors
 */
export class ValidationError extends SynthError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Creates a success result
 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Creates an error result
 */
export function Err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Wraps a function that might throw into a Result
 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn());
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wraps an async function that might throw into a Result
 */
export async function tryCatchAsync<T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return Ok(value);
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Logs error with context
 */
export function logError(
  error: Error,
  context?: string,
  metadata?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const errorInfo = {
    timestamp,
    context,
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...metadata,
  };

  console.error(`[${timestamp}] ${context || 'Error'}:`, errorInfo);
}

/**
 * Validates that a value is within a range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  field: string
): Result<number, ValidationError> {
  if (typeof value !== 'number' || isNaN(value)) {
    return Err(new ValidationError(`${field} must be a valid number`, field));
  }
  if (value < min || value > max) {
    return Err(
      new ValidationError(
        `${field} must be between ${min} and ${max}, got ${value}`,
        field
      )
    );
  }
  return Ok(value);
}

/**
 * Validates that a note string is valid
 */
export function validateNote(note: string): Result<string, ValidationError> {
  const noteRegex = /^([A-G]#?b?)(-?\d+)$/;
  if (!noteRegex.test(note)) {
    return Err(
      new ValidationError(
        `Invalid note format: ${note}. Expected format: C4, A#3, Bb5`,
        'note'
      )
    );
  }
  return Ok(note);
}

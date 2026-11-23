/** Stable, frontend-visible error thrown by real and mock PlatformClient implementations. */
export class PlatformClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "PlatformClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isPlatformClientError(value: unknown): value is PlatformClientError {
  return value instanceof PlatformClientError;
}

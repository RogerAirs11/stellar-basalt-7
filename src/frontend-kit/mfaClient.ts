import type { MfaClient, MfaCommandResponse, MfaStatus } from "../contracts/mfa";
import type { PlatformRequestOptions } from "../contracts/platform";
export function createMfaClient(io: {
  get<T>(url: string, options?: PlatformRequestOptions): Promise<T>;
  command<T extends MfaCommandResponse>(url: string, input: unknown, options?: PlatformRequestOptions): Promise<T>;
}): MfaClient {
  return {
    status: options => io.get<MfaStatus>("/api/auth/mfa/status", options),
    beginEnrollment: (input, options) => io.command("/api/auth/mfa/enroll", input, options),
    activate: (input, options) => io.command("/api/auth/mfa/activate", input, options),
    challenge: (input, options) => io.command("/api/auth/mfa/challenge", input, options),
    recover: (input, options) => io.command("/api/auth/mfa/recover", input, options),
    rotateRecoveryCodes: (input, options) => io.command("/api/auth/mfa/recovery-codes", input, options),
    disable: (input, options) => io.command("/api/auth/mfa/disable", input, options),
    cancelEnrollment: (input, options) => io.command("/api/auth/mfa/cancel", input, options),
  };
}

import type { PlatformPermission, PlatformRequestOptions, PlatformUser } from "./platform";

export type MfaPolicy = "disabled" | "optional" | "required";
export interface MfaStatus {
  available: boolean;
  policy: MfaPolicy;
  enrolled: boolean;
  factor_version: number;
  pending_enrollment: { id: string; expires_at: string } | null;
  verified_until: string | null;
  recovery_codes_remaining: number;
  recovery_replacement_until: string | null;
  recent_events: Array<{ id: string; event_type: string; created_at: string }>;
}
/** Successful commands rotate the current cookie and CSRF token. The SDK
 * publishes this session before returning the command result to the caller. */
export interface MfaCommandResponse {
  status: MfaStatus;
  user: PlatformUser;
  permissions: PlatformPermission[];
  csrfToken: string;
}
export interface MfaBeginInput {
  current_password: string;
  current_code?: string;
  expected_factor_version: number;
}
export interface MfaBeginResponse extends MfaCommandResponse {
  enrollment: { id: string; secret: string; otpauth_uri: string; expires_at: string };
}
export interface MfaActivateInput { enrollment_id: string; code: string; expected_factor_version: number }
export interface MfaCodesResponse extends MfaCommandResponse { recovery_codes: string[] }
export interface MfaFactorCommandInput { current_password: string; current_code: string; expected_factor_version: number }
export interface MfaClient {
  status(options?: PlatformRequestOptions): Promise<MfaStatus>;
  beginEnrollment(input: MfaBeginInput, options?: PlatformRequestOptions): Promise<MfaBeginResponse>;
  activate(input: MfaActivateInput, options?: PlatformRequestOptions): Promise<MfaCodesResponse>;
  challenge(input: { code: string }, options?: PlatformRequestOptions): Promise<MfaCommandResponse>;
  recover(input: { current_password: string; recovery_code: string }, options?: PlatformRequestOptions): Promise<MfaCommandResponse>;
  rotateRecoveryCodes(input: MfaFactorCommandInput, options?: PlatformRequestOptions): Promise<MfaCodesResponse>;
  disable(input: MfaFactorCommandInput, options?: PlatformRequestOptions): Promise<MfaCommandResponse>;
  cancelEnrollment(input: { enrollment_id: string; expected_factor_version: number }, options?: PlatformRequestOptions): Promise<MfaCommandResponse>;
}

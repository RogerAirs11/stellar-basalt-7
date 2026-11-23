import { gatewayConfigurationStatus } from "./zarinpal";

export interface TerminalReleasePolicy {
  version: "zarinpal-reversal-reviewed-v1";
  approvalRef: string;
  providerScopeHash: string;
  /** Local freshness limit, NOT a provider settlement guarantee. */
  maxEvidenceAgeMinutes: number;
}
export interface TerminalPolicyEnvironment {
  ZARINPAL_MERCHANT_ID?: string;
  ZARINPAL_BASE_URL?: string;
  ZARINPAL_APPROVED_ORIGINS?: string;
  PAYMENT_TERMINAL_RELEASE_ENABLED?: string;
  PAYMENT_TERMINAL_RELEASE_APPROVAL_REF?: string;
}
export function isTerminalReleasePolicy(value: TerminalReleasePolicy | undefined): value is TerminalReleasePolicy {
  return Boolean(value && value.version === "zarinpal-reversal-reviewed-v1"
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{11,199}$/.test(value.approvalRef)
    && /^[a-f0-9]{64}$/.test(value.providerScopeHash)
    && Number.isSafeInteger(value.maxEvidenceAgeMinutes) && value.maxEvidenceAgeMinutes >= 1 && value.maxEvidenceAgeMinutes <= 30);
}
/** No credential bytes are persisted. Changing gateway or merchant makes old
 * observations ineligible for release, rather than silently trusting them. */
export async function gatewayScopeHash(env: TerminalPolicyEnvironment): Promise<string | null> {
  const status = gatewayConfigurationStatus(env);
  if (!status.ok || !env.ZARINPAL_MERCHANT_ID?.trim()) return null;
  const scope = JSON.stringify(["zarinpal",status.configuredOrigin ?? "https://payment.zarinpal.com",env.ZARINPAL_MERCHANT_ID.trim()]);
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(scope));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
}
/** Deployment-owned approval, never accepted from the HTTP request body.
 * A reference is a governance record to verify, not proof of provider approval. */
export async function configuredTerminalReleasePolicy(env: TerminalPolicyEnvironment): Promise<TerminalReleasePolicy | undefined> {
  if (env.PAYMENT_TERMINAL_RELEASE_ENABLED !== "true") return undefined;
  const hash = await gatewayScopeHash(env);
  const candidate: TerminalReleasePolicy = {version:"zarinpal-reversal-reviewed-v1",approvalRef:env.PAYMENT_TERMINAL_RELEASE_APPROVAL_REF ?? "",providerScopeHash:hash ?? "",maxEvidenceAgeMinutes:15};
  return isTerminalReleasePolicy(candidate) ? candidate : undefined;
}

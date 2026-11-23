import { useCallback } from "react";
import { useDomainResource } from "./useDomainResource";
import { usePlatformCommand } from "./commandStatus";
import type {
  CredentialIssueInput,
  CredentialRevokeInput,
  CredentialSnapshotReviewResponse,
  CredentialSupersedeInput,
  CredentialVerificationResponse,
  HorseCredentialStoriesResponse,
  IssuerDirectoryRow,
  PlatformClient,
} from "../../contracts/platform";

/**
 * R117-16 (Master AI R117 handoff D24) — the ONE headless credential-stories
 * controller shared by every frontend. Renderer-agnostic; nothing here renders
 * and nothing here ever claims a demo badge implies real federation,
 * ownership or laboratory approval.
 *
 * Pinned behaviors (from the reviewed ticket):
 *  - READ is the PUBLIC per-horse projection: statement and field_scope are
 *    never present (scope_redacted); the scope note says so explicitly.
 *  - VERIFY is the PUBLIC verification: digest + markers only, honest states
 *    (current / expired / revoked / superseded / source_changed / …). A
 *    revocation or expiry changes the VISIBLE current status without ever
 *    rewriting the recorded snapshot (the digest stays comparable).
 *  - ISSUE is member-scoped: the server enforces the issuer's NARROW approved
 *    scope and the immutable snapshot semantics; the client never attaches a
 *    source version (the server derives it).
 *  - REVOKE/SUPERSEDE are issuer-owner / content-manager commands. A stale
 *    version refuses 409 — never a blind replay.
 *  - The full snapshot review stays PRIVATE (content managers + the issuer's
 *    active owner); a 403 for anyone else is shown as the honest boundary,
 *    never as "no snapshot exists".
 */

export interface CredentialStoriesPlatform {
  modules: {
    attestations: Pick<
      PlatformClient["modules"]["attestations"],
      "listIssuers" | "listHorseAttestations" | "verify" | "issue" | "revoke" | "supersede" | "reviewSnapshot"
    >;
  };
}

export type CredentialStoriesSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; rows: HorseCredentialStoriesResponse["attestations"]; truncated: boolean }
  | { phase: "empty" }
  | { phase: "forbidden" | "unavailable" | "error"; reason: string };

export type CredentialVerificationSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; verification: CredentialVerificationResponse }
  | { phase: "not_found" }
  | { phase: "forbidden" | "unavailable" | "error"; reason: string };

export type IssuerDirectorySnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; issuers: IssuerDirectoryRow[] }
  | { phase: "empty" }
  | { phase: "forbidden" | "unavailable" | "error"; reason: string };

/** Public per-horse credential rows. Public projection by construction —
 * the response carries no statement and no field scope. */
export function useHorseCredentialStories(options: {
  platform: CredentialStoriesPlatform | null;
  scope?: string;
  horseId: number | null;
}): { stories: CredentialStoriesSnapshot; retry: () => void } {
  const { platform, scope, horseId } = options;
  const identity = `${scope ?? "principal:unscoped"}|credential-stories|horse:${horseId ?? "none"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null || horseId == null)
      return Promise.resolve({ horse_id: horseId ?? 0, truncated: false, attestations: [] } as HorseCredentialStoriesResponse);
    return platform.modules.attestations.listHorseAttestations(horseId);
  }, [platform, horseId]);
  const state = useDomainResource<HorseCredentialStoriesResponse>(
    "credential-stories", identity, load,
    { isEmpty: (data) => (data.attestations?.length ?? 0) === 0, enabled: platform !== null && horseId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { stories: { phase: state.state.phase, rows: state.state.data.attestations ?? [], truncated: Boolean(state.state.data.truncated) }, retry: state.retry };
  if (state.state.phase === "empty") return { stories: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { stories: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { stories: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** Public verification of ONE attestation: the honest current state plus the
 * immutable snapshot's digest — never the snapshot bytes. */
export function useAttestationVerification(options: {
  platform: CredentialStoriesPlatform | null;
  scope?: string;
  attestationId: string | null;
}): { verification: CredentialVerificationSnapshot; retry: () => void } {
  const { platform, scope, attestationId } = options;
  const identity = `${scope ?? "principal:unscoped"}|credential-verify|attestation:${attestationId ?? "none"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null || attestationId == null) return Promise.resolve(null);
    return platform.modules.attestations.verify(attestationId);
  }, [platform, attestationId]);
  const state = useDomainResource<CredentialVerificationResponse | null>(
    "credential-verify", identity, load,
    { isEmpty: (data) => data === null, enabled: platform !== null && attestationId != null });
  if ((state.state.phase === "ready" || state.state.phase === "reloading") && state.state.data != null)
    return { verification: { phase: state.state.phase, verification: state.state.data }, retry: state.retry };
  if (state.state.phase === "empty") return { verification: { phase: "not_found" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { verification: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { verification: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** Public issuer directory (active issuers only — no membership data). */
export function useIssuerDirectory(options: {
  platform: CredentialStoriesPlatform | null;
  scope?: string;
}): { directory: IssuerDirectorySnapshot; retry: () => void } {
  const { platform, scope } = options;
  const identity = `${scope ?? "principal:unscoped"}|issuer-directory`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ issuers: [] as IssuerDirectoryRow[] });
    return platform.modules.attestations.listIssuers();
  }, [platform]);
  const state = useDomainResource<{ issuers: IssuerDirectoryRow[] }>(
    "issuer-directory", identity, load,
    { isEmpty: (data) => (data.issuers?.length ?? 0) === 0, enabled: platform !== null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { directory: { phase: state.state.phase, issuers: state.state.data.issuers ?? [] }, retry: state.retry };
  if (state.state.phase === "empty") return { directory: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { directory: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { directory: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** Lifecycle command slots. The server stays the authority on every write:
 * membership + narrow scope at issue time; issuer-owner / content-manager at
 * revoke/supersede time; CAS versions refuse stale writes with 409. */
export function useCredentialStoryCommands(scope: string | undefined) {
  const prefix = scope ?? "principal:unscoped";
  const issue = usePlatformCommand(`${prefix}|credential-issue`);
  const revoke = usePlatformCommand(`${prefix}|credential-revoke`);
  const supersede = usePlatformCommand(`${prefix}|credential-supersede`);
  const reviewSnapshot = usePlatformCommand(`${prefix}|credential-snapshot-review`);
  return { issue, revoke, supersede, reviewSnapshot };
}

export type CredentialSnapshotReviewOutcome =
  | { phase: "granted"; review: CredentialSnapshotReviewResponse }
  | { phase: "refused"; reason: string };

/** One-shot private snapshot review bound to a command slot. Returns the
 * honest outcome: granted for content managers / the issuer's active owner,
 * refused (403) for anyone else — the bytes stay private. */
export async function runSnapshotReview(
  platform: CredentialStoriesPlatform,
  attestationId: string,
): Promise<CredentialSnapshotReviewOutcome> {
  try {
    const review = await platform.modules.attestations.reviewSnapshot(attestationId);
    return { phase: "granted", review };
  } catch (error) {
    return { phase: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

export type { CredentialIssueInput, CredentialRevokeInput, CredentialSupersedeInput };

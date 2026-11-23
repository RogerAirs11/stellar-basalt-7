/**
 * R120 follow-on to the R119 remediation (IMP-009): the grant scope that
 * satisfies capability gates is ENVIRONMENT-BOUND, not a global constant.
 *
 * The R119 remediation correctly made demo grants unable to satisfy
 * production capability gates, but it did so by hard-coding
 * grant_scope='production' into every gate. That also made the ISOLATED
 * DEMO environment's own paid journeys meaningless: there the demo gateway
 * is the only provider (fail-closed to the strict local/synthetic triple),
 * so every entitlement it mints is scope='demo' — no gate could recognize
 * the demo plan it just sold. An expired demo plan could not make a
 * workspace read-only and a demo renewal could not restore writes, breaking
 * the honest expiry story the demo exists to demonstrate.
 *
 * The accepted scope therefore follows the SAME strict environment contract
 * as the demo gateway itself (isIsolatedDemoPaymentEnvironment):
 *   - isolated demo (APP_ENV=local + ISOLATED_DEMO_MODE=1 +
 *     REGISTRY_DATASET_KIND=synthetic): the demo database's plan IS
 *     scope='demo'; nothing else can exist there.
 *   - every other environment (production, test, unknown, partial flags):
 *     'production' only — demo and legacy_unclassified grants NEVER unlock
 *     capability, exactly as IMP-009 requires. A copied flag is not
 *     sufficient; all three markers must match, so a misconfigured
 *     production deployment still fails closed to production-only.
 */

import { isIsolatedDemoPaymentEnvironment } from "./payments/demoGateway";

export type AcceptedGrantScope = "demo" | "production";

export interface GrantScopeEnv {
  APP_ENV?: string;
  ISOLATED_DEMO_MODE?: string;
  REGISTRY_DATASET_KIND?: string;
  /** Structural tolerance so the full worker Env (and test env doubles)
   * satisfy this interface without redeclaring the demo triple. */
  [key: string]: unknown;
}

/** The grant scope whose entitlements may satisfy capability gates in this
 * request's environment. Never trusts a single flag: the demo answer needs
 * the full isolated-demo triple, everything else stays production-only. */
export function acceptedGrantScope(env: GrantScopeEnv): AcceptedGrantScope {
  return isIsolatedDemoPaymentEnvironment(env) ? "demo" : "production";
}

/** Quoted SQL literal for the fixed scope vocabulary. Never user input. */
export function grantScopeSqlLiteral(scope: AcceptedGrantScope): string {
  return scope === "demo" ? "'demo'" : "'production'";
}

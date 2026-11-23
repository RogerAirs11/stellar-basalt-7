/** Shared workspace semantics. Visual frontends stay independent of this policy.
 * Authorization is repeated INSIDE each actual write; a zero-row lock never
 * authorizes a later statement. Subscription expiry cannot block protective
 * revocation/archive actions or authorized reads/exports.
 */
import { CURRENT_MEMBERSHIP_PREDICATE } from '../organizations/membershipPolicy';
import { grantScopeSqlLiteral, type AcceptedGrantScope } from '../commerce/entitlementScope';

export type WorkspaceAction = 'view' | 'tasks_manage' | 'export' | 'manage';
export interface WorkspacePolicyOptions {
  allowExpiredProtection?: boolean;
  /** R120: the grant scope this environment's gates accept (IMP-009 follow-on).
   * Defaults to 'production' — demo grants unlock nothing outside the
   * isolated demo environment. */
  grantScope?: AcceptedGrantScope;
}

/** Correlated against workspace_collections AS wc. Only the farm SKU buys
 * farm capacity. A provider/advertising entitlement is not a workspace plan.
 * R120: scope-aware — the isolated demo environment recognizes its own
 * demo-scope plan (its only provider); every other environment accepts
 * production scope only, so a demo or legacy grant never keeps an org
 * writable (or locks it read-only) where it does not belong. */
export function workspaceWritableSql(scope: AcceptedGrantScope = 'production'): string {
  const s = grantScopeSqlLiteral(scope);
  return `(
  wc.organization_id IS NULL OR
  NOT EXISTS(SELECT 1 FROM entitlement_events ge
    WHERE ge.payer_organization_id=wc.organization_id AND ge.sku='farm_workspace_monthly'
      AND ge.kind IN ('grant','renewal') AND ge.grant_scope=${s}) OR
  EXISTS(SELECT 1 FROM entitlements e WHERE e.holder_key='org:'||CAST(wc.organization_id AS TEXT)
    AND e.sku='farm_workspace_monthly' AND e.grant_scope=${s} AND e.active=1
    AND (e.expires_at IS NULL OR datetime(e.expires_at)>datetime('now')))
)`;
}

export function workspaceAuthority(userId: string, action: WorkspaceAction,
  options: WorkspacePolicyOptions = {}): { sql: string; binds: unknown[] } {
  const staffBinds = action === 'manage' ? [] : [userId, `%,${action},%`];
  const normalized = "REPLACE(s.actions,' ','')";
  const staffSql = action === 'manage' ? '' : `
    OR EXISTS(SELECT 1 FROM workspace_staff_assignments s
      WHERE s.collection_id=wc.id AND s.user_id=? AND s.status='active'
        AND REPLACE(REPLACE(REPLACE(REPLACE(${normalized},'tasks_manage',''),'export',''),'view',''),',','')=''
        AND (','||${normalized}||',') LIKE ?)`;
  const write = (action === 'manage' || action === 'tasks_manage') && !options.allowExpiredProtection;
  const grantScope = options.grantScope ?? 'production';
  return {
    sql: `(EXISTS(SELECT 1 FROM users principal WHERE principal.id=? AND principal.is_active=1)
      AND ((wc.organization_id IS NULL AND wc.owner_user_id=?)
        OR (wc.organization_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
          WHERE m.organization_id=wc.organization_id AND m.user_id=? AND m.role IN ('owner','manager')
            AND ${CURRENT_MEMBERSHIP_PREDICATE})) ${staffSql})
      ${write ? `AND ${workspaceWritableSql(grantScope)}` : ''})`,
    binds: [userId, userId, userId, ...staffBinds],
  };
}

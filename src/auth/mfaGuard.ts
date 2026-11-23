import { HttpError } from "../api/http";
import { sqlMayWrite } from "../db/sqlLex";
import { PEDIGREE_GRAPH_LOCK_SQL } from "../registry/mutationStatements";
import type { MfaPolicy } from "../contracts/mfa";
import { getAuth, type AuthContext } from "./session";

type Viewer = { user: { id: string }; sessionId?: string; sessionTokenHash?: string; mfaPolicy?: MfaPolicy };
export interface MfaSqlPredicate { sql: string; bindings: Array<string | number> }
const policies = new WeakMap<object, MfaPolicy>();
export function mfaPolicyForDatabase(db: D1Database): MfaPolicy { return policies.get(db) ?? "optional"; }
export function mfaPolicy(value: unknown): MfaPolicy {
  if (value == null || value === "") return "optional";
  if (value === "disabled" || value === "optional" || value === "required") return value;
  throw new HttpError(503, "mfa_policy_unavailable", "Account verification policy is unavailable");
}
/** Request-local wrapper: configuration must never be mutable global user state. */
export function withMfaPolicy(db: D1Database, policy: MfaPolicy): D1Database {
  const wrapped = new Proxy(db, { get(target, property) { const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value; } });
  policies.set(wrapped, policy); return wrapped;
}
/** A disabled configuration cannot bypass an already enrolled factor. An
 * assurance is bound to the observed bearer as well as the session and factor
 * version, so a request holding an old cookie cannot inherit a later step-up. */
export function mfaAuthorizationPredicate(viewer: Viewer | null | undefined): MfaSqlPredicate {
  if (!viewer?.user?.id) return { sql: "0=1", bindings: [] };
  return {
    sql: `((?<> 'required' AND NOT EXISTS(SELECT 1 FROM auth_mfa_factors mf WHERE mf.user_id=? AND mf.secret_ciphertext IS NOT NULL))
      OR EXISTS(SELECT 1 FROM auth_mfa_factors mf
        JOIN auth_mfa_session_assurance ma ON ma.user_id=mf.user_id AND ma.factor_version=mf.factor_version
        JOIN sessions ms ON ms.id=ma.session_id AND ms.user_id=ma.user_id AND ms.token_hash=ma.token_hash
        JOIN users mu ON mu.id=ms.user_id
        WHERE mf.user_id=? AND mf.secret_ciphertext IS NOT NULL AND ma.session_id=? AND ma.token_hash=?
          AND datetime(ma.expires_at)>CURRENT_TIMESTAMP AND datetime(ms.expires_at)>CURRENT_TIMESTAMP AND mu.is_active=1))`,
    bindings: [viewer.mfaPolicy ?? "optional", viewer.user.id, viewer.user.id, viewer.sessionId ?? "", viewer.sessionTokenHash ?? ""],
  };
}
export function currentMfaSessionPredicate(auth: AuthContext): MfaSqlPredicate {
  return { sql: `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.token_hash=? AND s.csrf_token=? AND datetime(s.expires_at)>CURRENT_TIMESTAMP AND u.is_active=1)`,
    bindings: [auth.sessionId, auth.user.id, auth.sessionTokenHash ?? "", auth.csrfToken] };
}
export function mfaConstraintFailure(cause: unknown): boolean {
  const error = cause as { constraint?: unknown; message?: unknown; cause?: unknown } | null;
  return /auth_mfa_authority_current/.test(String(error?.constraint ?? "")) || /auth_mfa_authority_current/.test(String(error?.message ?? ""))
    || Boolean(error?.cause && error.cause !== cause && mfaConstraintFailure(error.cause));
}
export function mfaLockStatements(db: D1Database, auth: AuthContext): D1PreparedStatement[] {
  // Factor -> user -> session is also used by factor commands. The separate
  // check statement obtains a fresh PostgreSQL READ COMMITTED snapshot after
  // any lock wait; SQLite serializes the complete write batch.
  return [db.prepare("UPDATE auth_mfa_factors SET factor_version=factor_version WHERE user_id=?").bind(auth.user.id),
    db.prepare("UPDATE users SET is_active=is_active WHERE id=?").bind(auth.user.id),
    db.prepare("UPDATE sessions SET csrf_token=csrf_token WHERE id=?").bind(auth.sessionId)];
}
export function mfaCheckStatement(db: D1Database, operationId: string, checks: MfaSqlPredicate[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO auth_mfa_commit_checks(id,ok) VALUES(?,CASE WHEN ${checks.map(check => `(${check.sql})`).join(" AND ")} THEN 1 ELSE 0 END)`)
    .bind(operationId, ...checks.flatMap(check => check.bindings));
}
export async function requireMfaAssurance(db: D1Database, auth: AuthContext): Promise<void> {
  const guard = mfaAuthorizationPredicate(auth);
  if (!await db.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).bind(...guard.bindings).first()) {
    throw new HttpError(403, "mfa_step_up_required", "Set up or verify your authenticator in Account security before completing this action");
  }
}

/** Preserve the native adapter and result indexes. Every mutating statement
 * (including RETURNING through first/all) is inside the same authority-checked
 * transaction as its business mutation. Privileged reads opt into the same
 * guard; private genetic and care projections also bind scope in their SQL. */
export function withMfaMutationGuard(db: D1Database, auth: AuthContext, guardReads = false): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();
  const statementsSql = new WeakMap<object, string>();
  const runBatch = async (statements: D1PreparedStatement[]): Promise<D1Result[]> => {
    const raw = statements.map(statement => originals.get(statement) ?? statement);
    const operationId = crypto.randomUUID();
    const prefix = [...mfaLockStatements(db, auth), mfaCheckStatement(db, operationId, [currentMfaSessionPredicate(auth), mfaAuthorizationPredicate(auth)])];
    try {
      // The PostgreSQL adapter recognizes its advisory-lock marker only in
      // position zero. Preserve graph -> MFA -> policy/subject lock ordering
      // AND the caller's original result positions when adding authority checks.
      const firstSql = statements[0] ? statementsSql.get(statements[0]) ?? (raw[0] as unknown as { sql?: string })?.sql : undefined;
      const graphFirst = firstSql === PEDIGREE_GRAPH_LOCK_SQL;
      const results = await db.batch([...(graphFirst ? [raw[0]!] : []), ...prefix, ...(graphFirst ? raw.slice(1) : raw),
        db.prepare("DELETE FROM auth_mfa_commit_checks WHERE id=?").bind(operationId)]);
      if (graphFirst) return [results[0]!, ...results.slice(prefix.length + 1, prefix.length + raw.length)];
      return results.slice(prefix.length, prefix.length + raw.length);
    } catch (cause) {
      if (mfaConstraintFailure(cause)) throw new HttpError(403, "mfa_step_up_required", "Verify your authenticator again before completing this action");
      throw cause;
    }
  };
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") return (...bindings: unknown[]) => wrap(target.bind(...bindings), sql);
        if (["run", "all", "first", "raw"].includes(String(property)) && (guardReads || sqlMayWrite(sql))) return async (argument?: string | { columnNames?: boolean }) => {
          const result = (await runBatch([target]))[0]!;
          if (property === "first") { const row = result.results?.[0] as Record<string, unknown> | undefined; return typeof argument === "string" ? row?.[argument] ?? null : row ?? null; }
          if (property === "raw") { const rows = (result.results ?? []) as Record<string, unknown>[]; const columns = Object.keys(rows[0] ?? {}); return [...(typeof argument === "object" && argument.columnNames ? [columns] : []), ...rows.map(row => columns.map(column => row[column]))]; }
          return result;
        };
        const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement); statementsSql.set(proxy, sql); return proxy;
  };
  const wrapped = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
    if (property === "batch") return (statements: D1PreparedStatement[]) => {
      // Unknown statements are treated as writes, never assumed read-only.
      if (guardReads || statements.some(statement => !statementsSql.has(statement) || sqlMayWrite(statementsSql.get(statement)!))) return runBatch(statements);
      return target.batch(statements.map(statement => originals.get(statement) ?? statement));
    };
    if (property === "exec" || property === "dump" || property === "withSession") return () => { throw new HttpError(503, "mfa_unguarded_database_operation", "This operation requires a supported guarded database transaction"); };
    if (property === "__horseDbWithAiReservation") {
      const reserve = Reflect.get(target, property, target) as ((work: (scoped: D1Database) => Promise<unknown>) => Promise<unknown>) | undefined;
      return reserve ? (work: (scoped: D1Database) => Promise<unknown>) => reserve.call(target, scoped => work(withMfaMutationGuard(scoped, auth, guardReads))) : undefined;
    }
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  policies.set(wrapped, auth.mfaPolicy ?? "optional"); return wrapped;
}

export async function guardMfaRequest(request: Request, db: D1Database, cookieName: string): Promise<D1Database> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/auth/") && !["/api/auth/change-password", "/api/auth/sessions/revoke"].includes(path)) return db;
  const write = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  const privateRead = !write && (path.startsWith("/api/admin/") || /\/care\/(clinical|reproduction|samples|reports)/.test(path)
    || ["/api/registry/export", "/api/search/exact-identifier", "/api/audit"].includes(path));
  if (!write && !privateRead) return db;
  const auth = await getAuth(db, request, cookieName);
  if (!auth) return db; // Existing route-specific authentication remains authoritative.
  await requireMfaAssurance(db, auth);
  return withMfaMutationGuard(db, auth, privateRead);
}

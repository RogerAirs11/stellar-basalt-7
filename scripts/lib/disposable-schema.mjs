import { randomUUID } from 'node:crypto';

/** Never sanitize an unsafe name into a different destructive target. */
export function disposableSchemaName(requested) {
  if (requested === undefined || requested === '') return `hr_test_${randomUUID().replaceAll('-', '')}`;
  if (!/^hr_test_[a-z0-9_]{1,48}$/.test(requested)) {
    throw new Error('Disposable schema must start with hr_test_ and use lowercase ASCII letters, digits, and underscores (max 56 characters). public and system schemas are forbidden.');
  }
  return requested;
}

/** CREATE without IF NOT EXISTS is essential: a collision must fail closed.
 * The caller may DROP only after this CREATE succeeds on its own connection. */
export async function createOwnedSchema(sql, name) {
  const schema = disposableSchemaName(name);
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  return schema;
}

/** The DDL gate still operates in the database default schema. Only allow a
 * deliberately disposable local CI database, never a copied production URL. */
export function requireDisposableLocalDatabase(connectionString, acknowledgement) {
  const target = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(target.hostname)
      || acknowledgement !== 'yes') {
    throw new Error('DDL parity requires a disposable local PostgreSQL and PG_PARITY_DISPOSABLE=yes. Never use production credentials.');
  }
}

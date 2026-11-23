# Supabase request-scope R4 type fix — 2026-09-10

R4 validation caught a TypeScript-only assignment mismatch in `src/worker.ts`:
`resolveReadFallbackAfterFailure()` returns `Env | null`, while the local cleanup holder is `Env | undefined`.

The runtime logic was already correct; the source now narrows the nullable result before assigning it to `fallbackEnv`:

1. resolve to a temporary `resolvedFallback`;
2. throw the original request failure if it is null;
3. assign only the narrowed `Env` value to `fallbackEnv`.

No provider semantics, SQL, database data, failover policy, or request-scoped Supabase lifecycle behavior changed.

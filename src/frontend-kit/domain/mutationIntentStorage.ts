export const MUTATION_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
export const MUTATION_INTENT_PREFIX = "hr-intent:v1:";

/** Coarse, non-sensitive summary values only — never raw payload text. */
export type MutationIntentSummary = Record<string, string | number | boolean>;

export interface MutationIntentRecord {
  key: string;
  scope: string;
  workflow: string;
  resource: string;
  summary: MutationIntentSummary;
  phase: "pending" | "submitted";
  createdAt: string;
  updatedAt: string;
}

export type MutationIntentPhase =
  | "idle"
  | "pending"
  | "submitted"
  | "confirmed"
  | "unknown"
  | "expired";

export interface MutationIntentSnapshot {
  phase: MutationIntentPhase;
  durable: boolean;
  record: MutationIntentRecord | null;
  /** Present on confirmed: the server's request id for the banner. */
  requestId: number | null;
  /** Present on unknown: why certainty is unavailable (honest, bounded). */
  unknownReason: string | null;
  reconciling: boolean;
}

export interface IntentStorage {
  durable: boolean;
  load(scope: string, workflow: string, resource: string): MutationIntentRecord | null;
  save(record: MutationIntentRecord): void;
  clear(scope: string, workflow: string, resource: string, expectedKey?: string): void;
  /** Cross-account deletion: drop every intent record not owned by `scope`. */
  sweepForeignScopes(scope: string): void;
}

const memoryStore = new Map<string, MutationIntentRecord>();
const MAX_RECORD_CHARACTERS = 8192;
const SUMMARY_FIELDS = new Set(["workflow", "category", "provider_person_id", "share_contact", "note_length"]);

function intentStorageKey(scope: string, workflow: string, resource: string): string {
  return `${MUTATION_INTENT_PREFIX}${encodeURIComponent(scope)}|${encodeURIComponent(workflow)}|${encodeURIComponent(resource)}`;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

/** Browser storage is untrusted. Do not deserialize arbitrary private payloads. */
function parseRecord(raw: string): MutationIntentRecord | null {
  if (raw.length > MAX_RECORD_CHARACTERS) return null;
  try {
    const value = JSON.parse(raw) as MutationIntentRecord;
    const fields = new Set(["key", "scope", "workflow", "resource", "summary", "phase", "createdAt", "updatedAt"]);
    if (!value || typeof value !== "object" || Object.keys(value).some(key => !fields.has(key))) return null;
    if (!boundedText(value?.key, 128) || !boundedText(value.scope, 4096)
      || !boundedText(value.workflow, 80) || !boundedText(value.resource, 256)
      || (value.phase !== "pending" && value.phase !== "submitted")
      || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
      || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
      || !value.summary || typeof value.summary !== "object" || Array.isArray(value.summary)) return null;
    for (const [field, item] of Object.entries(value.summary)) {
      if (!SUMMARY_FIELDS.has(field)) return null;
      if ((field === "workflow" || field === "category") && !boundedText(item, 80)) return null;
      if (field === "provider_person_id" && (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0)) return null;
      if (field === "note_length" && (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0 || item > 2000)) return null;
      if (field === "share_contact" && typeof item !== "boolean") return null;
    }
    return value;
  } catch { return null; }
}

/**
 * Probe and every later operation may fail independently. Keep a minimal memory
 * mirror and expose durability as a live property, not a startup-time promise.
 */
export function openIntentStorage(): IntentStorage {
  let backing: Storage | null = null;
  let durable = false;
  try {
    if (typeof localStorage !== "undefined") {
      backing = localStorage;
      const probe = `${MUTATION_INTENT_PREFIX}probe`;
      backing.setItem(probe, "1");
      backing.removeItem(probe);
      durable = true;
    }
  } catch { durable = false; }
  const remove = (key: string) => {
    try { backing?.removeItem(key); } catch { durable = false; }
    memoryStore.delete(key);
  };
  return {
    get durable() { return durable; },
    load(scope, workflow, resource) {
      const key = intentStorageKey(scope, workflow, resource);
      let record: MutationIntentRecord | null = null;
      if (durable && backing) {
        try {
          const raw = backing.getItem(key);
          if (raw === null) { memoryStore.delete(key); return null; }
          record = parseRecord(raw);
          if (!record) { remove(key); return null; }
        } catch { durable = false; }
      }
      record ??= memoryStore.get(key) ?? null;
      if (record && (record.scope !== scope || record.workflow !== workflow || record.resource !== resource)) {
        remove(key); return null;
      }
      if (record) memoryStore.set(key, record);
      return record;
    },
    save(record) {
      const raw = JSON.stringify(record);
      const validated = parseRecord(raw);
      if (!validated) throw new Error("Intent recovery metadata failed validation");
      const key = intentStorageKey(record.scope, record.workflow, record.resource);
      memoryStore.set(key, validated);
      try { if (durable && backing) backing.setItem(key, raw); } catch { durable = false; }
    },
    clear(scope, workflow, resource, expectedKey) {
      const key = intentStorageKey(scope, workflow, resource);
      if (expectedKey !== undefined) {
        const current = this.load(scope, workflow, resource);
        if (current && current.key !== expectedKey) return;
      }
      remove(key);
    },
    sweepForeignScopes(scope) {
      const mine = `${MUTATION_INTENT_PREFIX}${encodeURIComponent(scope)}|`;
      const foreign = (key: string) => key.startsWith(MUTATION_INTENT_PREFIX) && (scope === "anonymous" || !key.startsWith(mine));
      try {
        if (backing) {
          const doomed: string[] = [];
          for (let i = 0; i < backing.length; i++) {
            const key = backing.key(i);
            if (key !== null && foreign(key)) doomed.push(key);
          }
          for (const key of doomed) remove(key);
        }
      } catch { durable = false; }
      for (const key of [...memoryStore.keys()]) if (foreign(key)) memoryStore.delete(key);
    },
  };
}

export function isIntentExpired(record: MutationIntentRecord, now = Date.now()): boolean {
  const created = Date.parse(record.createdAt);
  return !Number.isFinite(created) || created > now + 5 * 60_000 || now - created > MUTATION_INTENT_TTL_MS;
}

/**
 * R95-N10: vendor callback envelope adapters.
 *
 * The custom HMAC bridge (x-signature = HMAC(secret, provider:rawBody))
 * stays the AUTHENTICATION layer — every callback must pass it (or, when a
 * vendor documents its own signature scheme and the owner enables that
 * vendor, that scheme instead; none is enabled yet, honestly). What the
 * bridge carried before N10 was ONE hard-coded envelope shape. Real vendors
 * post different envelopes, so each supported vendor gets a PURE translation
 * to the narrow internal event:
 *
 *   { provider, providerMessageId, eventKey | null, occurredAt | null,
 *     delivery: "delivered" | "not_delivered" | "intermediate" }
 *
 * The internal event is the ONLY thing the recording path
 * (recordDeliveryCallback in outbox.ts) consumes. Bounded raw evidence (the
 * payload hash) is stored under the existing retention-controlled
 * notification_callbacks row; raw bodies are never persisted.
 *
 * Envelope shapes (documented vendor contracts; status vocabularies are
 * translated, never guessed):
 *  - kavenegar (SMS): JSON or form-encoded delivery reports with
 *    messageid + status (numeric strings). Documented statuses: 5 = delivered
 *    to recipient, 6 = not delivered, 1/2/3/4/7... = intermediate operator
 *    states (acceptance/queueing). Only 5 becomes delivered; only 6 becomes
 *    not_delivered; everything else stays intermediate (never a delivery
 *    fact).
 *  - The platform bridge envelope (default for any other provider name,
 *    including email relays): { event_key?, provider_message_id | messageId,
 *    status | event } — the pre-N10 shape, still supported verbatim.
 */

export type VendorDelivery = "delivered" | "not_delivered" | "intermediate";

export interface InternalCallbackEvent {
  provider: string;
  providerMessageId: string;
  eventKey: string | null;
  occurredAt: string | null;
  delivery: VendorDelivery;
}

export type AdapterResult =
  | { ok: true; event: InternalCallbackEvent }
  | { ok: false; reason: "unparseable" | "missing_message_id" };

/** Parse a body that may be JSON or urlencoded form fields. */
export function parseCallbackEnvelope(rawBody: string): Record<string, unknown> | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  // urlencoded: a=1&b=2 (values percent-decoded; repeated keys keep the last)
  const fields: Record<string, unknown> = {};
  for (const pair of trimmed.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) return null;
    const key = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, " "));
    const value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    fields[key] = value;
  }
  return Object.keys(fields).length ? fields : null;
}

function asString(value: unknown, max: number): string | null {
  if (typeof value === "string" && value.length > 0 && value.length <= max) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

/** Kavenegar numeric status translation (documented vocabulary). */
export function kavenegarDelivery(status: string): VendorDelivery {
  if (status === "5") return "delivered";
  if (status === "6") return "not_delivered";
  return "intermediate"; // 1,2,3,4,7...: operator/queue states — never a delivery fact
}

/** Translate one vendor envelope into the narrow internal event.
 * Known vendors get their documented envelope translation; every other
 * provider name speaks the platform's OWN bridge envelope (the HMAC relay is
 * provider-agnostic by design — it fronts whichever send provider the drain
 * used, and the signature already authenticated it). An envelope that fits
 * no known shape is an honest refusal, never a guessed delivery. */
export function translateVendorCallback(provider: string, rawBody: string): AdapterResult {
  const envelope = parseCallbackEnvelope(rawBody);
  if (!envelope) return { ok: false, reason: "unparseable" };
  if (provider === "kavenegar") {
    const messageId = asString(envelope.messageid ?? envelope.messageId, 200);
    if (!messageId) return { ok: false, reason: "missing_message_id" };
    const status = asString(envelope.status, 10);
    return {
      ok: true,
      event: {
        provider,
        providerMessageId: messageId,
        eventKey: asString(envelope.event_key, 190),
        occurredAt: asString(envelope.occurred_at ?? envelope.date, 40),
        delivery: status ? kavenegarDelivery(status) : "intermediate",
      },
    };
  }
  // The platform bridge envelope (also used by email relays that forward it):
  // { event_key?, provider_message_id | messageId, status | event }.
  const messageId = asString(envelope.provider_message_id ?? envelope.messageId ?? envelope.messageid, 200);
  if (!messageId) return { ok: false, reason: "missing_message_id" };
  const status = asString(envelope.status ?? envelope.event, 40);
  let delivery: VendorDelivery = "intermediate";
  if (status === "delivered" || status === "delivery") delivery = "delivered";
  else if (status === "not_delivered" || status === "bounce" || status === "dropped" || status === "failed") delivery = "not_delivered";
  return {
    ok: true,
    event: {
      provider,
      providerMessageId: messageId,
      eventKey: asString(envelope.event_key ?? envelope.eventKey, 190),
      occurredAt: asString(envelope.occurred_at ?? envelope.timestamp, 40),
      delivery,
    },
  };
}

/** Vendors with a dedicated (non-bridge) envelope translation. */
export const SUPPORTED_CALLBACK_PROVIDERS: readonly string[] = ["kavenegar"];

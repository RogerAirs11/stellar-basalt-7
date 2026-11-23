interface Env {
  /** Explicit dataset declaration; a small database is not necessarily synthetic. */
  REGISTRY_DATASET_KIND?: string;
  /** Set only by the loopback adapter after validating the synthetic marker. */
  ISOLATED_DEMO_MODE?: string;
  REGISTRY_WRITE_POLICY?: string;
  BILLING_LIVE_PAYMENTS_ENABLED?: string;
  PAYMENT_TERMINAL_RELEASE_ENABLED?: string;
  PAYMENT_TERMINAL_RELEASE_APPROVAL_REF?: string;
  /** R98-N10 demonstration payment gateway. Enables the demo provider ONLY
   *  when no real merchant is configured — simulated settlement, no real
   *  charge. The real gateway's fail-closed behavior is untouched. */
  DEMO_PAYMENTS_ENABLED?: string;
  /** R98-N11 demonstration email provider (loopback). Enables recorded —
   *  never transmitted — deliveries through the real drain pipeline ONLY
   *  when no real email provider is configured. */
  DEMO_NOTIFICATIONS_ENABLED?: string;
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  /** Private care intake is disabled by default. Production activation requires an independently approved agreement. */
  EQUINE_CARE_MODE?: "disabled" | "local_review" | "approved_production";
  EQUINE_CARE_AGREEMENT_REF?: string;
  SESSION_COOKIE_NAME: string;
  /** Optional is compatible with unenrolled accounts; enrolled accounts always require step-up. */
  MFA_MODE?: "disabled" | "optional" | "required";
  /** Worker secret: {active_key_id,keys:{keyId:base64_32_byte_AES_key}}. Never expose to the browser. */
  MFA_KEYRING_JSON?: string;
  SOURCE_FINGERPRINT?: string;
  PUBLIC_RATE_LIMITER?: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  EXPENSIVE_RATE_LIMITER?: RateLimit;
  WRITE_RATE_LIMITER?: RateLimit;
  ACCOUNT_RATE_LIMITER?: RateLimit;
  /** Fixed-persona sign-in is available only in a marked, isolated local synthetic environment. */
  ENABLE_DEMO_ADMIN_LOGIN?: string;
  /** Server-side Gemini API key. Never expose to browser bundles. */
  GEMINI_API_KEY?: string;
  /** Additional server-side Gemini API keys (comma or newline separated) used for rate-limit rotation. */
  GEMINI_API_KEYS?: string;
  /** Base-URL override for the classic Gemini API (GEMINI_BASE_URL) — e.g. a
   *  Cloudflare AI Gateway (…/google-ai-studio/v1beta) whose egress region is not
   *  geo-blocked by Google, so the AIza key ring works from any visitor region.
   *  Ignored while the GEMINI_RELAY Durable Object is active (relay wins). */
  GEMINI_BASE_URL?: string;
  /** Durable Object that relays classic Gemini requests through a US-East
   *  egress, defeating Google's IP-region block deterministically. Active
   *  whenever the binding exists; GEMINI_RELAY_ENABLED="0" is the kill switch. */
  GEMINI_RELAY?: DurableObjectNamespace;
  GEMINI_RELAY_ENABLED?: string;
  /** Vertex AI Express ("AQ.") keys only join the Gemini ring when this is "1".
   *  Off by default: the owner declines to enable the Agent Platform API, and
   *  a Vertex fallback that always fails poisons key rotation with the
   *  "enable the API" wall. */
  AI_VERTEX_EXPRESS_ENABLED?: string;
  /** Bearer token guarding GET /api/ai/diagnostics (operator-only; unset hides the route). */
  AI_DIAG_TOKEN?: string;
  DEEPSEEK_API_KEY?: string;
  /** Runtime-preserved canonical D1 authority for authentication/session reads. Not a separate deployment requirement. */
  AUTH_DB?: D1Database;
  /** Optional dedicated writable D1 for AI session/usage state. Otherwise routing pins the original D1 binding before selecting a canonical read provider. */
  AI_DB?: D1Database;
  /** R59: HMAC key for OTP code hashes (worker secret). */
  OTP_HASH_SECRET?: string;
  /** R88 P09: HMAC key signing short-lived media access tokens (worker secret).
   *  Unset = the mint endpoint fails closed (503) and the session read path
   *  keeps working; tokens can never be minted or verified without it. */
  MEDIA_ACCESS_TOKEN_SECRET?: string;
  /** T13: Kavenegar SMS delivery (owner-gated). Both values must be set for the
   *  provider to activate; the template must be an approved "verification"
   *  template on the owner's account. Unset = OTP stays honestly unavailable
   *  in production (503) with local dev demo mode unchanged. */
  KAVENEGAR_API_KEY?: string;
  KAVENEGAR_OTP_TEMPLATE?: string;
  /** T13: generic HTTPS email API (owner-gated; Workers cannot do raw SMTP).
   *  All three values must be set for email delivery to activate; unset keeps
   *  the honest "delivery not configured" responses everywhere. */
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Public base URL used inside emailed action links (e.g. https://registry.example). */
  EMAIL_PUBLIC_BASE_URL?: string;
  /** turn-33 cache-warm origin (scheduled handler fetches hot anonymous reads
   *  through the public request path). Defaults to https://iraho.ir. */
  SITE_ORIGIN?: string;
  /** turn-33: set to "1" to disable the scheduled cache-warm pass. */
  CACHE_WARM_DISABLED?: string;
  /** R88 P18: Zarinpal merchant UUID (owner-gated). Unset = the pay endpoint
   *  fails closed (503) and NO payment attempt is created — the billing phase
   *  stays honestly read-only. Amounts on the wire are RIAL integers (the
   *  internal unit), never converted. */
  ZARINPAL_MERCHANT_ID?: string;
  /** Optional sandbox/base URL override for the Zarinpal gateway. */
  ZARINPAL_BASE_URL?: string;
  /** R95-N05: comma-separated ADDITIONAL approved gateway origins (clean
   *  https:// origins only, e.g. an authorized bank-test mirror). The default
   *  approved list is the official live + sandbox Zarinpal origins; anything
   *  else fails closed at provider-resolution time. */
  ZARINPAL_APPROVED_ORIGINS?: string;
  /** Public base URL the gateway redirects buyers back to. */
  PAYMENT_CALLBACK_BASE_URL?: string;
  /** R95-N06: owner/accountant proration policy switch. Unset = partially
   *  consumed refund requests stay 'requested' (approval fails closed);
   *  "true" = operators may approve partial_consumed refunds. */
  REFUND_PARTIAL_POLICY_ENABLED?: string;
  /** R88 P13: HMAC-SHA256 key verifying provider delivery callbacks
   *  (POST /api/notifications/callback/:provider, x-signature header over
   *  provider:rawBody). Unset = callbacks fail closed (401 + rejected log,
   *  no outbox state change) — acceptance never silently becomes delivery. */
  NOTIFICATION_CALLBACK_SECRET?: string;
  /** A19/B06: envelope-encryption secret(s) for admin-managed AI provider keys at rest.
   *  Comma/newline separated; the FIRST entry is the active one used for new writes,
   *  the rest stay decryptable until rows are rotated (see POST /api/admin/ai/keys/rotate-encryption).
   *  Minimum 16 chars per entry. Unset = registering new admin keys is refused (fail closed). */
  AI_KEY_ENCRYPTION_SECRETS?: string;
  /** Single-secret form of the same setting (ignored when the plural form is set). */
  AI_KEY_ENCRYPTION_SECRET?: string;
  AI_ASSISTANT_ENABLED?: string;
  AI_GEMINI_ENABLED?: string;
  /** Sandbox-only: enables the deterministic offline assistant (AI_OFFLINE_SANDBOX=1). */
  AI_OFFLINE_SANDBOX?: string;
  /** Local synthetic demo only: allow bounded offline registry tool commands. */
  AI_DEMO_REGISTRY_RESEARCH?: string;
  AI_DEEPSEEK_ENABLED?: string;
  AI_DEEPSEEK_VISION_ENABLED?: string;
  AI_GEMINI_WEB_GROUNDING_ENABLED?: string;
  AI_GEMINI_RPM_LIMIT?: string;
  AI_GEMINI_INPUT_TPM_LIMIT?: string;
  AI_GEMINI_RPD_LIMIT?: string;
  AI_GEMINI_FLASH_LITE_RPM_LIMIT?: string;
  AI_GEMINI_FLASH_LITE_INPUT_TPM_LIMIT?: string;
  AI_GEMINI_FLASH_LITE_RPD_LIMIT?: string;
  AI_GEMINI_38_FLASH_RPM_LIMIT?: string;
  AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT?: string;
  AI_GEMINI_38_FLASH_RPD_LIMIT?: string;
  AI_GEMINI_FLASH_RPM_LIMIT?: string;
  AI_GEMINI_FLASH_INPUT_TPM_LIMIT?: string;
  AI_GEMINI_FLASH_RPD_LIMIT?: string;
  AI_GEMINI_25_FLASH_RPM_LIMIT?: string;
  AI_GEMINI_25_FLASH_INPUT_TPM_LIMIT?: string;
  AI_GEMINI_25_FLASH_RPD_LIMIT?: string;
  AI_GEMINI_25_FLASH_LITE_RPM_LIMIT?: string;
  AI_GEMINI_25_FLASH_LITE_INPUT_TPM_LIMIT?: string;
  AI_GEMINI_25_FLASH_LITE_RPD_LIMIT?: string;
  AI_GEMINI_RESERVE_FRACTION?: string;
  AI_GEMINI_REPLAY_MAX_TOKENS?: string;
  AI_GEMINI_COUNT_TOKENS_THRESHOLD_FRACTION?: string;
  AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS?: string;
  AI_CONTEXT_SAFETY_FRACTION?: string;
  AI_OUTPUT_TOKENS_FAST?: string;
  AI_OUTPUT_TOKENS_AUTO?: string;
  AI_OUTPUT_TOKENS_RESEARCH?: string;
  AI_MAX_TOOL_CALLS_FAST?: string;
  AI_MAX_TOOL_CALLS_AUTO?: string;
  AI_MAX_TOOL_CALLS_RESEARCH?: string;
  AI_MAX_TOOL_ROUNDS_FAST?: string;
  AI_MAX_TOOL_ROUNDS_AUTO?: string;
  AI_MAX_TOOL_ROUNDS_RESEARCH?: string;
  AI_DEEPSEEK_CACHE_HIT_PER_MILLION_USD?: string;
  AI_DEEPSEEK_CACHE_MISS_PER_MILLION_USD?: string;
  AI_DEEPSEEK_OUTPUT_PER_MILLION_USD?: string;
  AI_DEEPSEEK_MAX_REQUEST_USD?: string;
  AI_DEEPSEEK_MAX_DAILY_USD?: string;
  AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER?: string;
  /** Runtime DB routing. Default: supabase_full; *_full unifies registry/auth/AI authority. */
  DB_PROVIDER_MODE?: import("../db/providerMode").DatabaseProviderMode;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  /** Optional direct/shared-pooler URL for non-Cloudflare validation environments. */
  SUPABASE_DATABASE_URL?: string;
  /** Preferred Cloudflare runtime path: Hyperdrive binding backed by Supabase direct Postgres. */
  SUPABASE_HYPERDRIVE?: { connectionString: string };
  DB_HEALTH_TIMEOUT_MS?: string;
  DB_HEALTH_CACHE_MS?: string;
  DB_FAILOVER_COOLDOWN_MS?: string;
  DB_FAILOVER_REQUIRED_SOURCE_SHA256?: string;
  DB_FAILOVER_REQUIRED_HORSE_COUNT?: string;
  /** Fail-closed serving-generation pin used by automatic public-read failover. */
  DB_FAILOVER_REQUIRED_CANONICAL_REVISION?: string;
  /** Exact derived-generation/source revision required on every failover provider. */
  DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION?: string;
  DB_RUNTIME?: {
    configuredMode: string;
    primary: "d1" | "turso" | "supabase";
    fallback?: "d1" | "turso" | "supabase";
    active: "d1" | "turso" | "supabase";
    failoverUsed: boolean;
    failoverEligible: boolean;
    reason: string;
  };
}

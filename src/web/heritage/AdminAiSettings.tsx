import React, { useCallback, useEffect, useState } from "react";
import type { AiAdminKeyRecord, AiAdminKeyTestResponse, AiAdminKeysResponse, AiAdminSettings, AiAdminSettingsResponse, PlatformClient, PlatformPermission, PlatformUser } from "../../contracts/platform";
import { useI18n } from "../i18n";

interface RingKeyRow {
  id: string;
  source: "env" | "database";
  label: string;
  masked: string;
  cooling: boolean;
  lastStatus: string | null;
}
interface AdminStatusResponse {
  status: { available: boolean; reason: string | null; defaultModel: string | null; models: Array<{ id: string; label: string; available: boolean; paid: boolean }>; storageReady: boolean };
  operations?: Record<string, unknown>;
  gemini?: Record<string, unknown> | null;
  keyRing?: Record<string, unknown> | null;
  policies?: Record<string, unknown>;
}
interface SettingsModelRow {
  provider: string;
  id: string;
  label: string;
  available: boolean;
  vision: boolean;
  paid: boolean;
  defaultForChat?: boolean;
}

/**
 * Heritage Admin — AI Settings (R32 / user task 2b, extended R33).
 *
 * ALL AI customization lives here, behind the content.manage permission:
 * the default chat model + default execution mode (R33 — moved out of the
 * user-facing chat), API key management with live connectivity tests, ring
 * state (rotation/cooldowns), quota snapshots and the deployment's effective
 * AI policies. Keys are masked everywhere and only ever leave the browser
 * through the CSRF-guarded admin API.
 */
export function HeritageAdminAiSettings({ platform, user, permissions }: { platform: PlatformClient; user: PlatformUser | null; permissions: PlatformPermission[] }) {
  const { locale } = useI18n();
  const fa = locale === "fa";
  const L = (en: string, faText: string) => fa ? faText : en;
  const canManage = Boolean(user && permissions.includes("content.manage"));
  const [data, setData] = useState<AiAdminKeysResponse | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse | null>(null);
  const [settings, setSettings] = useState<AiAdminSettings | null>(null);
  const [settingsModels, setSettingsModels] = useState<SettingsModelRow[]>([]);
  const [settingsBusy, setSettingsBusy] = useState("");
  const [settingsSaved, setSettingsSaved] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"add" | "test" | "rotate" | "">("");
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [rotationNote, setRotationNote] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");

  const load = useCallback(async () => {
    try {
      const [keysResponse, statusResponse, settingsResponse] = await Promise.all([
        platform.admin.ai.keys(),
        platform.admin.ai.status() as unknown as Promise<AdminStatusResponse>,
        platform.admin.ai.getSettings(),
      ]);
      setData(keysResponse);
      setStatus(statusResponse);
      setSettings(settingsResponse.settings);
      setSettingsModels(settingsResponse.models);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [platform]);

  useEffect(() => { if (canManage) void load(); }, [canManage, load]);

  const saveSettings = async (patch: Partial<AiAdminSettings>) => {
    if (!settings) return;
    const next: AiAdminSettings = {
      defaultChatModel: patch.defaultChatModel !== undefined ? patch.defaultChatModel : settings.defaultChatModel,
      defaultExecutionMode: patch.defaultExecutionMode !== undefined ? patch.defaultExecutionMode : settings.defaultExecutionMode,
    };
    setSettingsBusy("save"); setError(""); setSettingsSaved("");
    try {
      const result = await platform.admin.ai.updateSettings(next);
      setSettings(result.settings);
      setSettingsSaved(L("Saved — new chats use this immediately.", "ذخیره شد — گفت‌وگوهای جدید بلافاصله از این تنظیم استفاده می‌کنند."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setSettingsBusy(""); setTimeout(() => setSettingsSaved(""), 4000); }
  };

  if (!canManage) return <section className="admin-ai-settings panel" data-h-surface-role="panel">
    <header><span className="eyebrow">AI SETTINGS</span><h2>{L("AI settings", "تنظیمات هوش مصنوعی")}</h2></header>
    <p className="admin-ai-note">{L("Only administrators with content management permission can view or change AI provider settings.", "فقط مدیران دارای مجوز مدیریت محتوا می‌توانند تنظیمات هوش مصنوعی را ببینند یا تغییر دهند.")}</p>
  </section>;

  const addKey = async () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    setBusy("add"); setError("");
    try {
      await platform.admin.ai.addKey({ provider: "gemini", label: newLabel.trim(), apiKey: newKey.trim() });
      setNewLabel(""); setNewKey("");
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };
  const removeKey = async (id: string) => {
    setError("");
    try {
      await platform.admin.ai.deleteKey(id);
      await load();
    } catch (cause) { setError((cause as Error).message); }
  };
  const toggleKey = async (row: AiAdminKeyRecord) => {
    setError("");
    try {
      await platform.admin.ai.updateKey(row.id, { is_enabled: !row.is_enabled });
      await load();
    } catch (cause) { setError((cause as Error).message); }
  };
  const testKey = async (row: AiAdminKeyRecord) => {
    setBusy("test");
    try {
      const result: AiAdminKeyTestResponse = await platform.admin.ai.testKey(row.id);
      setTestResult(current => ({ ...current, [row.id]: { ok: result.ok, message: result.message } }));
      await load();
    } catch (cause) { setTestResult(current => ({ ...current, [row.id]: { ok: false, message: (cause as Error).message } })); }
    finally { setBusy(""); }
  };
  const rotateEncryption = async () => {
    setBusy("rotate"); setError(""); setRotationNote("");
    try {
      const result = await platform.admin.ai.rotateKeyEncryption();
      setRotationNote(result.ok
        ? L(`Rotation complete — ${result.converted} row(s) re-encrypted, ${result.alreadyCurrent} already current.`, `چرخش کامل شد — ${result.converted} ردیف رمزگذاری مجدد شد و ${result.alreadyCurrent} از قبل به‌روز بود.`)
        : L(`Rotation finished with ${result.failed.length} failure(s) — see the row errors.`, `چرخش با ${result.failed.length} خطا تمام شد — خطاهای ردیف‌ها را ببینید.`));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const assistant = status?.status;
  const policiesGemini = (status?.policies as { gemini?: Record<string, unknown> } | undefined)?.gemini;
  const quota = (policiesGemini as { quota?: Record<string, unknown> } | undefined)?.quota;

  return <section className="admin-ai-settings panel" data-h-surface-role="panel" aria-label={L("AI settings", "تنظیمات هوش مصنوعی")}>
    <header className="admin-ai-head">
      <span>
        <span className="eyebrow">AI SETTINGS · ADMIN</span>
        <h2>{L("AI providers & API keys", "سرویس‌های هوش مصنوعی و کلیدها")}</h2>
        <p>{L("Manage the Gemini API keys used by the research assistant and the editorial generator. When one key hits a rate limit the system automatically rotates to the next available key.", "کلیدهای API جِمینای مورد استفاده دستیار پژوهش و مولد تحریریه را مدیریت کنید. وقتی یک کلید به محدودیت نرخ برسد، سامانه خودکار به کلید بعدی موجود می‌رود.")}</p>
      </span>
      <span className={`admin-ai-state ${assistant?.available ? "ok" : "warn"}`}>
        <b>{assistant?.available ? L("Assistant online", "دستیار فعال") : L("Assistant offline", "دستیار غیرفعال")}</b>
        <small>{assistant?.defaultModel ?? "—"}</small>
      </span>
    </header>

    {error && <div className="admin-ai-error" role="alert">{error}</div>}

    {settings && <div className="admin-ai-model-defaults">
      <h3>{L("Default model & behavior", "مدل پیش‌فرض و رفتار")}</h3>
      <p className="admin-ai-section-note">{L("These choices apply to every user chat. Users no longer pick models themselves — the model and behavior are decided here.", "این انتخاب‌ها روی همه گفت‌وگوهای کاربران اعمال می‌شود. کاربران دیگر خودشان مدل انتخاب نمی‌کنند — مدل و رفتار همین‌جا تعیین می‌شود.")}</p>
      <div className="admin-ai-model-options" role="radiogroup" aria-label={L("Default chat model", "مدل پیش‌فرض گفت‌وگو")}>
        <button type="button" role="radio" aria-checked={settings.defaultChatModel === null} className={`admin-ai-model-option ${settings.defaultChatModel === null ? "selected" : ""}`} onClick={() => void saveSettings({ defaultChatModel: null })} disabled={settingsBusy === "save"}>
          <b>{L("System default", "پیش‌فرض سامانه")}</b>
          <small>Gemini 3.5 Flash-Lite · {L("fast & economical", "سریع و اقتصادی")}</small>
        </button>
        {settingsModels.map(model => <button key={`${model.provider}:${model.id}`} type="button" role="radio" aria-checked={settings.defaultChatModel === model.id} className={`admin-ai-model-option ${settings.defaultChatModel === model.id ? "selected" : ""}`} onClick={() => void saveSettings({ defaultChatModel: model.id })} disabled={!model.available || settingsBusy === "save"} title={!model.available ? L("Provider not configured", "سرویس پیکربندی نشده است") : undefined}>
          <b>{model.label}{model.paid ? L(" · paid", " · پولی") : ""}</b>
          <small>{model.id}{model.available ? "" : ` · ${L("unavailable", "در دسترس نیست")}`}</small>
        </button>)}
      </div>
      <div className="admin-ai-mode-options" role="radiogroup" aria-label={L("Default behavior", "رفتار پیش‌فرض")}>
        {([null, "fast", "auto", "research"] as const).map(value => <button key={value ?? "auto-default"} type="button" role="radio" aria-checked={(settings.defaultExecutionMode ?? null) === (value === null ? null : value)} className={`admin-ai-mode-option ${((settings.defaultExecutionMode ?? null) === (value === null ? null : value)) ? "selected" : ""}`} onClick={() => void saveSettings({ defaultExecutionMode: value })} disabled={settingsBusy === "save"}>
          <b>{value === null ? L("Balanced (auto)", "متعادل (خودکار)") : value === "fast" ? L("Fast", "سریع") : value === "auto" ? L("Auto", "خودکار") : L("Research", "پژوهش")}</b>
        </button>)}
      </div>
      {settingsSaved && <p className="admin-ai-saved" role="status">✓ {settingsSaved}</p>}
      {settingsBusy === "save" && <p className="admin-ai-saving">{L("Saving…", "در حال ذخیره…")}</p>}
    </div>}

    <div className="admin-ai-ring">
      <div className="admin-ai-ring-summary">
        <span><b>{data?.ring?.totalKeys ?? 0}</b><small>{L("keys in rotation", "کلید در چرخش")}</small></span>
        <span><b>{data?.ring?.availableKeys ?? 0}</b><small>{L("available now", "اکنون موجود")}</small></span>
        <span><b>{data?.ring?.coolingKeys ?? 0}</b><small>{L("cooling down", "در حال خنک‌شدن")}</small></span>
        {quota && <span><b>{String(quota.rpmLimit ?? "—")}</b><small>{L("Flash-Lite RPM", "نرخ دقیقه Flash-Lite")}</small></span>}
      </div>
      {data?.ring?.keys?.length ? <div className="admin-ai-ring-list">
        {data.ring.keys.map(ringKey => <span key={ringKey.id} className={`admin-ai-ring-key ${ringKey.cooling ? "cooling" : ""}`}>
          <b>{ringKey.source === "env" ? L("Environment", "محیط") : L("Admin", "مدیریت")}</b>
          <code>{ringKey.masked}</code>
          <small>{ringKey.cooling ? L("rate-limited", "محدود شده") : L("ready", "آماده")}</small>
        </span>)}
      </div> : <p className="admin-ai-empty">{L("No keys are configured yet. Add one below or set GEMINI_API_KEY in the server environment.", "هنوز کلیدی تنظیم نشده است. یکی در زیر اضافه کنید یا GEMINI_API_KEY را در محیط سرور تنظیم کنید.")}</p>}
    </div>

    <div className="admin-ai-keys">
      <h3>{L("Admin-managed keys", "کلیدهای مدیریت‌شده")}</h3>
      <div className="admin-ai-encryption" data-state={data?.encryption?.available ? "ok" : "warn"}>
        <b>{data?.encryption?.available ? L("Encrypted at rest", "رمزگذاری‌شده در ذخیره‌سازی") : L("Encryption not configured", "رمزگذاری تنظیم نشده")}</b>
        <span>{data?.encryption?.available
          ? L("Rows are stored as AES-GCM envelopes (worker secret AI_KEY_ENCRYPTION_SECRETS).", "ردیف‌ها به‌صورت پاکت AES-GCM ذخیره می‌شوند (راز AI_KEY_ENCRYPTION_SECRETS).")
          : L("Set the worker secret AI_KEY_ENCRYPTION_SECRETS (min 16 chars) — new keys cannot be registered until then.", "راز AI_KEY_ENCRYPTION_SECRETS (حداقل ۱۶ نویسه) را تنظیم کنید — تا آن زمان کلید جدیدی ثبت نمی‌شود.")}</span>
        {data?.encryption && (data.encryption.legacyPlaintextRows > 0 || data.encryption.undecryptableRows > 0) && <small>
          {data.encryption.legacyPlaintextRows > 0 && <>· {data.encryption.legacyPlaintextRows} {L("legacy plaintext row(s)", "ردیف متنی قدیمی")} </>}
          {data.encryption.undecryptableRows > 0 && <>· {data.encryption.undecryptableRows} {L("undecryptable row(s)", "ردیف غیرقابل رمزگشایی")}</>}
        </small>}
        {data?.encryption?.available && <button type="button" disabled={busy === "rotate"} onClick={() => void rotateEncryption()}>{busy === "rotate" ? L("Rotating…", "در حال چرخش…") : L("Rotate encryption now", "چرخش رمزگذاری")}</button>}
        {rotationNote && <small role="status">{rotationNote}</small>}
      </div>
      {data?.keys?.length ? <div className="admin-ai-key-rows">
        {data.keys.map(row => <div key={row.id} className="admin-ai-key-row">
          <span className="key-label">
            <strong>{row.label}</strong>
            <code>{row.masked}</code>
            {row.encrypted === true && <em className="key-enc ok" title={L("Stored encrypted (A19)", "رمزگذاری‌شده ذخیره شده")}>{L("encrypted", "رمزگذاری‌شده")}</em>}
            {row.encrypted === false && <em className="key-enc warn" title={L("Legacy plaintext row — rotate encryption to convert it", "ردیف متنی قدیمی — با چرخش رمزگذاری تبدیل شود")}>{L("plaintext", "متن ساده")}</em>}
            {row.decryption_error && <em className="key-enc fail" title={row.decryption_error}>{L("undecryptable", "غیرقابل رمزگشایی")}</em>}
          </span>
          <span className="key-meta">
            <em className={row.is_enabled ? "on" : "off"}>{row.is_enabled ? L("enabled", "فعال") : L("disabled", "غیرفعال")}</em>
            {row.last_status && <small>{row.last_status}</small>}
          </span>
          <span className="key-actions">
            <button type="button" onClick={() => void testKey(row)} disabled={busy === "test"}>{L("Test", "آزمون")}</button>
            <button type="button" onClick={() => void toggleKey(row)}>{row.is_enabled ? L("Disable", "غیرفعال‌سازی") : L("Enable", "فعال‌سازی")}</button>
            <button type="button" className="danger" onClick={() => void removeKey(row.id)}>{L("Remove", "حذف")}</button>
          </span>
          {testResult[row.id] && <span className={`key-test ${testResult[row.id].ok ? "ok" : "fail"}`}>{testResult[row.id].ok ? "✓ " : "✕ "}{testResult[row.id].message}</span>}
          {row.decryption_error && <span className="key-test fail" role="alert">✕ {row.decryption_error}</span>}
        </div>)}
      </div> : <p className="admin-ai-empty">{L("No admin keys yet — keys from the server environment are listed in the ring above.", "هنوز کلید مدیریتی‌ای نیست — کلیدهای محیط سرور در چرخش بالا فهرست شده‌اند.")}</p>}

      <div className="admin-ai-add">
        <label>{L("Label", "برچسب")}<input dir="auto" value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder={L("e.g. Laptop key", "مثلاً کلید لپ‌تاپ")} /></label>
        <label>{L("Gemini API key", "کلید API جِمینای")}<input dir="ltr" value={newKey} onChange={event => setNewKey(event.target.value)} placeholder="AIza… / AQ." /></label>
        <button type="button" className="primary" disabled={busy === "add" || !newKey.trim() || !newLabel.trim()} onClick={() => void addKey()}>{busy === "add" ? L("Adding…", "در حال افزودن…") : L("Add key", "افزودن کلید")}</button>
      </div>
      <p className="admin-ai-hint">{L("Keys are stored server-side as encrypted envelopes (A19), never returned in full, and only admins can see this panel.", "کلیدها سمت سرور به‌صورت پاکت رمزگذاری‌شده ذخیره می‌شوند (A19)، هرگز به‌صورت کامل بازگردانده نمی‌شوند و فقط مدیران این پنل را می‌بینند.")}</p>
    </div>

    {assistant?.models?.length ? <div className="admin-ai-models">
      <h3>{L("Model catalog", "کاتالوگ مدل‌ها")}</h3>
      <p className="admin-ai-section-note">{L("Available models with the effective default highlighted above.", "مدل‌های در دسترس؛ پیش‌فرض مؤثر در بالا مشخص شده است.")}</p>
      <div>{assistant.models.map(model => <span key={model.id} className={model.available ? "ok" : ""}>
        <b>{model.label}</b><small>{model.id}{model.paid ? ` · ${L("paid", "پولی")}` : ""}</small>
      </span>)}</div>
    </div> : null}
  </section>;
}

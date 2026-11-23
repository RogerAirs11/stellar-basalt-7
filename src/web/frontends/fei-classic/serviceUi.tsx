import type { ResourceState } from "../../../frontend-kit";
import { t } from "./i18n";

export function FeiServiceResourceNotice({ state, retry, locale }: { state: ResourceState<unknown>; retry: () => void; locale: "en" | "fa" | "ar" }) {
  const L = (en: string, fa: string) => t(locale, en, fa);
  if (state.phase === "loading" || state.phase === "reloading") return <p className="fc113-notice" role="status">{state.phase === "reloading" ? L("Refreshing; the displayed information may be out of date.", "در حال تازه‌سازی؛ اطلاعات نمایش‌داده‌شده ممکن است قدیمی باشد.") : L("Loading…", "در حال بارگذاری…")}</p>;
  return "reason" in state ? <div className="fc113-notice fc113-notice-error" role="alert"><strong>{state.phase === "forbidden" ? L("Access is unavailable to this account", "دسترسی برای این حساب فراهم نیست") : L("This information is unavailable", "این اطلاعات در دسترس نیست")}</strong><p dir="auto">{state.reason}</p><button type="button" className="fc-btn fc-btn-gray" onClick={retry}>{L("Try again", "تلاش دوباره")}</button></div> : null;
}

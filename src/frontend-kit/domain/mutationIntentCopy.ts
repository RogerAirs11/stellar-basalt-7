/** Shared recovery semantics; each frontend owns its own presentation. */
import type { EngineLocale } from "../runtime";
import { kitText } from "./engineText";

const COPY = {
  "confirmed": [
    "The server confirmed this inquiry; acceptance and notification delivery are not guaranteed.",
    "سرور ثبت این درخواست را تأیید کرد؛ پذیرش و تحویل اعلان تضمین نشده است."
  ],
  "expired": [
    "The device recovery record expired, not the server request. Check My service requests before creating another inquiry.",
    "سابقه بازیابی دستگاه منقضی شده، نه درخواست سرور. پیش از درخواست تازه، بخش درخواست‌های من را بررسی کنید."
  ],
  "no_receipt_on_server": [
    "No matching receipt is visible yet. The request may still be in flight; recheck and review My service requests before starting again.",
    "هنوز رسید مطابقی دیده نمی‌شود. ممکن است درخواست در حال پردازش باشد؛ دوباره بررسی کنید و پیش از شروع مجدد، درخواست‌های من را ببینید."
  ],
  "legacy_receipt_unresolved": [
    "An older receipt cannot be linked to one request. Review existing requests or ask support before creating another inquiry.",
    "رسید قدیمی به یک درخواست مشخص قابل انتساب نیست. پیش از ایجاد درخواست تازه، سوابق را بررسی کنید یا از پشتیبانی بپرسید."
  ],
  "dispatch_unknown": [
    "Dispatch is uncertain: a crash can occur after sending. Recheck with the server before starting again.",
    "وضعیت ارسال نامشخص است؛ ممکن است خطا پس از ارسال رخ داده باشد. پیش از شروع مجدد با سرور بررسی کنید."
  ],
  "unknown": [
    "The result cannot be verified yet. Recheck when connected; do not assume success or failure.",
    "نتیجه هنوز قابل تأیید نیست. پس از اتصال دوباره بررسی کنید؛ موفقیت یا شکست را فرض نکنید."
  ],
  "clear": [
    "Clear device recovery record",
    "پاک کردن سابقه بازیابی دستگاه"
  ],
  "clearWarning": [
    "Clearing this record does not cancel a server request. A new inquiry could create a duplicate.",
    "پاک کردن این سابقه، درخواست سرور را لغو نمی‌کند. درخواست تازه ممکن است تکراری باشد."
  ]
} as const;

export function mutationIntentCopy(key: string | null, locale: EngineLocale): string {
  const pair = COPY[key as keyof typeof COPY] ?? COPY.unknown;
  return kitText(locale, pair[0], pair[1]);
}

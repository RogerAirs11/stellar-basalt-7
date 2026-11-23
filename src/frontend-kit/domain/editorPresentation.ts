/** Shared domain language only; every frontend owns its editor components and tokens. */
import type { EngineLocale } from "../runtime";
import { kitText } from "./engineText";

type Locale = EngineLocale;
const FIELDS: Readonly<Record<string, readonly [string, string]>> = {
  service_categories: ["Services", "خدمات"], province_code: ["Province", "استان"], city: ["City", "شهر"],
  province_scheme_confirmed: ["Province reference confirmed", "تأیید مرجع استان"],
  contact_preference: ["Preferred contact channel", "روش ترجیحی تماس"], contact_value: ["Private contact detail", "اطلاعات تماس خصوصی"],
  languages: ["Working languages", "زبان‌های کاری"], availability_text: ["Availability", "زمان دسترسی"],
  publication_consent: ["Publication consent", "رضایت انتشار"], description: ["Description", "توضیحات"],
  specialties: ["Specialties", "تخصص‌ها"], service_areas: ["Service areas", "مناطق ارائه خدمت"],
  accessibility_notes: ["Accessibility information", "اطلاعات دسترس‌پذیری"], opening_hours: ["Opening hours", "ساعت‌های کاری"],
  evidence_note: ["Evidence for review", "شواهد برای بررسی"], person_id: ["Person registry ID", "شناسه شخص در سامانه"],
  organization_id: ["Organization registry ID", "شناسه سازمان در سامانه"],
};
const PUBLICATION: Readonly<Record<string, readonly [string, string]>> = {
  published: ["Published in the directory", "منتشرشده در فهرست"],
  unpublished: ["Not published in the directory", "منتشرنشده در فهرست"],
  "unpublished (consent not given or withdrawn)": ["Not published; publication consent is absent or withdrawn", "منتشرنشده؛ رضایت انتشار داده نشده یا پس گرفته شده است"],
  withdrawn: ["Publication consent withdrawn", "رضایت انتشار پس گرفته شد"],
  pending: ["Awaiting review", "در انتظار بررسی"],
};
const WEEKDAYS: Readonly<Record<string, readonly [string, string]>> = {
  mon: ["Monday", "دوشنبه"], tue: ["Tuesday", "سه‌شنبه"], wed: ["Wednesday", "چهارشنبه"], thu: ["Thursday", "پنجشنبه"],
  fri: ["Friday", "جمعه"], sat: ["Saturday", "شنبه"], sun: ["Sunday", "یکشنبه"],
};
const CLAIM_STATUSES: Readonly<Record<string, readonly [string, string]>> = {
  pending: ["Awaiting review", "در انتظار بررسی"], approved: ["Approved", "تأییدشده"], rejected: ["Rejected", "ردشده"],
  withdrawn: ["Withdrawn", "پس‌گرفته‌شده"], unknown: ["Status unavailable", "وضعیت در دسترس نیست"],
};
const label = (map: Readonly<Record<string, readonly [string, string]>>, key: string, locale: Locale): string => {
  const pair = map[key];
  return pair ? kitText(locale, pair[0], pair[1]) : key.replace(/_/g, " ");
};
export const editorFieldLabel = (field: string, locale: Locale): string => label(FIELDS, field, locale);
export const editorPublicationLabel = (value: string, locale: Locale): string => label(PUBLICATION, value, locale);
export const editorWeekdayLabel = (day: string, locale: Locale): string => label(WEEKDAYS, day, locale);
export const editorClaimStatusLabel = (status: string, locale: Locale): string => label(CLAIM_STATUSES, status, locale);

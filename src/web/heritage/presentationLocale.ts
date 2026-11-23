import { uiText, uiNumberTag } from "../../shared/uiLocale";
import type { Locale } from "../i18n";
import {
  analysisMethodLabel as sharedAnalysisMethodLabel,
  founderAssumptionLabel as sharedFounderAssumptionLabel,
  localizedAnalysisText as sharedLocalizedAnalysisText,
  localizedCodeLabel as sharedCodeLabel,
} from "../../frontend-kit/analysisLocale";

const FA_DIGITS="۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS="٠١٢٣٤٥٦٧٨٩";
export function localizedDigits(value:unknown,locale:Locale):string{
  const text=String(value??"");
  const digits=locale==="fa"?FA_DIGITS:locale==="ar"?AR_DIGITS:null;
  return digits?text.replace(/\d/g,d=>digits[Number(d)]):text;
}
/** The input is already a percentage, not a fraction. No invented precision. */
export function localizedPercent(value:number,locale:Locale,digits=0,minDigits=0):string{
  if(!Number.isFinite(value))return "—";
  const max=Math.max(0,Math.min(20,Math.trunc(digits)));
  const min=Math.max(0,Math.min(max,Math.trunc(minDigits)));
  return new Intl.NumberFormat(uiNumberTag(locale),{style:"percent",minimumFractionDigits:min,maximumFractionDigits:max}).format(value/100);
}
export function confidenceGradeLabel(grade:string,locale:Locale):string{
  if(locale!=="fa")return uiText(locale, ({high:"High",medium:"Medium",low:"Low",unavailable:"Unavailable"} as Record<string,string>)[grade.toLowerCase()]??grade.toUpperCase());
  return ({high:"زیاد",medium:"متوسط",low:"کم",unavailable:"ناموجود"} as Record<string,string>)[grade.toLowerCase()]??localizedDigits(grade,locale);
}
export function workflowStatusLabel(status:string,locale:Locale):string{
  if(locale!=="fa")return uiText(locale, ({pending:"Pending",approved:"Approved",rejected:"Rejected",withdrawn:"Withdrawn",draft:"Draft",needs_changes:"Changes requested",open:"Open",closed:"Closed"} as Record<string,string>)[status.toLowerCase()]??status);
  return ({pending:"در انتظار بررسی",approved:"تأییدشده",rejected:"ردشده",withdrawn:"پس‌گرفته‌شده",draft:"پیش‌نویس","needs_changes":"نیازمند اصلاح",open:"باز",closed:"بسته"} as Record<string,string>)[status.toLowerCase()]??localizedDigits(status,locale);
}
export function analysisMethodLabel(value:string,locale:Locale):string{return sharedAnalysisMethodLabel(value,locale)}
export function founderAssumptionLabel(value:string,locale:Locale):string{return sharedFounderAssumptionLabel(value,locale)}
export function componentCodeLabel(code:string,locale:Locale):string{
  if(locale!=="fa")return code;
  return ({lowMeanKinship:"میانگین خویشاوندی پایین",rareRecordedAncestors:"نیاکان ثبت‌شدهٔ کمیاب",rareTailMaleLine:"خط مستقیم پدری کمیاب",rareTailFemaleLine:"خط مستقیم مادری کمیاب"} as Record<string,string>)[code]??code;
}
export function localizedAnalysisText(text:string,locale:Locale):string{return sharedLocalizedAnalysisText(text,locale)}
export function localizedCodeLabel(value:string,locale:Locale):string{return sharedCodeLabel(value,locale)}

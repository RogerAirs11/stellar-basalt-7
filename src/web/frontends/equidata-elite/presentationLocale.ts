import type { EquiDataLocale } from "./i18n";
import {
  analysisMethodLabel as sharedAnalysisMethodLabel,
  founderAssumptionLabel as sharedFounderAssumptionLabel,
  localizedAnalysisText as sharedLocalizedAnalysisText,
  localizedCodeLabel as sharedCodeLabel,
} from "../../../frontend-kit";

const FA_DIGITS="۰۱۲۳۴۵۶۷۸۹";
export function localizedDigits(value:unknown,locale:EquiDataLocale):string{
  const text=String(value??"");
  return locale==="fa"?text.replace(/\d/g,d=>FA_DIGITS[Number(d)]):text;
}
export function localizedAnalysisText(text:string,locale:EquiDataLocale):string{return sharedLocalizedAnalysisText(text,locale)}
export function analysisMethodLabel(value:string,locale:EquiDataLocale):string{return sharedAnalysisMethodLabel(value,locale)}
export function founderAssumptionLabel(value:string,locale:EquiDataLocale):string{return sharedFounderAssumptionLabel(value,locale)}
export function localizedCodeLabel(value:string,locale:EquiDataLocale):string{return sharedCodeLabel(value,locale)}

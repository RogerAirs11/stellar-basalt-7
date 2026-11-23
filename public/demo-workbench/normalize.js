// GENERATED from src/search/normalize.ts; do not edit this copy.
const ARABIC_TO_PERSIAN = {
    "ي": "ی",
    "ى": "ی",
    "ك": "ک",
    "ة": "ه",
    "ۀ": "ه",
};
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function normalizeText(input) {
    if (input == null)
        return "";
    let value = String(input).normalize("NFKC").trim().toLowerCase();
    value = value.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
    value = value.replace(/[يك ىةۀ]/g, (char) => ARABIC_TO_PERSIAN[char] ?? char);
    value = value.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
    value = value.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
    value = value.replace(/[-‐‑‒–—―_./\\|,:;()[\]{}'"`~!@#$%^&*+=<>?]+/g, " ");
    value = value.replace(/\s+/g, " ").trim();
    return value;
}
export function compactText(input) {
    return normalizeText(input).replace(/\s+/g, "");
}
export function tokens(input) {
    return normalizeText(input).split(" ").filter(Boolean);
}

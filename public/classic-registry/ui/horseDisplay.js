// GENERATED: edit src/frontend-kit/horseDisplay.ts, then tools/build-navigation-model.cjs.
const FA_SEX = Object.freeze({ "mare": "مادیان", "stallion": "نریان", "gelding": "اسب اخته", "colt": "کره نر", "filly": "کره ماده", "male": "نر", "female": "ماده", "unknown": "نامشخص", "geld": "اسب اخته", "unspecified": "نامشخص" });
const OTHER_SEX = {
    "fr": {
        "mare": "Jument",
        "stallion": "Étalon",
        "gelding": "Hongre",
        "colt": "Poulain mâle",
        "filly": "Pouliche",
        "male": "Mâle",
        "female": "Femelle",
        "unknown": "Inconnu",
        "geld": "Hongre",
        "unspecified": "Inconnu"
    },
    "ar": {
        "mare": "فرس",
        "stallion": "فحل",
        "gelding": "حصان مخصي",
        "colt": "مهر",
        "filly": "مهرة",
        "male": "ذكر",
        "female": "أنثى",
        "unknown": "غير معروف",
        "geld": "حصان مخصي",
        "unspecified": "غير معروف"
    }
};
const own = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
function keyOf(value) { return (value ?? "").trim().toLowerCase(); }
export function horseSexLabel(value, locale, empty = locale === "fa" ? "نامشخص" : locale === "fr" ? "Inconnu" : locale === "ar" ? "غير معروف" : "Unknown") {
    const key = keyOf(value);
    if (!key)
        return empty;
    if (locale === "en")
        return value;
    if (locale === "fr" || locale === "ar")
        return own(OTHER_SEX[locale], key) ? OTHER_SEX[locale][key] : value;
    return own(FA_SEX, key) ? FA_SEX[key] : value;
}
/** Exact known vocabulary only, for decorative encoding, never authorization. */
export function horseSexKind(value) {
    const key = keyOf(value);
    if (["gelding", "geld", "اخته", "اسب اخته"].includes(key))
        return "gelding";
    if (["mare", "filly", "female", "مادیان", "کره ماده", "ماده"].includes(key))
        return "female";
    if (["stallion", "colt", "male", "نریان", "کره نر", "نر"].includes(key))
        return "male";
    return "unknown";
}

import { horseSexLabel } from "./horseDisplay.js";
/* Presentation-only draft snapshots stay in memory and never enter browser storage. */
export function captureFormState(root) {
  const fields = [];
  for (const form of root.querySelectorAll('form[id]')) {
    for (const element of form.elements) {
      const key = element.name || element.id;
      if (!key || !('value' in element) || ['file', 'hidden', 'submit', 'button'].includes(element.type)) continue;
      fields.push({ form: form.id, key, value: element.value, checked: element.checked,
        selected: element instanceof HTMLSelectElement && element.multiple ? [...element.selectedOptions].map(option => option.value) : null,
        focused: document.activeElement === element, start: element.selectionStart, end: element.selectionEnd });
    }
  }
  return fields;
}

export function restoreFormState(root, fields) {
  for (const field of fields) {
    const form = [...root.querySelectorAll('form[id]')].find(item => item.id === field.form);
    if (!form) continue;
    const element = [...form.elements].find(item => (item.name || item.id) === field.key && !['file', 'hidden'].includes(item.type));
    if (!element) continue;
    element.value = field.value;
    if (typeof field.checked === 'boolean') element.checked = field.checked;
    if (field.selected && element instanceof HTMLSelectElement) for (const option of element.options) option.selected = field.selected.includes(option.value);
    if (field.focused) {
      element.focus({ preventScroll: true });
      if (typeof field.start === 'number' && typeof element.setSelectionRange === 'function') {
        try { element.setSelectionRange(field.start, field.end); } catch { /* Some input types do not expose a selection. */ }
      }
    }
  }
}

/** Display values only; persisted/API vocabulary is never translated. */
const DOMAIN_WORDS_FA = {
  arabian: 'عرب', 'purebred arabian': 'عرب خالص', thoroughbred: 'تروبرد', warmblood: 'خون‌گرم', 'part-bred arabian': 'دورگ عرب',
  bay: 'کهر', chestnut: 'کرنگ', grey: 'خاکستری', gray: 'خاکستری', black: 'سیاه', white: 'سفید', palomino: 'طلایی', brown: 'قهوه‌ای',
  pending: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'ردشده', active: 'فعال', inactive: 'غیرفعال', expired: 'منقضی‌شده',
};
const DOMAIN_WORDS_AR = {
  arabian: 'عربي', 'purebred arabian': 'عربي أصيل', thoroughbred: 'ثوروبريد', warmblood: 'دم حار', 'part-bred arabian': 'مهجن عربي',
  bay: 'كهر', chestnut: 'كستنائي', grey: 'رمادي', gray: 'رمادي', black: 'أسود', white: 'أبيض', palomino: 'بالومينو', brown: 'بني',
  pending: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', active: 'نشط', inactive: 'غير نشط', expired: 'منتهي',
};
export function localizeDomainValue(value, locale) {
  if (value == null || value === '') return '—';
  const raw = String(value);
  if (locale !== 'fa' && locale !== 'ar') return raw;
  const words = locale === 'ar' ? DOMAIN_WORDS_AR : DOMAIN_WORDS_FA;
  const key=raw.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(words,key) ? words[key] : horseSexLabel(raw,locale);
}

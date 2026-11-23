/** Preference storage is optional. Private-browsing denial must not prevent startup.
 * This adapter holds presentation preferences only, never auth tokens or form data.
 */
const transient = new Map();
export const preferenceStorage = {
  getItem(key) {
    try { return window.localStorage.getItem(key) ?? transient.get(key) ?? null; }
    catch { return transient.get(key) ?? null; }
  },
  setItem(key, value) {
    transient.set(key, String(value));
    try { window.localStorage.setItem(key, String(value)); return true; }
    catch { return false; }
  },
  removeItem(key) {
    transient.delete(key);
    try { window.localStorage.removeItem(key); } catch { /* Optional storage. */ }
  },
};

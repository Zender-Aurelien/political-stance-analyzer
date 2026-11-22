/**
 * storage.js — thin localStorage helpers with JSON handling.
 * All quiz, theme, and recent-search state flows through here.
 */

export function get(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — fail silently.
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

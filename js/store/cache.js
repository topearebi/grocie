// Local persistence: settings, catalog mirror, shopping list, pending image queue.
// The GitHub repo is the source of truth; this cache makes the app instant and
// keeps unsynced work safe between sessions.

const SETTINGS_KEY = 'gg.settings.v1';
const CACHE_KEY = 'gg.cache.v1';
const LIST_KEY = 'gg.list.v1';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  const stored = readJSON(SETTINGS_KEY) || {};
  const clean = {};
  for (const [k, v] of Object.entries(stored)) {
    if (v !== '' && v != null) clean[k] = v;
  }
  return clean;
}

export function saveSettings(settings) {
  return writeJSON(SETTINGS_KEY, settings);
}

export function loadCache() {
  const cached = readJSON(CACHE_KEY);
  if (!cached || typeof cached !== 'object' || !cached.catalog) {
    return { catalog: null, baseUpdated: null, dirty: false, pendingImages: [] };
  }
  return {
    catalog: cached.catalog,
    baseUpdated: cached.baseUpdated || null,
    dirty: Boolean(cached.dirty),
    pendingImages: Array.isArray(cached.pendingImages) ? cached.pendingImages : [],
  };
}

export function saveCache({ catalog, baseUpdated, dirty, pendingImages }) {
  return writeJSON(CACHE_KEY, { catalog, baseUpdated, dirty, pendingImages });
}

export function loadList() {
  const list = readJSON(LIST_KEY);
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}

export function saveList(list) {
  return writeJSON(LIST_KEY, list);
}

export function clearAllLocal() {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
}

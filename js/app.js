// App orchestrator: state, context, routing, and GitHub sync.

import {
  loadSettings,
  saveSettings,
  loadCache,
  saveCache,
  loadList,
  saveList,
  clearAllLocal,
} from './store/cache.js';
import {
  detectRepo,
  syncCatalog,
  uploadImage,
  testConnection,
  fetchPublishedCatalog,
} from './store/github.js';
import { createCatalog, itemById } from './domain/catalog.js';
import { compressImage, debounce, toast } from './util.js';
import * as captureView from './ui/capture.js';
import * as searchView from './ui/search.js';
import * as itemView from './ui/item.js';
import * as listView from './ui/list.js';
import * as settingsView from './ui/settings.js';

const state = {
  settings: {},
  catalog: createCatalog(),
  baseUpdated: null,
  dirty: false,
  pendingImages: [],
  list: [],
  syncState: 'idle', // idle | syncing | error | offline
  syncError: null,
};

function isConfigured() {
  return Boolean(state.settings.token && state.settings.owner && state.settings.repo);
}

function persist() {
  saveCache({
    catalog: state.catalog,
    baseUpdated: state.baseUpdated,
    dirty: state.dirty,
    pendingImages: state.pendingImages,
  });
}

// --- Context handed to every view -------------------------------------------

const ctx = {
  get catalog() {
    return state.catalog;
  },
  get settings() {
    return state.settings;
  },
  get list() {
    return state.list;
  },
  get pendingImages() {
    return state.pendingImages;
  },
  get sync() {
    return { state: state.syncState, dirty: state.dirty, error: state.syncError };
  },

  commit(mutator) {
    mutator(state.catalog);
    state.catalog.updated = new Date().toISOString();
    state.dirty = true;
    persist();
    renderStatus();
    scheduleSync();
  },

  navigate(hash) {
    if (window.location.hash === hash) route();
    else window.location.hash = hash;
  },

  refresh() {
    route();
  },

  inList(id) {
    return state.list.includes(id);
  },

  toggleList(id) {
    const index = state.list.indexOf(id);
    if (index === -1) state.list.push(id);
    else state.list.splice(index, 1);
    saveList(state.list);
    renderNav();
    return index === -1;
  },

  removeFromList(id) {
    state.list = state.list.filter((entry) => entry !== id);
    saveList(state.list);
    renderNav();
  },

  pruneList(id) {
    if (state.list.includes(id)) {
      state.list = state.list.filter((entry) => entry !== id);
      saveList(state.list);
      renderNav();
    }
  },

  clearList() {
    state.list = [];
    saveList(state.list);
    renderNav();
  },

  saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    saveSettings(state.settings);
    renderStatus();
  },

  async attachImage(itemId, file) {
    try {
      const dataUrl = await compressImage(file);
      if (!itemById(state.catalog, itemId)) return;
      ctx.addPendingImage(itemId, dataUrl);
      toast('Photo attached — it will sync when you\'re online', 'info');
    } catch (err) {
      toast(`Could not attach photo: ${err.message}`, 'error');
    }
  },

  // Queue a photo (data URL) for upload; the item's preview uses it immediately.
  addPendingImage(itemId, dataUrl) {
    if (!itemById(state.catalog, itemId)) return;
    state.pendingImages = state.pendingImages.filter((p) => p.itemId !== itemId);
    state.pendingImages.push({ itemId, dataUrl });
    state.dirty = true;
    persist();
    renderStatus();
    scheduleSync();
  },

  removeImage(itemId) {
    state.pendingImages = state.pendingImages.filter((p) => p.itemId !== itemId);
    const item = itemById(state.catalog, itemId);
    if (item) item.image = null;
    ctx.commit(() => {});
    route();
  },

  async testConnection() {
    return testConnection(state.settings);
  },

  syncNow(manual) {
    return syncNow(Boolean(manual));
  },

  clearLocalData() {
    clearAllLocal();
    window.location.reload();
  },
};

// --- Sync --------------------------------------------------------------------

const scheduleSync = debounce(() => syncNow(false), 2500);

async function syncNow(manual = false) {
  if (state.syncState === 'syncing') return;

  if (!isConfigured()) {
    state.syncState = 'idle';
    state.syncError = null;
    renderStatus();
    if (manual) toast('Set token, owner and repository first (see Settings)', 'error');
    return;
  }
  if (navigator.onLine === false) {
    state.syncState = 'offline';
    renderStatus();
    if (manual) toast('You are offline — changes are saved locally', 'info');
    return;
  }
  if (!state.dirty && state.pendingImages.length === 0) {
    state.syncState = 'idle';
    state.syncError = null;
    renderStatus();
    if (manual) toast('Everything is already synced', 'info');
    return;
  }

  state.syncState = 'syncing';
  state.syncError = null;
  renderStatus();

  try {
    // Photos first, so the catalog only ever references images that exist.
    while (state.pendingImages.length > 0) {
      const pending = state.pendingImages[0];
      const path = await uploadImage(state.settings, pending.dataUrl);
      const item = itemById(state.catalog, pending.itemId);
      if (item) {
        item.image = path;
        state.dirty = true;
      }
      state.pendingImages.shift();
      persist();
    }

    const merged = await syncCatalog(state.settings, state.catalog, state.baseUpdated);
    state.catalog = merged;
    state.baseUpdated = merged.updated;
    state.dirty = false;
    state.syncState = 'idle';
    persist();
    renderStatus();
    if (manual) toast('Synced with GitHub', 'success');
  } catch (err) {
    state.syncState = 'error';
    state.syncError = err.message;
    persist();
    renderStatus();
    if (manual) toast(err.message, 'error');
  }
}

// --- Chrome (nav + status) ----------------------------------------------------

function renderNav() {
  const badge = document.getElementById('list-badge');
  if (badge) {
    badge.textContent = String(state.list.length);
    badge.hidden = state.list.length === 0;
  }
}

function renderStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;

  let text = 'Local only';
  let cls = 's-local';
  if (navigator.onLine === false && (state.dirty || state.pendingImages.length)) {
    text = 'Offline — unsynced';
    cls = 's-warn';
  } else if (state.syncState === 'syncing') {
    text = 'Syncing…';
    cls = 's-busy';
  } else if (state.syncState === 'error') {
    text = 'Sync failed';
    cls = 's-error';
  } else if (state.dirty || state.pendingImages.length) {
    text = isConfigured() ? 'Unsynced changes' : 'Local changes';
    cls = 's-warn';
  } else if (isConfigured()) {
    text = 'Synced';
    cls = 's-ok';
  }
  el.textContent = text;
  el.className = `sync-status ${cls}`;
  el.title = state.syncError || 'GitHub sync status — click for settings';
}

function setActiveTab(name) {
  document.querySelectorAll('#tabs a').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
}

// --- Router -------------------------------------------------------------------

function route() {
  const raw = window.location.hash || '#/capture';
  if (!window.location.hash) {
    window.location.replace('#/capture');
  }
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const segs = path.replace(/^#\/?/, '').split('/');
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = '';
  view.scrollTop = 0;
  window.scrollTo(0, 0);

  switch (segs[0]) {
    case 'capture':
      captureView.render(view, ctx, { params, segs });
      setActiveTab('capture');
      break;
    case 'item':
      itemView.render(view, ctx, decodeURIComponent(segs[1] || ''));
      setActiveTab('search');
      break;
    case 'list':
      listView.render(view, ctx, { params });
      setActiveTab('list');
      break;
    case 'settings':
      settingsView.render(view, ctx, { params });
      setActiveTab('settings');
      break;
    default:
      searchView.render(view, ctx, { params });
      setActiveTab('search');
  }
}

// --- Bootstrap ----------------------------------------------------------------

function adoptRemote(remote) {
  const localEmpty = state.catalog.items.length === 0;
  if (state.dirty) {
    // Local unsynced work wins for now; remember the server version so the
    // next sync can union-merge them.
    if (remote.updated) state.baseUpdated = remote.updated;
  } else if (localEmpty || (remote.updated && remote.updated > (state.catalog.updated || ''))) {
    state.catalog = remote;
    state.baseUpdated = remote.updated;
    // Re-render only if the user isn't mid-keystroke.
    const active = document.activeElement;
    if (!active || active === document.body || !viewContainsFocus()) route();
  } else if (remote.updated && !state.baseUpdated) {
    state.baseUpdated = remote.updated;
  }
  persist();
}

function viewContainsFocus() {
  const view = document.getElementById('view');
  return Boolean(view && view.contains(document.activeElement));
}

async function bootstrap() {
  const detected = detectRepo() || {};
  state.settings = { branch: 'main', ...detected, ...loadSettings() };

  const cache = loadCache();
  if (cache.catalog) {
    state.catalog = cache.catalog;
    state.baseUpdated = cache.baseUpdated;
    state.dirty = cache.dirty;
    state.pendingImages = cache.pendingImages;
  }
  state.list = loadList();

  document.getElementById('sync-status')?.addEventListener('click', () => {
    ctx.navigate('#/settings');
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    renderStatus();
    if (state.dirty || state.pendingImages.length) syncNow(false);
  });
  window.addEventListener('offline', renderStatus);
  // Safety net: catch changes that missed their debounce (e.g. closed tab).
  setInterval(() => {
    if ((state.dirty || state.pendingImages.length) && navigator.onLine !== false) {
      syncNow(false);
    }
  }, 120000);

  renderNav();
  renderStatus();
  route();
  persist(); // snapshot the initial state so the app works offline from first run

  try {
    const remote = await fetchPublishedCatalog();
    if (remote) adoptRemote(remote);
  } catch {
    /* offline or not yet published — keep the local copy */
  }

  if (state.dirty || state.pendingImages.length > 0) syncNow(false);
}

bootstrap();

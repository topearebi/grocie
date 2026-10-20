// Core catalog domain: items, records, unit pricing, similarity grouping, merging.

const MASS_UNITS = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_UNITS = { ml: 1, cl: 10, l: 1000 };
const EACH_UNITS = { each: 1, pc: 1, pcs: 1, pack: 1, box: 1, can: 1, jar: 1, bottle: 1 };

export const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'each'];

// Tokens starting with a digit are treated as size/quantity markers ("415g", "1.5l",
// "400", "4") and dropped before comparing names, so different pack sizes of one
// product still group together.
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and']);

export function createCatalog() {
  return { items: [], stores: [], updated: new Date().toISOString() };
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalName(name) {
  return normalize(name).replace(/[^\p{L}\p{N}]/gu, '');
}

export function itemById(catalog, id) {
  return catalog.items.find((item) => item.id === id) || null;
}

export function findItem(catalog, name, brand) {
  const n = normalize(name);
  const b = normalize(brand);
  return catalog.items.find(
    (item) => normalize(item.name) === n && normalize(item.brand || '') === b
  ) || null;
}

export function addStore(catalog, store) {
  const s = String(store ?? '').trim();
  if (!s) return;
  if (!catalog.stores.some((existing) => normalize(existing) === normalize(s))) {
    catalog.stores.push(s);
  }
}

// Add a price record to an item, creating the item on first sight.
// entry: { name, brand, store, price, size, unit, date }
export function addRecord(catalog, entry) {
  const name = String(entry.name ?? '').trim();
  const brand = String(entry.brand ?? '').trim();
  if (!name) throw new Error('Product name is required');

  let item = findItem(catalog, name, brand);
  let created = false;
  if (!item) {
    item = { id: newId(), name, brand, image: null, records: [] };
    catalog.items.push(item);
    created = true;
  }

  const record = {
    store: String(entry.store ?? '').trim(),
    price: Number(entry.price),
    size: Number(entry.size),
    unit: String(entry.unit ?? 'each').trim().toLowerCase(),
    date: entry.date,
  };
  item.records.push(record);
  addStore(catalog, record.store);
  return { item, record, created };
}

export function removeRecord(catalog, itemId, index) {
  const item = itemById(catalog, itemId);
  if (!item) return false;
  if (index < 0 || index >= item.records.length) return false;
  item.records.splice(index, 1);
  return true;
}

export function removeItem(catalog, itemId) {
  const idx = catalog.items.findIndex((item) => item.id === itemId);
  if (idx === -1) return false;
  catalog.items.splice(idx, 1);
  return true;
}

// Normalised unit price so different pack sizes compare fairly.
// Returns { value, label } or null when the unit is unknown.
export function unitPrice(price, size, unit) {
  const p = Number(price);
  const s = Number(size);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0 || p < 0) return null;
  const u = normalize(unit);

  if (u in MASS_UNITS) {
    const grams = s * MASS_UNITS[u];
    const value = (p / grams) * 100;
    return { value, label: `£${value.toFixed(2)}/100g`, basis: 'mass' };
  }
  if (u in VOLUME_UNITS) {
    const ml = s * VOLUME_UNITS[u];
    const value = (p / ml) * 100;
    return { value, label: `£${value.toFixed(2)}/100ml`, basis: 'volume' };
  }
  if (u in EACH_UNITS) {
    const value = p / s;
    return { value, label: `£${value.toFixed(2)}/each`, basis: 'each' };
  }
  return null;
}

export function unitPriceLabel(price, size, unit) {
  const up = unitPrice(price, size, unit);
  return up ? up.label : '—';
}

// Most recent record per store for an item. Map iteration order = first-seen stores.
export function latestPerStore(item) {
  const map = new Map();
  for (const rec of item.records || []) {
    const prev = map.get(rec.store);
    if (!prev || String(rec.date || '') >= String(prev.date || '')) {
      map.set(rec.store, rec);
    }
  }
  return map;
}

// Cheapest current record across all stores (price, not unit price: what you actually pay).
export function bestOffer(item) {
  let best = null;
  for (const [store, rec] of latestPerStore(item)) {
    const price = Number(rec.price);
    if (!Number.isFinite(price)) continue;
    if (!best || price < best.price) best = { store, record: rec, price };
  }
  return best;
}

// --- Similarity grouping -----------------------------------------------------

function groupTokens(name) {
  return new Set(
    normalize(name)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(' ')
      .filter((t) => t && !/^\d/.test(t) && !STOP_WORDS.has(t))
  );
}

function tokenSim(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

export const GROUP_THRESHOLD = 0.85;

// Cluster items whose names describe the same product (different sizes, wording,
// or missing brand all count as "similar"). Returns array of clusters (arrays).
export function groupItems(items) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  const tokens = items.map((it) => groupTokens(it.name));
  const canon = items.map((it) => canonicalName(it.name));

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (canon[i] && canon[i] === canon[j]) {
        union(i, j);
      } else if (tokenSim(tokens[i], tokens[j]) >= GROUP_THRESHOLD) {
        union(i, j);
      }
    }
  }

  const groups = new Map();
  items.forEach((item, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  return [...groups.values()];
}

export function clusterForItem(catalog, itemId) {
  const cluster = groupItems(catalog.items).find((group) =>
    group.some((item) => item.id === itemId)
  );
  return cluster || [];
}

// --- Merging (import / multi-device sync) ------------------------------------

function recordKey(rec) {
  return [
    normalize(rec.store),
    rec.date,
    Number(rec.price),
    Number(rec.size),
    normalize(rec.unit),
  ].join('|');
}

// Union-merge two catalogs. `preferred` fields win on conflict for shared ids.
export function mergeCatalogs(preferred, other) {
  const byId = new Map();
  const order = [];

  const takeItem = (item) => {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, {
        id: item.id,
        name: item.name,
        brand: item.brand || '',
        image: item.image || null,
        records: [],
        _seen: new Set(),
      });
      order.push(item.id);
    }
    const target = byId.get(item.id);
    if (!target.image && item.image) target.image = item.image;
    if (!target.name && item.name) target.name = item.name;
    for (const rec of item.records || []) {
      const key = recordKey(rec);
      if (!target._seen.has(key)) {
        target._seen.add(key);
        target.records.push({ ...rec });
      }
    }
  };

  (preferred?.items || []).forEach(takeItem);
  (other?.items || []).forEach(takeItem);

  const items = order.map((id) => {
    const item = byId.get(id);
    delete item._seen;
    return item;
  });

  const stores = [];
  const seenStores = new Set();
  for (const list of [preferred?.stores || [], other?.stores || []]) {
    for (const store of list) {
      const key = normalize(store);
      if (key && !seenStores.has(key)) {
        seenStores.add(key);
        stores.push(store);
      }
    }
  }

  const updated =
    [preferred?.updated, other?.updated].filter(Boolean).sort().pop() ||
    new Date().toISOString();

  return { items, stores, updated };
}

export function stats(catalog) {
  let records = 0;
  for (const item of catalog.items) records += (item.records || []).length;
  return {
    items: catalog.items.length,
    records,
    stores: catalog.stores.length,
    images: catalog.items.filter((item) => item.image).length,
  };
}

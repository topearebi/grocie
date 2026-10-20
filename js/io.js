// Import / export helpers: CSV round-trips via PapaParse, JSON with embedded
// image data URLs so a single file fully restores the catalog on another device.

import { csvEscape, todayISO } from './util.js';

export function catalogToCSV(catalog) {
  const lines = [['name', 'brand', 'store', 'price', 'size', 'unit', 'date'].join(',')];
  for (const item of catalog.items) {
    for (const rec of item.records || []) {
      lines.push(
        [item.name, item.brand, rec.store, rec.price, rec.size, rec.unit, rec.date]
          .map(csvEscape)
          .join(',')
      );
    }
  }
  return lines.join('\n');
}

function normalizeDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // UK-style dd/mm/yyyy (also accepts dots and dashes).
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${dayFirst[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return todayISO();
}

// Parse CSV text into validated record entries. Throws on unusable input.
export function parseCSVEntries(text) {
  const Papa = globalThis.Papa;
  if (!Papa) throw new Error('CSV parser failed to load — try again with network access.');

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase() });
  const rows = parsed.data || [];

  const entries = [];
  for (const row of rows) {
    const name = String(row.name ?? row.item ?? '').trim();
    const store = String(row.store ?? '').trim();
    const price = Number(String(row.price ?? '').replace(/[£\s]/g, ''));
    if (!name || !store || !Number.isFinite(price) || price < 0) continue;

    let size = Number(String(row.size ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(size) || size <= 0) size = 1;

    entries.push({
      name,
      brand: String(row.brand ?? '').trim(),
      store,
      price,
      size,
      unit: String(row.unit ?? 'each').trim().toLowerCase() || 'each',
      date: normalizeDate(row.date),
    });
  }

  if (entries.length === 0) {
    throw new Error(
      'No valid rows found. Expected columns: name, brand, store, price, size, unit, date.'
    );
  }
  return entries;
}

// Return a copy of the catalog whose image paths are resolved into data URLs.
export async function embedImages(catalog) {
  const items = await Promise.all(
    catalog.items.map(async (item) => {
      if (!item.image || item.image.startsWith('data:')) return item;
      try {
        const response = await fetch(item.image, { cache: 'no-cache' });
        if (!response.ok) return item;
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(blob);
        });
        return { ...item, image: dataUrl };
      } catch {
        return item; // keep the path; export still works, just without this photo
      }
    })
  );
  return { ...catalog, items };
}

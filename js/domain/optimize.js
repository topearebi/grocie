// Basket optimisation: pick the cheapest recorded store for every list item.

import { itemById, latestPerStore, unitPrice } from './catalog.js';

// listIds: array of item ids in the shopping list.
// Returns rows (one per item), per-store totals, grand total, number of stops,
// and the best single-store baseline for comparison.
export function optimizeList(catalog, listIds) {
  const rows = [];

  for (const id of listIds) {
    const item = itemById(catalog, id);
    if (!item) continue; // item deleted since it was added

    const offers = [...latestPerStore(item)]
      .map(([store, rec]) => ({
        store,
        price: Number(rec.price),
        date: rec.date,
        size: rec.size,
        unit: rec.unit,
        record: rec,
        unitPrice: unitPrice(rec.price, rec.size, rec.unit),
      }))
      .filter((offer) => Number.isFinite(offer.price))
      .sort((a, b) => a.price - b.price);

    if (offers.length === 0) {
      rows.push({ item, noData: true });
      continue;
    }

    const best = offers[0];
    rows.push({ item, best, offers, up: best.unitPrice });
  }

  const storeTotals = {};
  const storeCounts = {};
  let grandTotal = 0;
  const storesUsed = new Set();
  for (const row of rows) {
    if (row.noData) continue;
    storeTotals[row.best.store] = (storeTotals[row.best.store] || 0) + row.best.price;
    storeCounts[row.best.store] = (storeCounts[row.best.store] || 0) + 1;
    grandTotal += row.best.price;
    storesUsed.add(row.best.store);
  }

  // Baseline: what the same basket would cost from one single store.
  // Prefer stores that stock everything; among those pick the cheapest.
  const priced = rows.filter((row) => !row.noData);
  let baseline = null;
  if (priced.length > 0) {
    const candidates = new Set();
    priced.forEach((row) => row.offers.forEach((offer) => candidates.add(offer.store)));
    for (const store of candidates) {
      let total = 0;
      let missing = 0;
      for (const row of priced) {
        const offer = row.offers.find((o) => o.store === store);
        if (offer) total += offer.price;
        else missing += 1;
      }
      if (
        !baseline ||
        missing < baseline.missing ||
        (missing === baseline.missing && total < baseline.total)
      ) {
        baseline = { store, total, missing };
      }
    }
  }

  const savings =
    baseline && baseline.missing === 0 ? Math.max(0, baseline.total - grandTotal) : null;

  return {
    rows,
    storeTotals,
    storeCounts,
    grandTotal,
    stops: storesUsed.size,
    baseline,
    savings,
    noDataCount: rows.filter((row) => row.noData).length,
    itemCount: rows.length,
  };
}

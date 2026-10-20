// Fuzzy product search (Fuse.js from CDN), with a plain substring fallback.

export function searchItems(items, term) {
  const query = String(term ?? '').trim();
  if (!query) {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  const FuseCtor = globalThis.Fuse;
  if (FuseCtor) {
    const fuse = new FuseCtor(items, {
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'brand', weight: 0.25 },
        { name: 'records.store', weight: 0.15 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    });
    const results = fuse.search(query);
    if (results.length > 0) return results.map((r) => r.item);
    return [];
  }

  // Fallback: case-insensitive substring match on name/brand.
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.brand || '').toLowerCase().includes(q)
  );
}

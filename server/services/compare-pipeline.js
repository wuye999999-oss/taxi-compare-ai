// Merges sandbox-scraped items and API-sourced items into a single goods_list
// that the frontend's existing buildPriceModel() pipeline can consume without changes.
//
// Deduplication strategy: sandbox results win over API results when two items
// share the same platform and a name prefix that matches within 20 chars.
// This prevents showing inflated API prices when we already have a live price.

export function mergeResults(sandboxItems = [], apiItems = []) {
  const tagged = [
    ...sandboxItems.map(i => ({ ...i, source: 'sandbox' })),
    ...apiItems.map(i => ({ ...i, source: i.source || 'api' })),
  ];

  const seen = new Set();
  const merged = [];
  for (const item of tagged) {
    const nameKey = (item.goods_name || '').slice(0, 20).toLowerCase().replace(/\s+/g, '');
    const dedupeKey = `${item.platform}:${nameKey}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      merged.push(item);
    }
  }

  return { goods_list: merged };
}

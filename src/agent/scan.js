// Photo -> structured pack list. SAM 3.1 finds packs, Muse Spark reads them, the
// matcher ties each to the catalog or flags it for a human.
import { matchReading } from '../inventory/match.js';
import { parseExpiry, expiryStatus } from '../inventory/expiry.js';

export async function scanPhoto(imagePath, { provider, catalog, asOf, nearDays = 90 }) {
  const boxes = await provider.detectPacks(imagePath);
  const readings = await provider.readPacks(imagePath, boxes);
  const packs = readings.map((r, i) => {
    const m = matchReading(r, catalog);
    const expiry = parseExpiry(r.expiry);
    return {
      region: i,
      box: boxes[i],
      reading: r,
      sku: m.sku,
      candidateSku: m.candidateSku,
      matchScore: m.score,
      needsReview: m.needsReview,
      reviewReasons: m.reasons,
      expiry,
      expiryStatus: expiryStatus(expiry, asOf, nearDays),
    };
  });
  return { image: imagePath, provider: provider.name, asOf, packs };
}

// Group confidently identified packs by (sku, lot).
export function groupByLot(packs) {
  const map = new Map();
  for (const p of packs) {
    if (p.needsReview) continue;
    const key = `${p.sku}|${p.reading.lot}`;
    const g = map.get(key) ?? { sku: p.sku, lot: p.reading.lot, expiry: p.expiry, expiryStatus: p.expiryStatus, count: 0 };
    g.count += 1;
    map.set(key, g);
  }
  return [...map.values()];
}

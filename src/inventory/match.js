// Match a label reading to the synthetic catalog. Identification only: we never
// propose a different product when the match is poor; we send it to a human.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export const THRESHOLDS = { name: 0.85, reading: 0.7 };

export function matchReading(reading, catalog) {
  let best = null;
  for (const item of catalog.items) {
    const nameScore = similarity(reading.name, item.name);
    const strengthOk = norm(reading.strength) === norm(item.strength);
    const packOk = reading.pack_size == null || Number(reading.pack_size) === item.pack_size;
    const score = nameScore * (strengthOk ? 1 : 0.6) * (packOk ? 1 : 0.8);
    if (!best || score > best.score) best = { item, score, nameScore, strengthOk, packOk };
  }
  const reasons = [];
  if (!best || best.nameScore < THRESHOLDS.name) reasons.push('name not confidently matched');
  if (best && !best.strengthOk) reasons.push('strength differs from catalog');
  if (best && !best.packOk) reasons.push('pack size differs from catalog');
  if ((reading.confidence ?? 0) < THRESHOLDS.reading) reasons.push('low read confidence');
  if (!reading.lot || /\?/.test(reading.lot)) reasons.push('lot code unreadable');
  if (!reading.expiry || /\?/.test(reading.expiry)) reasons.push('expiry unreadable');
  return {
    sku: reasons.length === 0 ? best.item.sku : null,
    candidateSku: best?.item.sku ?? null,
    score: Number((best?.score ?? 0).toFixed(3)),
    needsReview: reasons.length > 0,
    reasons,
  };
}

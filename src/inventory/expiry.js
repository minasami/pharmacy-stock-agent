// Expiry parsing and classification. Pack expiry printed as month/year means
// "use by the end of that month", so MM/YYYY resolves to the last day of the month.

export function parseExpiry(raw) {
  if (!raw || /\?/.test(raw)) return null;
  const s = String(raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) return endOfMonth(+m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return endOfMonth(+m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{2})$/))) return endOfMonth(2000 + +m[2], +m[1]);
  return null;
}

function iso(y, mo, d) {
  if (mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function endOfMonth(y, mo) {
  if (mo < 1 || mo > 12) return null;
  return iso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate());
}

export function daysUntil(expiryIso, asOfIso) {
  return Math.round((Date.parse(expiryIso) - Date.parse(asOfIso)) / 86_400_000);
}

// 'expired' | 'near_expiry' | 'ok' | 'unknown'
export function expiryStatus(expiryIso, asOfIso, nearDays = 90) {
  if (!expiryIso) return 'unknown';
  const d = daysUntil(expiryIso, asOfIso);
  if (d < 0) return 'expired';
  if (d <= nearDays) return 'near_expiry';
  return 'ok';
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

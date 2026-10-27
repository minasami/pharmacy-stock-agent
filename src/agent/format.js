import { assertNonClinical } from '../safety/guard.js';

export function formatRestock(draft) {
  const out = [];
  out.push(`RESTOCK ORDER DRAFT - ${draft.pharmacy} - ${draft.asOf}`);
  out.push('Status: DRAFT, awaiting pharmacist approval. Nothing has been sent.');
  out.push('Synthetic demo data.');
  if (!draft.lines.length) out.push('', 'No items are at or below their reorder point.');
  for (const [supplier, lines] of Object.entries(draft.bySupplier)) {
    out.push('', `To: ${supplier}`);
    for (const l of lines) {
      const near = l.nearExpiryQty ? ` (${l.nearExpiryQty} of these near expiry)` : '';
      out.push(`  - ${l.name} ${l.strength} x${l.pack_size}: order ${l.orderQty} packs  [on hand ${l.onHand}${near}, reorder at ${l.reorderPoint}, par ${l.parLevel}]`);
    }
  }
  out.push('', 'Approved by (pharmacist): ____________________   Date: __________');
  return assertNonClinical(out.join('\n'));
}

export function formatExpiry(rep) {
  const row = (r) => `  - ${r.name} lot ${r.lot}: ${r.qty} packs, expiry ${r.expiry} (${r.days < 0 ? `${-r.days} days ago` : `in ${r.days} days`})`;
  return [
    `Expired (pull from sale): ${rep.expired.length}`, ...rep.expired.map(row),
    `Near expiry: ${rep.nearExpiry.length}`, ...rep.nearExpiry.map(row),
  ].join('\n');
}

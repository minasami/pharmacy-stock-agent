// The three jobs the agent does. Each returns a report and, where stock would change,
// a change set that waits for pharmacist approval.
import { scanPhoto, groupByLot } from './scan.js';
import { expiryStatus, daysUntil } from '../inventory/expiry.js';

// Shelf photo: audit what is visible. Flags expired / near-expiry packs to pull,
// packs whose lot is not in the system, and packs that need a human to read.
// A shelf photo shows facings, not a full count, so it never overwrites quantities;
// expired lots seen on the shelf are proposed for quarantine.
export async function shelfAudit(imagePath, ctx) {
  const scan = await scanPhoto(imagePath, ctx);
  const inv = await ctx.store.inventory();
  const lots = groupByLot(scan.packs);
  const pull = lots.filter((l) => l.expiryStatus === 'expired');
  const soon = lots.filter((l) => l.expiryStatus === 'near_expiry');
  const unknownLots = lots.filter((l) => !inv.lots.some((x) => x.sku === l.sku && x.lot === l.lot));
  const review = scan.packs.filter((p) => p.needsReview);
  const changeSet = pull.length ? await ctx.store.propose({
    kind: 'shelf_quarantine',
    source: imagePath,
    changes: pull.map((l) => ({ op: 'quarantine', sku: l.sku, lot: l.lot, reason: `expired ${l.expiry}` })),
  }) : null;
  return { kind: 'shelf_audit', scan, seenLots: lots, pull, nearExpiry: soon, unknownLots, review, changeSet };
}

// Delivery photo: count packs per lot and propose receiving them into stock.
// Packs that arrive already expired or near expiry are flagged, not received.
export async function deliveryIntake(imagePath, ctx) {
  const scan = await scanPhoto(imagePath, ctx);
  const lots = groupByLot(scan.packs);
  const accept = lots.filter((l) => l.expiryStatus === 'ok');
  const flagged = lots.filter((l) => l.expiryStatus !== 'ok');
  const review = scan.packs.filter((p) => p.needsReview);
  const changeSet = accept.length ? await ctx.store.propose({
    kind: 'delivery_receive',
    source: imagePath,
    changes: accept.map((l) => ({ op: 'receive', sku: l.sku, lot: l.lot, expiry: l.expiry, qty: l.count })),
  }) : null;
  return { kind: 'delivery_intake', scan, received: accept, flagged, review, changeSet };
}

// Whole-inventory expiry report.
export function expiryReport(inv, catalog, asOf, nearDays = 90) {
  const name = (sku) => catalog.items.find((i) => i.sku === sku)?.name ?? sku;
  const rows = inv.lots.filter((l) => l.qty > 0).map((l) => ({
    ...l, name: name(l.sku), status: expiryStatus(l.expiry, asOf, nearDays), days: daysUntil(l.expiry, asOf),
  }));
  return {
    expired: rows.filter((r) => r.status === 'expired').sort((a, b) => a.days - b.days),
    nearExpiry: rows.filter((r) => r.status === 'near_expiry').sort((a, b) => a.days - b.days),
  };
}

// Draft restock order. Expired lots do not count as stock. Near-expiry lots count,
// but are listed so the pharmacist can decide. Output is a draft only; nothing is sent.
export function draftRestock(inv, catalog, asOf, nearDays = 90) {
  const lines = [];
  for (const item of catalog.items) {
    const lots = inv.lots.filter((l) => l.sku === item.sku);
    const usable = lots.filter((l) => expiryStatus(l.expiry, asOf, nearDays) !== 'expired').reduce((s, l) => s + l.qty, 0);
    const nearQty = lots.filter((l) => expiryStatus(l.expiry, asOf, nearDays) === 'near_expiry').reduce((s, l) => s + l.qty, 0);
    if (usable <= item.reorder_point) {
      lines.push({
        sku: item.sku, name: item.name, strength: item.strength, pack_size: item.pack_size,
        supplier: item.supplier, onHand: usable, nearExpiryQty: nearQty,
        reorderPoint: item.reorder_point, parLevel: item.par_level, orderQty: item.par_level - usable,
      });
    }
  }
  const bySupplier = {};
  for (const l of lines) (bySupplier[l.supplier] ??= []).push(l);
  return { status: 'draft_awaiting_pharmacist_approval', asOf, pharmacy: inv.pharmacy, lines, bySupplier };
}

// Put doubtful packs from a scan in the pharmacist review queue (shared by the web
// scan endpoint and the agent tools). Returns the new review items.
export async function queueReviews(store, mode, imageUrl, reviewPacks) {
  return store.addReviews(reviewPacks.map((p) => ({
    source: mode, image: imageUrl, region: p.region, box: p.box, reading: p.reading, reasons: p.reviewReasons,
  })));
}

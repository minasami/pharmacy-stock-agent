// File-backed inventory with a pending change queue. Nothing changes stock until a
// pharmacist approves the change set.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(ROOT, 'data');

export async function loadJson(p) { return JSON.parse(await readFile(p, 'utf8')); }
async function saveJson(p, v) { await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(v, null, 2) + '\n'); }

export class Store {
  constructor(stateDir = join(ROOT, 'state')) {
    this.dir = stateDir;
    this.invPath = join(stateDir, 'inventory.json');
    this.pendingPath = join(stateDir, 'pending.json');
    this.logPath = join(stateDir, 'audit-log.json');
    this.reviewPath = join(stateDir, 'review.json');
  }

  async catalog() { return loadJson(join(DATA, 'catalog.json')); }

  async inventory() {
    if (!existsSync(this.invPath)) await this.reset();
    return loadJson(this.invPath);
  }

  async reset() {
    const seed = await loadJson(join(DATA, 'inventory.seed.json'));
    await saveJson(this.invPath, { pharmacy: seed.pharmacy, lots: seed.lots });
    await saveJson(this.pendingPath, []);
    await saveJson(this.logPath, []);
    await saveJson(this.reviewPath, []);
  }

  async pending() { return existsSync(this.pendingPath) ? loadJson(this.pendingPath) : []; }

  async propose(changeSet) {
    const list = await this.pending();
    const id = `CS-${String(list.length + 1).padStart(3, '0')}`;
    const cs = { id, status: 'awaiting_pharmacist_approval', createdAt: new Date().toISOString(), ...changeSet };
    list.push(cs);
    await saveJson(this.pendingPath, list);
    return cs;
  }

  // Apply an approved change set. `approver` is recorded in the audit log.
  async approve(id, approver) {
    if (!approver) throw new Error('An approving pharmacist name is required.');
    const list = await this.pending();
    const cs = list.find((c) => c.id === id);
    if (!cs) throw new Error(`No change set ${id}`);
    if (cs.status !== 'awaiting_pharmacist_approval') throw new Error(`${id} is already ${cs.status}`);
    const inv = await this.inventory();
    for (const ch of cs.changes ?? []) applyChange(inv, ch);
    cs.status = 'approved';
    cs.approvedBy = approver;
    cs.approvedAt = new Date().toISOString();
    await saveJson(this.invPath, inv);
    await saveJson(this.pendingPath, list);
    await this.log({ at: cs.approvedAt, id, kind: cs.kind, approver, changes: cs.changes?.length ?? 0 });
    return cs;
  }

  async reject(id, approver, reason = '') {
    if (!approver) throw new Error('A pharmacist name is required to reject.');
    const list = await this.pending();
    const cs = list.find((c) => c.id === id);
    if (!cs) throw new Error(`No change set ${id}`);
    if (cs.status !== 'awaiting_pharmacist_approval') throw new Error(`${id} is already ${cs.status}`);
    Object.assign(cs, { status: 'rejected', rejectedBy: approver, rejectedAt: new Date().toISOString(), reason });
    await saveJson(this.pendingPath, list);
    await this.log({ at: cs.rejectedAt, id, kind: `${cs.kind}_rejected`, approver, changes: 0 });
    return cs;
  }

  async auditLog() { return existsSync(this.logPath) ? loadJson(this.logPath) : []; }
  async log(entry) { const log = await this.auditLog(); log.push(entry); await saveJson(this.logPath, log); }

  // Review queue: packs the agent could not read or match with confidence.
  // A pharmacist resolves each one by name; the agent never guesses for them.
  async reviews() { return existsSync(this.reviewPath) ? loadJson(this.reviewPath) : []; }

  async addReviews(items) {
    const list = await this.reviews();
    const added = items.map((it, k) => ({
      id: `RV-${String(list.length + k + 1).padStart(3, '0')}`,
      status: 'open', createdAt: new Date().toISOString(), ...it,
    }));
    list.push(...added);
    await saveJson(this.reviewPath, list);
    return added;
  }

  async resolveReview(id, by, resolution) {
    if (!by) throw new Error('A pharmacist name is required to resolve a review item.');
    const list = await this.reviews();
    const rv = list.find((r) => r.id === id);
    if (!rv) throw new Error(`No review item ${id}`);
    if (rv.status !== 'open') throw new Error(`${id} is already ${rv.status}`);
    Object.assign(rv, { status: 'resolved', resolvedBy: by, resolvedAt: new Date().toISOString(), resolution });
    await saveJson(this.reviewPath, list);
    await this.log({ at: rv.resolvedAt, id, kind: `review_${resolution.action}`, approver: by, changes: 0 });
    return rv;
  }
}

export function applyChange(inv, ch) {
  const lot = inv.lots.find((l) => l.sku === ch.sku && l.lot === ch.lot);
  if (ch.op === 'receive') {
    if (lot) lot.qty += ch.qty;
    else inv.lots.push({ sku: ch.sku, lot: ch.lot, expiry: ch.expiry, qty: ch.qty });
  } else if (ch.op === 'quarantine') {
    // Expired packs leave sellable stock; they are tracked for return/destruction.
    if (lot) { lot.quarantined = (lot.quarantined ?? 0) + lot.qty; lot.qty = 0; }
  } else if (ch.op === 'set_count') {
    if (lot) lot.qty = ch.qty;
    else inv.lots.push({ sku: ch.sku, lot: ch.lot, expiry: ch.expiry, qty: ch.qty });
  } else {
    throw new Error(`Unknown change op ${ch.op}`);
  }
}

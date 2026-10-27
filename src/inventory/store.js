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
    const log = existsSync(this.logPath) ? await loadJson(this.logPath) : [];
    log.push({ at: cs.approvedAt, id, kind: cs.kind, approver, changes: cs.changes?.length ?? 0 });
    await saveJson(this.logPath, log);
    return cs;
  }

  async reject(id, approver, reason = '') {
    const list = await this.pending();
    const cs = list.find((c) => c.id === id);
    if (!cs) throw new Error(`No change set ${id}`);
    Object.assign(cs, { status: 'rejected', rejectedBy: approver, reason });
    await saveJson(this.pendingPath, list);
    return cs;
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

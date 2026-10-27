import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/web/server.js';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';

let server, base;
const store = new Store(mkdtempSync(join(tmpdir(), 'stock-web-')));
before(async () => {
  server = await startServer({ store, provider: mockProvider, asOf: '2026-10-27', cfg: { nearExpiryDays: 90 } });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(path, body) {
  const res = await fetch(base + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test('web: shelf scan returns boxes for the overlay and fills the review queue; stock waits for a named approval', async () => {
  await call('/api/reset', {});
  const r = await call('/api/scan', { mode: 'shelf', sample: 'shelf-01.png' });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, 'mock', 'replay provider is the default');
  assert.equal(r.body.packs.length, 9);
  assert.ok(r.body.packs.every((p) => Number.isFinite(p.box.x1) && p.box.x2 > p.box.x1));
  const unclear = r.body.packs.filter((p) => p.needsReview);
  assert.deepEqual(unclear.map((p) => p.reviewId), ['RV-001']);
  const q = await call('/api/review');
  assert.equal(q.body[0].status, 'open');

  const id = r.body.changeSet.id;
  assert.equal((await call(`/api/changesets/${id}/approve`, {})).status, 400, 'name required');
  assert.equal((await call(`/api/changesets/${id}/approve`, { by: '  ' })).status, 400, 'blank name refused');
  const lotBefore = (await call('/api/inventory')).body.lots.find((l) => l.lot === 'DG2308F');
  assert.equal(lotBefore.qty, 2, 'nothing changed before approval');
  const ok = await call(`/api/changesets/${id}/approve`, { by: 'Demo Pharmacist' });
  assert.equal(ok.body.approvedBy, 'Demo Pharmacist');
  assert.equal((await call(`/api/changesets/${id}/approve`, { by: 'Demo Pharmacist' })).status, 409);
  const lotAfter = (await call('/api/inventory')).body.lots.find((l) => l.lot === 'DG2308F');
  assert.deepEqual([lotAfter.qty, lotAfter.quarantined, lotAfter.status], [0, 2, 'expired']);
  const log = (await call('/api/audit')).body;
  assert.equal(log.at(-1).approver, 'Demo Pharmacist');
});

test('web: review items are resolved by a named pharmacist who records what is printed', async () => {
  await call('/api/reset', {});
  await call('/api/scan', { mode: 'shelf', sample: 'shelf-01.png' });
  assert.equal((await call('/api/review/RV-001/resolve', { action: 'identify', sku: 'SYN-005', lot: 'DG2410Z', expiry: '09/2026' })).status, 400, 'name required');
  assert.equal((await call('/api/review/RV-001/resolve', { action: 'identify', by: 'Demo Pharmacist', lot: 'DG2410Z', expiry: '09/2026' })).status, 400, 'no item chosen');
  assert.equal((await call('/api/review/RV-001/resolve', { action: 'identify', by: 'Demo Pharmacist', sku: 'SYN-005', lot: 'DG2410Z', expiry: '0?/2026' })).status, 400, 'unreadable expiry refused');
  const r = await call('/api/review/RV-001/resolve', { action: 'identify', by: 'Demo Pharmacist', sku: 'SYN-005', lot: 'DG2410Z', expiry: '09/2026' });
  assert.equal(r.status, 200);
  assert.equal(r.body.review.resolvedBy, 'Demo Pharmacist');
  assert.equal(r.body.changeSet.kind, 'review_quarantine', 'an expired pack found in review is proposed for quarantine, not applied');
  assert.equal(r.body.changeSet.status, 'awaiting_pharmacist_approval');
  assert.equal((await call('/api/review/RV-001/resolve', { action: 'set_aside', by: 'Demo Pharmacist' })).status, 409);
});

test('web: uploads under the replay provider work for bundled samples only; delivery and restock stay drafts', async () => {
  await call('/api/reset', {});
  const png = readFileSync('samples/delivery-01.png');
  const up = await call('/api/scan', { mode: 'delivery', image: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(up.status, 200);
  assert.deepEqual(up.body.summary.toReceive.map((l) => [l.sku, l.count]), [['SYN-002', 2], ['SYN-007', 1]]);
  const other = await call('/api/scan', { image: `data:image/png;base64,${Buffer.concat([png, Buffer.from('x')]).toString('base64')}` });
  assert.equal(other.status, 422);
  assert.match(other.body.error, /replay provider/);
  assert.equal((await call('/api/scan', { image: 'data:image/png;base64,aGVsbG8=' })).status, 415);
  const d = await call('/api/restock');
  assert.equal(d.body.status, 'draft_awaiting_pharmacist_approval');
  assert.match(d.body.text, /Nothing has been sent/);
  const ask = await call('/api/ask', { question: 'Can I swap Ibuprofen for Paracetamol?' });
  assert.equal(ask.body.refused, true);
});

test('web: serves the UI and blocks path traversal', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Pharmacy Stock Agent/);
  for (const p of ['/samples/..%2fpackage.json', '/samples/../package.json', '/uploads/..%2f..%2fpackage.json', '/src/config.js', '/samples/%E0%A4%A']) {
    const res = await fetch(base + p);
    assert.ok([400, 404].includes(res.status), `${p} -> ${res.status}`);
  }
});

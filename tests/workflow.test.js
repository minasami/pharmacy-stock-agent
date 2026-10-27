import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { metaProvider } from '../src/providers/meta.js';
import { shelfAudit, deliveryIntake, draftRestock, expiryReport } from '../src/agent/workflows.js';
import { formatRestock } from '../src/agent/format.js';

const asOf = '2026-10-27';
async function ctx(provider = mockProvider) {
  const store = new Store(mkdtempSync(join(tmpdir(), 'stock-test-')));
  await store.reset();
  return { provider, store, catalog: await store.catalog(), asOf, nearDays: 90 };
}

test('shelf audit flags expired, near-expiry and unreadable packs, and changes nothing until approved', async () => {
  const c = await ctx();
  const before = JSON.stringify(await c.store.inventory());
  const r = await shelfAudit('samples/shelf-01.png', c);
  assert.equal(r.scan.packs.length, 9);
  assert.deepEqual(r.pull.map((l) => l.lot), ['DG2308F']);
  assert.deepEqual(r.nearExpiry.map((l) => l.lot).sort(), ['NL2311C', 'OP2309K']);
  assert.equal(r.review.length, 1);
  assert.equal(JSON.stringify(await c.store.inventory()), before, 'no stock change before approval');
  await assert.rejects(c.store.approve(r.changeSet.id), /pharmacist/);
  await c.store.approve(r.changeSet.id, 'Test Pharmacist');
  const lot = (await c.store.inventory()).lots.find((l) => l.lot === 'DG2308F');
  assert.deepEqual([lot.qty, lot.quarantined], [0, 2]);
});

test('delivery intake receives good lots and refuses near-expiry stock', async () => {
  const c = await ctx();
  const r = await deliveryIntake('samples/delivery-01.png', c);
  assert.deepEqual(r.received.map((l) => [l.sku, l.count]), [['SYN-002', 2], ['SYN-007', 1]]);
  assert.deepEqual(r.flagged.map((l) => l.lot), ['OP2408N']);
  await c.store.approve(r.changeSet.id, 'Test Pharmacist');
  const inv = await c.store.inventory();
  assert.equal(inv.lots.find((l) => l.lot === 'NL2409T').qty, 2);
});

test('restock draft ignores expired stock and stays a non-clinical draft', async () => {
  const c = await ctx();
  const inv = await c.store.inventory();
  const d = draftRestock(inv, c.catalog, asOf);
  const ome = d.lines.find((l) => l.sku === 'SYN-005');
  assert.equal(ome.onHand, 6, 'expired lot DG2308F not counted');
  assert.equal(ome.orderQty, 14);
  assert.equal(d.status, 'draft_awaiting_pharmacist_approval');
  assert.match(formatRestock(d), /Nothing has been sent/);
  assert.equal(expiryReport(inv, c.catalog, asOf).expired.length, 1);
});

test('meta provider calls SAM 3.1 then Muse Spark with the right shape (fake fetch)', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.authorization });
    const payload = url.endsWith('/responses')
      ? { output_text: '<0f>0<|box;x1=30;y1=50;x2=250;y2=170|><0f>1<|box;x1=270;y1=50;x2=490;y2=170|>' }
      : { choices: [{ message: { content: JSON.stringify({ packs: [{ region: 0, name: 'Paracetamol', strength: '500 mg', pack_size: 20, lot: 'NL2405A', expiry: '09/2027', confidence: 0.9 }] }) } }] };
    return { ok: true, json: async () => payload };
  };
  const p = metaProvider({ apiKey: 'LLM_test', baseUrl: 'https://api.meta.ai/v1', visionModel: 'muse-spark-1.3', samModel: 'sam-3.1' }, fakeFetch);
  const boxes = await p.detectPacks('samples/shelf-01.png');
  const reads = await p.readPacks('samples/shelf-01.png', boxes);
  assert.equal(calls[0].body.model, 'sam-3.1');
  assert.equal(calls[1].body.model, 'muse-spark-1.3');
  const sam = calls[0].body.input[0];
  assert.deepEqual([sam.type, sam.role, sam.content.map((c) => c.type)], ['message', 'user', ['input_text', 'input_image']]);
  assert.equal(sam.content[0].text, 'medicine box');
  assert.match(sam.content[1].image_url, /^data:image\/png;base64,/);
  assert.ok(calls[0].url.endsWith('/v1/responses') && calls[1].url.endsWith('/v1/chat/completions'));
  assert.equal(calls[1].body.response_format.type, 'json_schema');
  assert.equal(calls[0].auth, 'Bearer LLM_test');
  assert.equal(reads.length, 2);
  assert.equal(reads[1].confidence, 0, 'missing region becomes unreadable, not guessed');
});

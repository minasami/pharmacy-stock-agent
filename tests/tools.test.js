import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { toolDefinitions, executeTool, ToolError, TOOL_NAMES } from '../src/agent/tools.js';

async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'tools-test-')));
  await store.reset();
  const ctx = { provider: mockProvider, store, catalog: await store.catalog(), asOf: '2026-10-27', nearDays: 90 };
  const run = { id: 'AG-test', photos: [{ id: 'photo-1', path: 'samples/shelf-01.png', label: 'shelf-01.png' }, { id: 'photo-2', path: 'samples/delivery-01.png', label: 'delivery-01.png' }], processed: new Map(), changeSets: [], reviews: [], handoff: null };
  return { store, ctx, run };
}

test('tools: definitions follow the documented function-tool shape and restrict photos to the attached ones', () => {
  const defs = toolDefinitions([{ id: 'photo-1' }]);
  assert.deepEqual(defs.map((d) => d.function.name).sort(), [...TOOL_NAMES].sort());
  for (const d of defs) {
    assert.equal(d.type, 'function');
    assert.match(d.function.name, /^[a-zA-Z0-9_-]+$/);
    assert.equal(d.function.parameters.type, 'object');
    assert.ok(d.function.description.length > 20);
  }
  assert.deepEqual(defs.find((d) => d.function.name === 'shelf_audit').function.parameters.properties.photo.enum, ['photo-1']);
  assert.ok(!defs.some((d) => /approve/.test(d.function.name)), 'there is no approve tool');
  // With no photos, the photo tools are not offered at all.
  assert.deepEqual(toolDefinitions([]).map((d) => d.function.name), ['expiry_flags', 'restock_draft', 'request_human_review']);
});

test('tools: shelf_audit proposes but never applies, queues unreadable packs, and refuses a second scan of the same photo', async () => {
  const { store, ctx, run } = await setup();
  const before = JSON.stringify(await store.inventory());
  const out = await executeTool('shelf_audit', '{"photo":"photo-1"}', ctx, run);
  assert.equal(out.packs_detected, 9);
  assert.deepEqual(out.expired_to_pull.map((l) => l.lot), ['DG2308F']);
  assert.equal(out.proposed_change_set.status, 'awaiting_pharmacist_approval');
  assert.deepEqual(out.sent_to_review_queue, ['RV-001']);
  assert.equal(JSON.stringify(await store.inventory()), before, 'stock unchanged');
  await assert.rejects(executeTool('delivery_intake', { photo: 'photo-1' }, ctx, run), /already processed/);
  assert.equal((await store.pending()).length, 1, 'no duplicate change set');
});

test('tools: bad names, bad arguments, unknown photos and clinical notes are rejected', async () => {
  const { ctx, run } = await setup();
  await assert.rejects(executeTool('approve_change_set', '{}', ctx, run), ToolError);
  await assert.rejects(executeTool('shelf_audit', 'not json', ctx, run), /JSON object/);
  await assert.rejects(executeTool('shelf_audit', { photo: '../../etc/passwd' }, ctx, run), /Unknown photo/);
  await assert.rejects(executeTool('request_human_review', { note: 'Suggest a substitute for SYN-001' }, ctx, run), /clinical/);
  const h = await executeTool('request_human_review', { note: 'Carton label torn; please count by hand.', photo: 'photo-2' }, ctx, run);
  assert.equal(h.handed_to_pharmacist, true);
  assert.equal(run.handoff.photo, 'photo-2');
  const r = await executeTool('restock_draft', {}, ctx, run);
  assert.equal(r.note, 'Draft only. Nothing is sent.');
  const e = await executeTool('expiry_flags', undefined, ctx, run);
  assert.ok(e.expired.length >= 1);
});

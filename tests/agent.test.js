import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { runAgent } from '../src/agent/loop.js';
import { mockPlanner } from '../src/agent/planners.js';
import { REFUSAL } from '../src/safety/guard.js';

async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-test-')));
  await store.reset();
  return { provider: mockProvider, store, catalog: await store.catalog(), asOf: '2026-10-27', nearDays: 90 };
}
const shelf = { id: 'photo-1', path: 'samples/shelf-01.png', label: 'shelf-01.png' };
const delivery = { id: 'photo-2', path: 'samples/delivery-01.png', label: 'delivery-01.png' };

test('agent: mock planner picks the right tool per photo, then expiry and restock, and only proposes', async () => {
  const ctx = await setup();
  const before = JSON.stringify(await ctx.store.inventory());
  const r = await runAgent({ goal: 'Morning stock check', photos: [shelf, delivery], ctx, planner: mockPlanner() });
  assert.deepEqual(r.steps.map((s) => s.tool), ['shelf_audit', 'delivery_intake', 'expiry_flags', 'restock_draft']);
  assert.ok(r.steps.every((s) => s.ok));
  assert.equal(r.stoppedReason, 'final_answer');
  assert.equal(r.changeSets.length, 2);
  assert.ok(r.changeSets.every((c) => c.status === 'awaiting_pharmacist_approval'));
  assert.equal(r.pendingApproval, true);
  assert.match(r.answer, /waiting for pharmacist approval/);
  assert.equal(JSON.stringify(await ctx.store.inventory()), before, 'agent run changes no stock');
  assert.ok((await ctx.store.auditLog()).some((e) => e.kind === 'agent_run' && e.changes === 0));
});

test('agent: the goal steers tool choice', async () => {
  const ctx = await setup();
  const r = await runAgent({ goal: 'Which lots are expiring?', ctx, planner: mockPlanner() });
  assert.deepEqual(r.steps.map((s) => s.tool), ['expiry_flags']);
  const r2 = await runAgent({ goal: 'Check this delivery and draft the reorder', photos: [{ ...delivery, label: 'IMG_0042.png', id: 'photo-1' }], ctx: await setup(), planner: mockPlanner() });
  assert.deepEqual(r2.steps.map((s) => s.tool), ['delivery_intake', 'restock_draft']);
});

test('agent: clinical goals are refused before any planner call', async () => {
  const ctx = await setup();
  let called = 0;
  const planner = { name: 'spy', async next() { called++; return { role: 'assistant', content: 'x' }; } };
  const r = await runAgent({ goal: 'What can I give instead of SYN-001?', ctx, planner });
  assert.equal(r.refused, true);
  assert.equal(r.answer, REFUSAL);
  assert.equal(called, 0);
});

test('agent: unreadable photo is handed to the pharmacist instead of guessed', async () => {
  const ctx = await setup();
  const r = await runAgent({ goal: 'Audit this shelf', photos: [{ id: 'photo-1', path: 'samples/not-recorded.png', label: 'shelf-new.png' }], ctx, planner: mockPlanner() });
  assert.deepEqual(r.steps.map((s) => [s.tool, s.ok]), [['shelf_audit', false], ['request_human_review', true]]);
  assert.equal(r.stoppedReason, 'handed_to_pharmacist');
  assert.equal(r.changeSets.length, 0);
});

test('agent: step limit, duplicate calls, unknown tools and clinical final text are contained', async () => {
  const ctx = await setup();
  // A misbehaving planner that keeps asking for the same photo and an approve tool.
  let i = 0;
  const loopy = {
    name: 'loopy',
    async next() {
      i++;
      const name = i % 2 ? 'shelf_audit' : 'approve_change_set';
      return { role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name, arguments: '{"photo":"photo-1","id":"CS-001"}' } }] };
    },
  };
  const r = await runAgent({ goal: 'Audit', photos: [shelf], ctx, planner: loopy, maxSteps: 4 });
  assert.equal(r.stoppedReason, 'max_steps');
  assert.equal(r.steps.length, 4);
  assert.equal(r.changeSets.length, 1, 'same photo never produces a second change set');
  assert.match(r.steps[1].error, /Unknown tool/);
  assert.match(r.steps[2].error, /already processed/);
  assert.equal((await ctx.store.pending())[0].status, 'awaiting_pharmacist_approval', 'nothing approved');

  const chatty = { name: 'chatty', async next() { return { role: 'assistant', content: 'Use a substitute with a lower dose.' }; } };
  const r2 = await runAgent({ goal: 'Summarise stock', ctx: await setup(), planner: chatty });
  assert.equal(r2.answer, REFUSAL);
});

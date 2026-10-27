import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { runAgent } from '../src/agent/loop.js';
import { basetenPlanner, getPlanner } from '../src/agent/planners.js';
import { loadConfig } from '../src/config.js';

// Offline: a fake fetch plays Baseten Model APIs (OpenAI-compatible tool calling).
const KEY = 'bt_test_fake_key';
const cfg = { ...loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY }), sleep: async () => {} };
const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const toolTurn = (id, name, args) => ok({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, reasoning_content: 'private reasoning', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const textTurn = (content) => ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: 'private reasoning' } }] });

async function ctx() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'bt-planner-')));
  await store.reset();
  return { provider: mockProvider, store, catalog: await store.catalog(), asOf: '2026-10-27', nearDays: 90 };
}

test('baseten planner: documented tool-calling requests, tool results fed back, reasoning dropped', async () => {
  const replies = [toolTurn('call_1', 'shelf_audit', { photo: 'photo-1' }), toolTurn('call_2', 'restock_draft', {}), textTurn('Checked the shelf. CS-001 waits for approval.')];
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return replies[sent.length - 1]; };
  const r = await runAgent({ goal: 'Audit this shelf and draft the reorder', photos: [{ id: 'photo-1', path: 'samples/shelf-01.png', label: 'shelf-01.png' }], ctx: await ctx(), planner: basetenPlanner(cfg, fetch) });
  assert.equal(sent.length, 3);
  assert.equal(sent[0].url, 'https://inference.baseten.co/v1/chat/completions');
  assert.equal(sent[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(sent[0].body.model, 'meta-models/muse-spark-open-1026');
  assert.equal(sent[0].body.tool_choice, 'auto');
  assert.ok(!('parallel_tool_calls' in sent[0].body));
  const m2 = sent[1].body.messages;
  assert.deepEqual(m2.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(m2[3].tool_call_id, 'call_1');
  assert.ok(!JSON.stringify(sent.map((s) => s.body)).includes('private reasoning'));
  assert.deepEqual(r.steps.map((s) => s.tool), ['shelf_audit', 'restock_draft']);
  assert.equal(r.planner, 'baseten (meta-models/muse-spark-open-1026)');
  assert.equal(r.answer, 'Checked the shelf. CS-001 waits for approval.');
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.ok(!JSON.stringify(r).includes('private reasoning'));
});

test('baseten planner: two tool calls in one turn still run one step each, within the step cap', async () => {
  const two = ok({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [
    { id: 'a', type: 'function', function: { name: 'expiry_flags', arguments: '{}' } },
    { id: 'b', type: 'function', function: { name: 'restock_draft', arguments: '{}' } },
  ] } }] });
  const replies = [two, textTurn('Done.')];
  let n = 0;
  const r = await runAgent({ goal: 'Check expiry and draft the reorder', photos: [], ctx: await ctx(), planner: basetenPlanner(cfg, async () => replies[n++]), maxSteps: 1 });
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].tool, 'expiry_flags');
});

test('baseten planner: chosen by getPlanner for MODEL_PROVIDER=baseten; upstream errors say Baseten', async () => {
  assert.match(getPlanner(cfg).name, /^baseten \(/);
  const failing = basetenPlanner(cfg, async () => ({ ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad model' }));
  await assert.rejects(runAgent({ goal: 'Check expiry', photos: [], ctx: await ctx(), planner: failing }), /^Error: Baseten API \/chat\/completions failed: HTTP 400/);
});

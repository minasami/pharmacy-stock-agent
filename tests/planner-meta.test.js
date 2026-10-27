import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { runAgent } from '../src/agent/loop.js';
import { metaPlanner, getPlanner } from '../src/agent/planners.js';
import { loadConfig } from '../src/config.js';

// Offline: a fake fetch plays the Meta Model API, so this checks the request shape
// against the documented Chat Completions tool-calling format, not the live service.
const KEY = 'LLM_test_fake';
const cfg = { provider: 'meta', apiKey: KEY, baseUrl: 'https://api.example.test/v1', visionModel: 'muse-spark-1.3', agentModel: 'muse-spark-1.3', sleep: async () => {} };
const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const toolTurn = (id, name, args) => ok({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const textTurn = (content) => ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });

test('meta planner: sends documented tool-calling requests and feeds tool results back', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'meta-planner-')));
  await store.reset();
  const ctx = { provider: mockProvider, store, catalog: await store.catalog(), asOf: '2026-10-27', nearDays: 90 };
  const replies = [toolTurn('call_1', 'shelf_audit', { photo: 'photo-1' }), toolTurn('call_2', 'restock_draft', {}), textTurn('Checked the shelf. CS-001 waits for approval.')];
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return replies[sent.length - 1]; };
  const r = await runAgent({ goal: 'Audit this shelf and draft the reorder', photos: [{ id: 'photo-1', path: 'samples/shelf-01.png', label: 'shelf-01.png' }], ctx, planner: metaPlanner(cfg, fetch) });

  assert.equal(sent.length, 3);
  const first = sent[0];
  assert.equal(first.url, 'https://api.example.test/v1/chat/completions');
  assert.equal(first.init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(first.body.model, 'muse-spark-1.3');
  assert.equal(first.body.tool_choice, 'auto');
  assert.equal(first.body.parallel_tool_calls, false);
  assert.deepEqual(first.body.messages.map((m) => m.role), ['system', 'user']);
  assert.ok(first.body.tools.every((t) => t.type === 'function' && t.function.name && t.function.parameters));
  // Second request carries the assistant tool call and the matching tool result.
  const m2 = sent[1].body.messages;
  assert.deepEqual(m2.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(m2[2].tool_calls[0].id, 'call_1');
  assert.equal(m2[3].tool_call_id, 'call_1');
  assert.equal(JSON.parse(m2[3].content).proposed_change_set.status, 'awaiting_pharmacist_approval');
  assert.equal(r.stoppedReason, 'final_answer');
  assert.deepEqual(r.steps.map((s) => s.tool), ['shelf_audit', 'restock_draft']);
  assert.equal(r.answer, 'Checked the shelf. CS-001 waits for approval.');
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('meta planner: chosen only with the meta provider; agent model is configurable', () => {
  assert.equal(getPlanner({ provider: 'mock' }).name, 'mock');
  assert.match(getPlanner(cfg, async () => {}).name, /^meta \(muse-spark-1\.3\)$/);
  assert.equal(loadConfig({ MODEL_PROVIDER: 'meta', MODEL_API_KEY: KEY, META_AGENT_MODEL: 'muse-spark-x' }).agentModel, 'muse-spark-x');
  assert.equal(loadConfig({}).agentModel, 'muse-spark-1.3');
});

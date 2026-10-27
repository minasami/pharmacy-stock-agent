import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, providerLabel, ConfigError, BASETEN_DEFAULT_MODEL } from '../src/config.js';
import { basetenClient } from '../src/meta/client.js';
import { READING_SCHEMA } from '../src/providers/schema.js';

// Offline: a fake fetch plays Baseten Model APIs. This checks the request shape against
// docs.baseten.co (OpenAI-compatible Chat Completions), not the live service.
const KEY = 'bt_test_fake_key';
const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, text) => ({ ok: false, status, headers: { get: () => null }, json: async () => ({}), text: async () => text });

test('config: baseten provider, key, default model, auto-selection and validation', () => {
  const c = loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY });
  assert.equal(c.provider, 'baseten');
  assert.equal(c.baseten.baseUrl, 'https://inference.baseten.co/v1');
  assert.equal(c.baseten.model, BASETEN_DEFAULT_MODEL);
  assert.equal(BASETEN_DEFAULT_MODEL, 'meta-models/muse-spark-open-1026');
  assert.equal(c.baseten.timeoutMs, 120000);
  assert.equal(loadConfig({ BASETEN_API_KEY: KEY }).provider, 'baseten');
  assert.equal(loadConfig({ BASETEN_API_KEY: KEY, MODEL_API_KEY: 'LLM_x' }).provider, 'meta');
  assert.equal(loadConfig({ BASETEN_API_KEY: KEY, BASETEN_MODEL: 'meta-models/muse-spark-open' }).baseten.model, 'meta-models/muse-spark-open');
  assert.throws(() => loadConfig({ MODEL_PROVIDER: 'baseten' }), /needs BASETEN_API_KEY/);
  assert.throws(() => loadConfig({ BASETEN_API_KEY: KEY, BASETEN_REASONING_EFFORT: 'max' }), ConfigError);
  assert.equal(loadConfig({ BASETEN_API_KEY: KEY, BASETEN_REASONING_EFFORT: 'LOW' }).baseten.reasoningEffort, 'low');
  const label = providerLabel(c);
  assert.match(label, /^baseten \(live: meta-models\/muse-spark-open-1026; boxes: recorded sample boxes \(SAM unavailable\)\)$/);
  assert.match(providerLabel(loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY, MODEL_API_KEY: 'LLM_x' })), /sam-3\.1 on Meta API/);
  assert.ok(!label.includes(KEY));
});

test('baseten client: vision read puts the schema in the prompt (no response_format) and parses the reply', async () => {
  const cfg = loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY, BASETEN_REASONING_EFFORT: 'low' });
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return ok({ choices: [{ message: { role: 'assistant', content: 'Here you go:\n```json\n{"packs":[{"region":0,"name":"X","strength":"","pack_size":null,"lot":"A1","expiry":"01/2027","confidence":0.9}]}\n```' } }] }); };
  const out = await basetenClient(cfg, fetch).readJson('samples/shelf-01.png', 'Read the packs.', READING_SCHEMA);
  assert.equal(out.packs[0].lot, 'A1');
  const { url, init, body } = sent[0];
  assert.equal(url, 'https://inference.baseten.co/v1/chat/completions');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(body.model, 'meta-models/muse-spark-open-1026');
  assert.equal(body.response_format, undefined);
  assert.equal(body.reasoning_effort, 'low');
  const [text, image] = body.messages[0].content;
  assert.match(text.text, /JSON Schema/);
  assert.ok(text.text.includes('"pack_size"'));
  assert.equal(image.type, 'image_url');
  assert.match(image.image_url.url, /^data:image\/png;base64,/);
});

test('baseten client: tool calling request shape; errors are labelled Baseten and redact the key; no SAM', async () => {
  const cfg = { ...loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY }), sleep: async () => {} };
  const sent = [];
  let fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return ok({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'expiry_flags', arguments: '{}' } }] } }] }); };
  const msg = await basetenClient(cfg, fetch).chatWithTools([{ role: 'user', content: 'hi' }], [{ type: 'function', function: { name: 'expiry_flags', description: 'd', parameters: { type: 'object', properties: {} } } }]);
  assert.equal(msg.tool_calls[0].function.name, 'expiry_flags');
  assert.equal(sent[0].tool_choice, 'auto');
  assert.equal(sent[0].parallel_tool_calls, undefined);
  assert.equal(sent[0].reasoning_effort, undefined);
  fetch = async () => fail(401, `bad key ${KEY}`);
  await assert.rejects(basetenClient(cfg, fetch).chatWithTools([], []), (e) => /^Baseten API \/chat\/completions failed: HTTP 401 \(check BASETEN_API_KEY/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(basetenClient(cfg, fetch).segment('x.png'), /only on the Meta Model API/);
  assert.throws(() => basetenClient({ baseten: {} }), /BASETEN_API_KEY is not set/);
});

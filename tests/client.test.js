import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaClient } from '../src/meta/client.js';

const KEY = 'LLM_42_supersecret';
const cfg = (extra = {}) => ({ apiKey: KEY, baseUrl: 'https://api.example.test/v1', sleep: async () => {}, ...extra });
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('client: retries 429 and 5xx, then succeeds', async () => {
  const seq = [reply(429, 'slow down', { 'retry-after': '1' }), reply(503, 'busy'), reply(200, { ok: true })];
  let calls = 0;
  const c = new MetaClient(cfg(), async () => seq[calls++]);
  assert.deepEqual(await c.post('/chat/completions', {}), { ok: true });
  assert.equal(calls, 3);
});

test('client: does not retry 401, adds a hint, and never leaks the key', async () => {
  let calls = 0;
  const c = new MetaClient(cfg(), async () => { calls++; return reply(401, `bad key ${KEY}`); });
  await assert.rejects(c.post('/responses', {}), (e) => {
    assert.match(e.message, /HTTP 401 \(check MODEL_API_KEY/);
    assert.ok(!e.message.includes('supersecret'), 'key must be redacted');
    return true;
  });
  assert.equal(calls, 1);
});

test('client: timeouts and network errors give a clear message after retries', async () => {
  let calls = 0;
  const timeout = new MetaClient(cfg({ retries: 1, timeoutMs: 5 }), async () => {
    calls++; const e = new Error('aborted'); e.name = 'TimeoutError'; throw e;
  });
  await assert.rejects(timeout.post('/responses', {}), /timed out after 5 ms/);
  assert.equal(calls, 2);
  const offline = new MetaClient(cfg({ retries: 0 }), async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  await assert.rejects(offline.post('/responses', {}), /network error: getaddrinfo ENOTFOUND/);
});

test('client: refuses to start without a key', () => {
  assert.throws(() => new MetaClient({ apiKey: '' }), /MODEL_API_KEY is not set/);
});

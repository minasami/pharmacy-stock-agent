import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { getProvider } from '../src/providers/index.js';
import { basetenProvider, SamUnavailableError, FIXTURE_DETECTOR } from '../src/providers/baseten.js';
import { normaliseReadings } from '../src/providers/schema.js';
import { scanPhoto } from '../src/agent/scan.js';
import { Store } from '../src/inventory/store.js';
import { startServer } from '../src/web/server.js';

// Offline: fake fetch plays Baseten (and the Meta API for SAM). No network is used.
const KEY = 'bt_test_fake_key';
const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const truth = JSON.parse(readFileSync('samples/shelf-01.truth.json', 'utf8'));
const reply = () => ok({ choices: [{ message: { role: 'assistant', reasoning_content: 'thinking', content: JSON.stringify({ packs: truth.regions.map((r, i) => ({ region: i, ...r.reading })) }) } }] });

test('baseten provider: without MODEL_API_KEY, bundled samples use recorded boxes (labelled) and Muse Spark Open reads them', async () => {
  const cfg = loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY });
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return reply(); };
  const provider = getProvider(cfg, fetch);
  assert.equal(provider.name, 'baseten');
  assert.equal(provider.detector, FIXTURE_DETECTOR);
  assert.equal(provider.canReadNewPhotos, false);
  const store = new Store(mkdtempSync(join(tmpdir(), 'bt-prov-')));
  await store.reset();
  const scan = await scanPhoto('samples/shelf-01.png', { provider, catalog: await store.catalog(), asOf: '2026-10-27' });
  assert.equal(sent.length, 1, 'only the read goes out; no SAM call');
  assert.equal(sent[0].url, 'https://inference.baseten.co/v1/chat/completions');
  assert.equal(scan.detector, FIXTURE_DETECTOR);
  assert.equal(scan.packs.length, truth.regions.length);
  assert.ok(scan.packs.every((p) => p.box.source === 'fixture'));
  assert.equal(scan.packs[0].reading.lot, truth.regions[0].reading.lot);
  await assert.rejects(provider.detectPacks('/tmp/not-a-sample.png'), (e) => e instanceof SamUnavailableError && /only on the Meta Model API/.test(e.message));
});

test('baseten provider: with MODEL_API_KEY too, SAM 3.1 runs on the Meta API and the read on Baseten', async () => {
  const cfg = loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY, MODEL_API_KEY: 'LLM_fake' });
  const urls = [];
  const fetch = async (url) => { urls.push(url); return url.endsWith('/responses') ? ok({ output_text: JSON.stringify({ masks: [{ box: [10, 10, 50, 90], score: 0.9 }] }) }) : reply(); };
  const provider = basetenProvider(cfg, fetch);
  assert.equal(provider.canReadNewPhotos, true);
  assert.match(provider.detector, /sam-3\.1 \(Meta Model API\)/);
  await provider.detectPacks('samples/shelf-01.png').catch(() => {});
  assert.equal(urls[0], 'https://api.meta.ai/v1/responses');
  await provider.readPacks('samples/shelf-01.png', [{ x1: 0, y1: 0, x2: 1, y2: 1 }]);
  assert.equal(urls.at(-1), 'https://inference.baseten.co/v1/chat/completions');
});

test('normaliseReadings: malformed model output becomes unreadable placeholders, never invented data', () => {
  const boxes = [{}, {}, {}];
  const out = normaliseReadings({ packs: [{ region: '0', name: 7, lot: 'A1', pack_size: '20', confidence: 4 }, { region: 2, pack_size: -1, confidence: 'x' }] }, boxes);
  assert.deepEqual(out[0], { region: 0, name: '', strength: '', pack_size: 20, lot: 'A1', expiry: '', confidence: 1 });
  assert.equal(out[1].confidence, 0);
  assert.equal(out[2].pack_size, null);
  assert.equal(out[2].confidence, 0);
  assert.equal(normaliseReadings('nope', boxes).length, 3);
});

test('web: baseten without SAM labels fixture boxes, refuses new photos with 422', async () => {
  const cfg = loadConfig({ MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: KEY });
  const store = new Store(mkdtempSync(join(tmpdir(), 'bt-web-')));
  await store.reset();
  const server = await startServer({ store, cfg, provider: basetenProvider(cfg, async () => reply()), asOf: '2026-10-27' });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const st = await (await fetch(`${base}/api/status`)).json();
    assert.equal(st.provider, 'baseten');
    assert.equal(st.detector, FIXTURE_DETECTOR);
    const scan = await (await fetch(`${base}/api/scan`, { method: 'POST', body: JSON.stringify({ mode: 'shelf', sample: 'shelf-01.png' }) })).json();
    assert.equal(scan.detector, FIXTURE_DETECTOR);
    // A tiny valid PNG that is not a sample.
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const res = await fetch(`${base}/api/scan`, { method: 'POST', body: JSON.stringify({ mode: 'shelf', image: `data:image/png;base64,${png.toString('base64')}` }) });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /SAM 3\.1 is only on the Meta Model API/);
    assert.ok(!JSON.stringify(st).includes(KEY));
  } finally { server.close(); }
});

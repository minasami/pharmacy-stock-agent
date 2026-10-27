import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/web/server.js';
import { Store } from '../src/inventory/store.js';

const failing = { name: 'meta', detectPacks: async () => { throw new Error('Meta API /responses failed: HTTP 503'); }, readPacks: async () => [] };

test('web: a failing model call returns 502 with the reason and changes nothing', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'stock-err-')));
  await store.reset();
  const server = await startServer({ store, provider: failing, asOf: '2026-10-27', cfg: { nearExpiryDays: 90 } });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/scan`, { method: 'POST', body: JSON.stringify({ mode: 'shelf', sample: 'shelf-01.png' }) });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /vision model call failed, nothing was changed.*HTTP 503/);
    assert.deepEqual(await (await fetch(`${base}/api/changesets`)).json(), []);
    assert.deepEqual(await (await fetch(`${base}/api/review`)).json(), []);
  } finally { server.close(); }
});

test('web: startServer rejects cleanly when the port is taken', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'stock-port-')));
  const a = await startServer({ store, cfg: { nearExpiryDays: 90, provider: 'mock' } });
  try {
    await assert.rejects(startServer({ store, port: a.address().port, cfg: { nearExpiryDays: 90, provider: 'mock' } }), { code: 'EADDRINUSE' });
  } finally { a.close(); }
});

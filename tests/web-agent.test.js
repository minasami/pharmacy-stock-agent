import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/web/server.js';
import { Store } from '../src/inventory/store.js';
import { mockProvider } from '../src/providers/mock.js';

let server, base;
const store = new Store(mkdtempSync(join(tmpdir(), 'stock-web-agent-')));
before(async () => {
  server = await startServer({ store, provider: mockProvider, asOf: '2026-10-27', cfg: { nearExpiryDays: 90 } });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
async function call(path, body) {
  const res = await fetch(base + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test('web agent: runs a chosen-step trace on samples and uploads; changes wait on the Approvals page', async () => {
  await call('/api/reset', {});
  assert.equal((await call('/api/status')).body.planner, 'mock');
  const upload = `data:image/png;base64,${readFileSync('samples/delivery-01.png').toString('base64')}`;
  const r = await call('/api/agent', { goal: 'Morning check: audit the shelf, receive the delivery and draft the reorder', samples: ['shelf-01.png'], images: [upload], maxSteps: 6 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.steps.map((s) => s.tool), ['shelf_audit', 'delivery_intake', 'restock_draft']);
  assert.equal(r.body.photos[1].url, '/samples/delivery-01.png', 'upload identical to a sample maps back to it');
  assert.equal(r.body.pendingApproval, true);
  const cs = (await call('/api/changesets')).body;
  assert.deepEqual(cs.map((c) => c.status), ['awaiting_pharmacist_approval', 'awaiting_pharmacist_approval']);
  assert.equal((await call('/api/review')).body.length, 1, 'unclear pack queued for the pharmacist');
  const lot = (await call('/api/inventory')).body.lots.find((l) => l.lot === 'DG2308F');
  assert.equal(lot.qty, 2, 'nothing applied by the agent');
});

test('web agent: refuses clinical goals and rejects bad input', async () => {
  const r = await call('/api/agent', { goal: 'Is SYN-001 safe for a pregnant customer?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.refused, true);
  assert.deepEqual(r.body.steps, []);
  assert.equal((await call('/api/agent', { goal: '' })).status, 400);
  assert.equal((await call('/api/agent', { goal: 'x', samples: ['../../etc/passwd'] })).status, 404);
  assert.equal((await call('/api/agent', { goal: 'x', maxSteps: 50 })).status, 400);
  assert.equal((await call('/api/agent', { goal: 'x', samples: ['a', 'b', 'c', 'd', 'e'] })).status, 400);
  const fresh = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64')}`;
  assert.equal((await call('/api/agent', { goal: 'Audit this shelf', images: [fresh] })).status, 422, 'replay mode cannot read new photos');
});

test('web agent: the UI has an Agent view with labelled controls and honest offline wording', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const js = readFileSync('web/app.js', 'utf8');
  assert.match(html, /<a href="#agent">Agent run<\/a>/);
  assert.match(js, /agent: viewAgent/);
  assert.match(js, /h\('textarea', \{[^}]*'aria-label'/);
  assert.match(js, /mock planner simulates/);
  assert.match(js, /It is not a model/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
});

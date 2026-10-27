import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSamBoxes, responseText } from '../src/meta/sam.js';
import { parseExpiry, expiryStatus } from '../src/inventory/expiry.js';
import { matchReading } from '../src/inventory/match.js';
import { checkRequest, assertNonClinical } from '../src/safety/guard.js';
import { parseJsonLoose } from '../src/meta/client.js';
import catalog from '../data/catalog.json' with { type: 'json' };

test('SAM token text parses into boxes and drops duplicates', () => {
  const t = '<0f>0<|box;x1=10;y1=20;x2=110;y2=140;w=1000;h=640|><|mask;abc|><0f>1<|box;x1=11;y1=21;x2=111;y2=141|><0f>2<|box;x1=300;y1=20;x2=420;y2=140|>';
  const b = parseSamBoxes(t);
  assert.equal(b.length, 2);
  assert.deepEqual([b[0].x1, b[0].imgW], [10, 1000]);
  assert.deepEqual(parseSamBoxes('<|box;x1=5;y1=5;x2=1;y2=9|>'), []);
});

test('responses envelope text is extracted from both shapes', () => {
  assert.equal(responseText({ output_text: 'a' }), 'a');
  assert.equal(responseText({ output: [{ content: [{ text: 'b' }, { text: 'c' }] }] }), 'bc');
});

test('expiry MM/YYYY means end of month', () => {
  assert.equal(parseExpiry('02/2028'), '2028-02-29');
  assert.equal(parseExpiry('2027-09'), '2027-09-30');
  assert.equal(parseExpiry('06/27'), '2027-06-30');
  assert.equal(parseExpiry('0?/2027'), null);
  assert.equal(expiryStatus('2026-09-30', '2026-10-27'), 'expired');
  assert.equal(expiryStatus('2026-12-31', '2026-10-27'), 'near_expiry');
  assert.equal(expiryStatus('2027-12-31', '2026-10-27'), 'ok');
  assert.equal(expiryStatus(null, '2026-10-27'), 'unknown');
});

test('matcher accepts clean reads and sends doubtful ones to a human', () => {
  const ok = matchReading({ name: 'Paracetamol', strength: '500 mg', pack_size: 20, lot: 'X1', expiry: '09/2027', confidence: 0.95 }, catalog);
  assert.equal(ok.sku, 'SYN-001');
  const bad = matchReading({ name: 'Omeprazo?', strength: '20 mg', pack_size: 14, lot: 'DG24??G', expiry: '06/2027', confidence: 0.4 }, catalog);
  assert.equal(bad.sku, null);
  assert.ok(bad.needsReview);
  const wrongStrength = matchReading({ name: 'Ibuprofen', strength: '200 mg', pack_size: 24, lot: 'X', expiry: '01/2028', confidence: 0.9 }, catalog);
  assert.equal(wrongStrength.sku, null, 'never silently maps to a different strength');
});

test('guard refuses clinical and substitution questions, allows stock ones', () => {
  for (const q of ['What can I substitute for amoxicillin?', 'what dose of ibuprofen', 'any interactions with metformin?', 'ما هو البديل']) {
    assert.equal(checkRequest(q).allowed, false, q);
  }
  assert.equal(checkRequest('How many Paracetamol packs do we have?').allowed, true);
  assert.throws(() => assertNonClinical('Use Ibuprofen as an alternative'));
});

test('loose JSON parsing handles fenced output', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"packs":[]}\n```'), { packs: [] });
});

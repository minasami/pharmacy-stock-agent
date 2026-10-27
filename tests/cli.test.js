import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = mkdtempSync(join(tmpdir(), 'stock-cli-'));
const run = (...args) => spawnSync(process.execPath, ['src/cli.js', ...args], {
  encoding: 'utf8', env: { ...process.env, STOCK_STATE_DIR: state, MODEL_PROVIDER: 'mock', MODEL_API_KEY: '' },
});

test('cli: bad input gets a clear message, usage and exit code 2 instead of a stack trace', () => {
  for (const [args, msg] of [
    [['shelf'], /shelf needs a photo path/],
    [['delivery', 'missing.png'], /Photo not found: missing\.png/],
    [['shelf', 'package.json'], /must be PNG, JPEG or WebP/],
    [['approve', 'oops', '--by', 'Demo Pharmacist'], /change set id like CS-001/],
    [['ask'], /ask needs a question/],
    [['expiry', '--as-of', '2026-13-45'], /--as-of must be a date/],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, msg);
    assert.match(r.stderr, /Usage: stock-agent/);
    assert.doesNotMatch(r.stderr, /at .*\.js:\d+/, 'no stack trace');
  }
});

test('cli: valid commands still work on the replay provider', () => {
  assert.equal(run('reset').status, 0);
  const r = run('shelf', 'samples/shelf-01.png', '--as-of', '2026-10-27');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Shelf audit \(mock, as of 2026-10-27\): 9 packs detected/);
  assert.equal(run('frobnicate').status, 1);
});

test('cli: replay provider explains that it only knows the bundled samples', () => {
  const copy = join(state, 'my-shelf.png');
  spawnSync('cp', ['samples/shelf-01.png', copy]);
  const r = run('shelf', copy);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /offline replay provider has no recorded result/);
  assert.match(r.stderr, /MODEL_PROVIDER=meta/);
});

test('cli: agent command chooses steps, proposes only, and validates its arguments', () => {
  run('reset');
  const r = run('agent', 'Morning check: audit the shelf and draft the reorder', '--photo', 'samples/shelf-01.png', '--as-of', '2026-10-27');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1\. shelf_audit \{"photo":"photo-1"\} -> proposed CS-\d+ \(awaiting pharmacist approval\)/);
  assert.match(r.stdout, /2\. restock_draft -> \d+ draft line\(s\), nothing sent/);
  assert.match(r.stdout, /Stopped: final_answer/);
  assert.match(r.stdout, /Waiting for approval: CS-\d+/);
  const j = JSON.parse(run('agent', 'Which lots are expiring?', '--json', '--as-of', '2026-10-27').stdout);
  assert.deepEqual(j.steps.map((s) => s.tool), ['expiry_flags']);
  assert.match(run('agent', 'What dose for a child?').stdout, /can.t give clinical/);
  for (const [args, msg] of [[['agent'], /agent needs a goal/], [['agent', 'x', '--max-steps', '99'], /--max-steps must be/], [['agent', 'x', '--photo', 'nope.png'], /Photo not found/]]) {
    const e = run(...args);
    assert.equal(e.status, 2);
    assert.match(e.stderr, msg);
  }
});

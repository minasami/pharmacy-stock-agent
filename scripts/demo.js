// End-to-end offline demo on synthetic data, pinned to the event start date.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, STOCK_STATE_DIR: mkdtempSync(join(tmpdir(), 'stock-demo-')), MODEL_PROVIDER: process.env.MODEL_PROVIDER || 'mock' };
const run = (...a) => { console.log(`\n$ stock-agent ${a.join(' ')}`); console.log(execFileSync('node', ['src/cli.js', ...a, '--as-of', '2026-10-27'], { env, encoding: 'utf8' }).trimEnd()); };
run('reset');
run('shelf', 'samples/shelf-01.png');
run('delivery', 'samples/delivery-01.png');
run('pending');
run('approve', 'CS-001', '--by', 'Demo Pharmacist');
run('approve', 'CS-002', '--by', 'Demo Pharmacist');
run('expiry');
run('restock');
run('ask', 'What can I give instead of Amoxicillin?');

// Same work, but the agent chooses the steps (tool calling; offline: the mock planner).
run('reset');
run('agent', 'Morning check: audit the shelf, receive the delivery and draft the reorder', '--photo', 'samples/shelf-01.png', '--photo', 'samples/delivery-01.png');
run('pending');
run('agent', 'What can I give instead of Amoxicillin?');

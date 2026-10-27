#!/usr/bin/env node
// stock-agent CLI. Runs on the mock provider unless MODEL_API_KEY is set.
import { loadConfig } from './config.js';
import { getProvider } from './providers/index.js';
import { Store } from './inventory/store.js';
import { today } from './inventory/expiry.js';
import { shelfAudit, deliveryIntake, expiryReport, draftRestock } from './agent/workflows.js';
import { formatRestock, formatExpiry } from './agent/format.js';
import { answerStockQuestion } from './agent/ask.js';

const USAGE = `Usage: stock-agent <command> [args] [--as-of YYYY-MM-DD] [--json]
  reset                         reset stock to the synthetic seed
  shelf <photo>                 audit a shelf photo (expiry, unknown lots, review)
  delivery <photo>              count a delivery photo and propose receiving it
  expiry                        list expired and near-expiry lots
  restock                       draft a restock order (draft only)
  pending                       list change sets waiting for approval
  approve <CS-id> --by <name>   pharmacist approves a change set
  reject <CS-id> --by <name>    pharmacist rejects a change set
  ask "<question>"              stock-only questions; clinical questions are refused`;

function opt(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

async function main(argv) {
  const [cmd, ...args] = argv;
  const cfg = loadConfig();
  const asOf = opt(args, '--as-of') ?? today();
  const json = args.includes('--json');
  const store = new Store(process.env.STOCK_STATE_DIR || undefined);
  const catalog = await store.catalog();
  const ctx = { provider: getProvider(cfg), catalog, store, asOf, nearDays: cfg.nearExpiryDays };
  const print = (obj, text) => console.log(json ? JSON.stringify(obj, null, 2) : text);

  switch (cmd) {
    case 'reset': await store.reset(); return console.log('Stock reset to synthetic seed.');
    case 'shelf': {
      const r = await shelfAudit(args[0], ctx);
      return print(r, [
        `Shelf audit (${r.scan.provider}, as of ${asOf}): ${r.scan.packs.length} packs detected`,
        `Pull now (expired): ${r.pull.map((l) => `${l.sku} lot ${l.lot}`).join(', ') || 'none'}`,
        `Near expiry: ${r.nearExpiry.map((l) => `${l.sku} lot ${l.lot} (${l.expiry})`).join(', ') || 'none'}`,
        `Lots not in system: ${r.unknownLots.map((l) => `${l.sku} lot ${l.lot}`).join(', ') || 'none'}`,
        `Needs a human to read: ${r.review.map((p) => `region ${p.region} (${p.reviewReasons.join('; ')})`).join(', ') || 'none'}`,
        r.changeSet ? `Proposed ${r.changeSet.id}: quarantine ${r.changeSet.changes.length} lot(s). Awaiting pharmacist approval.` : 'No stock changes proposed.',
      ].join('\n'));
    }
    case 'delivery': {
      const r = await deliveryIntake(args[0], ctx);
      return print(r, [
        `Delivery intake (${r.scan.provider}, as of ${asOf}): ${r.scan.packs.length} packs detected`,
        `To receive: ${r.received.map((l) => `${l.sku} lot ${l.lot} x${l.count}`).join(', ') || 'none'}`,
        `Flagged, not received (expired/near expiry): ${r.flagged.map((l) => `${l.sku} lot ${l.lot} exp ${l.expiry}`).join(', ') || 'none'}`,
        `Needs a human to read: ${r.review.length}`,
        r.changeSet ? `Proposed ${r.changeSet.id}. Awaiting pharmacist approval.` : 'No stock changes proposed.',
      ].join('\n'));
    }
    case 'expiry': { const r = expiryReport(await store.inventory(), catalog, asOf, cfg.nearExpiryDays); return print(r, formatExpiry(r)); }
    case 'restock': { const d = draftRestock(await store.inventory(), catalog, asOf, cfg.nearExpiryDays); return print(d, formatRestock(d)); }
    case 'pending': {
      const p = (await store.pending()).filter((c) => c.status === 'awaiting_pharmacist_approval');
      return print(p, p.map((c) => `${c.id} ${c.kind}: ${c.changes.length} change(s) from ${c.source}`).join('\n') || 'Nothing pending.');
    }
    case 'approve': { const c = await store.approve(args[0], opt(args, '--by')); return console.log(`${c.id} approved by ${c.approvedBy}; stock updated.`); }
    case 'reject': { const c = await store.reject(args[0], opt(args, '--by'), opt(args, '--reason')); return console.log(`${c.id} rejected.`); }
    case 'ask': return console.log(answerStockQuestion(args[0], await store.inventory(), catalog).answer);
    default: console.log(USAGE); if (cmd) process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((e) => { console.error(`Error: ${e.message}`); process.exitCode = 1; });

#!/usr/bin/env node
// stock-agent CLI. Runs on the mock provider unless MODEL_API_KEY is set.
import { existsSync, statSync } from 'node:fs';
import { loadConfig, ConfigError } from './config.js';
import { getProvider } from './providers/index.js';
import { Store } from './inventory/store.js';
import { today } from './inventory/expiry.js';
import { shelfAudit, deliveryIntake, expiryReport, draftRestock } from './agent/workflows.js';
import { formatRestock, formatExpiry } from './agent/format.js';
import { answerStockQuestion } from './agent/ask.js';
import { runAgent, MAX_STEPS_LIMIT } from './agent/loop.js';
import { getPlanner } from './agent/planners.js';
import { basename } from 'node:path';

const USAGE = `Usage: stock-agent <command> [args] [--as-of YYYY-MM-DD] [--json]
  reset                         reset stock to the synthetic seed
  shelf <photo>                 audit a shelf photo (expiry, unknown lots, review)
  delivery <photo>              count a delivery photo and propose receiving it
  expiry                        list expired and near-expiry lots
  restock                       draft a restock order (draft only)
  pending                       list change sets waiting for approval
  approve <CS-id> --by <name>   pharmacist approves a change set
  reject <CS-id> --by <name>    pharmacist rejects a change set
  ask "<question>"              stock-only questions; clinical questions are refused
  agent "<goal>" [--photo <p>]... [--max-steps N]
                                the agent chooses its own steps (tool calling) and
                                only proposes changes; approve them afterwards`;

function opt(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

class UsageError extends Error {}

// --as-of must be a real calendar date, so expiry maths never runs on garbage.
function validDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.toISOString().slice(0, 10) !== v) throw new UsageError(`--as-of must be a date like 2026-10-27 (got "${v}").`);
  return v;
}

function photoArg(p, cmd) {
  if (!p || p.startsWith('--')) throw new UsageError(`${cmd} needs a photo path, e.g. stock-agent ${cmd} samples/${cmd === 'shelf' ? 'shelf' : 'delivery'}-01.png`);
  if (!existsSync(p) || !statSync(p).isFile()) throw new UsageError(`Photo not found: ${p}`);
  if (!/\.(png|jpe?g|webp)$/i.test(p)) throw new UsageError(`Photo must be PNG, JPEG or WebP: ${p}`);
  return p;
}

function agentArgs(args) {
  const goal = args[0];
  if (!goal || goal.startsWith('--')) throw new UsageError('agent needs a goal in quotes, e.g. stock-agent agent "Check this shelf and draft the reorder" --photo samples/shelf-01.png');
  const photos = [];
  args.forEach((a, i) => { if (a === '--photo') photos.push(photoArg(args[i + 1], 'agent --photo')); });
  if (photos.length > 4) throw new UsageError('agent takes at most 4 photos.');
  let maxSteps;
  if (args.includes('--max-steps')) {
    maxSteps = Number(opt(args, '--max-steps'));
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS_LIMIT) throw new UsageError(`--max-steps must be a whole number from 1 to ${MAX_STEPS_LIMIT}.`);
  }
  return { goal, photos: photos.map((path, i) => ({ id: `photo-${i + 1}`, path, label: basename(path) })), maxSteps };
}

function formatAgent(r) {
  if (r.refused) return r.answer;
  const lines = [`Agent run ${r.id} (planner: ${r.planner}, provider: ${r.provider}, as of ${r.asOf}, max ${r.maxSteps} steps)`];
  for (const s of r.steps) {
    const args = Object.keys(s.args ?? {}).length ? ` ${JSON.stringify(s.args)}` : '';
    const out = !s.ok ? `error: ${s.error}`
      : s.result.proposed_change_set ? `proposed ${s.result.proposed_change_set.id} (awaiting pharmacist approval)${s.result.sent_to_review_queue.length ? `; review queue: ${s.result.sent_to_review_queue.join(', ')}` : ''}`
      : s.tool === 'expiry_flags' ? `${s.result.expired.length} expired, ${s.result.near_expiry.length} near expiry`
      : s.tool === 'restock_draft' ? `${s.result.lines.length} draft line(s), nothing sent`
      : s.tool === 'request_human_review' ? `handed to pharmacist: ${s.result.note}`
      : 'done';
    lines.push(`  ${s.n}. ${s.tool}${args} -> ${out}`);
  }
  lines.push(`Stopped: ${r.stoppedReason}`);
  if (r.answer) lines.push(`Agent: ${r.answer}`);
  lines.push(r.pendingApproval ? `Waiting for approval: ${r.changeSets.map((c) => c.id).join(', ')}. Approve with: stock-agent approve <CS-id> --by "<name>"` : 'No stock changes proposed.');
  return lines.join('\n');
}

function changeSetArg(id, cmd) {
  if (!/^CS-\d{3,}$/.test(id ?? '')) throw new UsageError(`${cmd} needs a change set id like CS-001 (see "stock-agent pending").`);
  return id;
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const cfg = loadConfig();
  const asOf = args.includes('--as-of') ? validDate(opt(args, '--as-of')) : today();
  const json = args.includes('--json');
  const store = new Store(process.env.STOCK_STATE_DIR || undefined);
  const catalog = await store.catalog();
  const ctx = { provider: getProvider(cfg), catalog, store, asOf, nearDays: cfg.nearExpiryDays };
  const print = (obj, text) => console.log(json ? JSON.stringify(obj, null, 2) : text);

  switch (cmd) {
    case 'reset': await store.reset(); return console.log('Stock reset to synthetic seed.');
    case 'shelf': {
      const r = await shelfAudit(photoArg(args[0], 'shelf'), ctx);
      return print(r, [
        `Shelf audit (${r.scan.provider}, as of ${asOf}): ${r.scan.packs.length} packs detected` + (r.scan.provider === 'baseten' ? `\nPack boxes: ${r.scan.detector}` : ''),
        `Pull now (expired): ${r.pull.map((l) => `${l.sku} lot ${l.lot}`).join(', ') || 'none'}`,
        `Near expiry: ${r.nearExpiry.map((l) => `${l.sku} lot ${l.lot} (${l.expiry})`).join(', ') || 'none'}`,
        `Lots not in system: ${r.unknownLots.map((l) => `${l.sku} lot ${l.lot}`).join(', ') || 'none'}`,
        `Needs a human to read: ${r.review.map((p) => `region ${p.region} (${p.reviewReasons.join('; ')})`).join(', ') || 'none'}`,
        r.changeSet ? `Proposed ${r.changeSet.id}: quarantine ${r.changeSet.changes.length} lot(s). Awaiting pharmacist approval.` : 'No stock changes proposed.',
      ].join('\n'));
    }
    case 'delivery': {
      const r = await deliveryIntake(photoArg(args[0], 'delivery'), ctx);
      return print(r, [
        `Delivery intake (${r.scan.provider}, as of ${asOf}): ${r.scan.packs.length} packs detected` + (r.scan.provider === 'baseten' ? `\nPack boxes: ${r.scan.detector}` : ''),
        `To receive: ${r.received.map((l) => `${l.sku} lot ${l.lot} x${l.count}`).join(', ') || 'none'}`,
        `Flagged, not received (expired/near expiry): ${r.flagged.map((l) => `${l.sku} lot ${l.lot} exp ${l.expiry}`).join(', ') || 'none'}`,
        `Needs a human to read: ${r.review.length}`,
        r.changeSet ? `Proposed ${r.changeSet.id}. Awaiting pharmacist approval.` : 'No stock changes proposed.',
      ].join('\n'));
    }
    case 'expiry': { const r = expiryReport(await store.inventory(), catalog, asOf, cfg.nearExpiryDays); return print(r, formatExpiry(r)); }
    case 'restock': { const d = draftRestock(await store.inventory(), catalog, asOf, cfg.nearExpiryDays); return print(d, formatRestock(d)); }
    case 'agent': {
      const a = agentArgs(args);
      const r = await runAgent({ ...a, ctx, planner: getPlanner(cfg) });
      return print(r, formatAgent(r));
    }
    case 'pending': {
      const p = (await store.pending()).filter((c) => c.status === 'awaiting_pharmacist_approval');
      return print(p, p.map((c) => `${c.id} ${c.kind}: ${c.changes.length} change(s) from ${c.source}`).join('\n') || 'Nothing pending.');
    }
    case 'approve': { const c = await store.approve(changeSetArg(args[0], 'approve'), opt(args, '--by')); return console.log(`${c.id} approved by ${c.approvedBy}; stock updated.`); }
    case 'reject': { const c = await store.reject(changeSetArg(args[0], 'reject'), opt(args, '--by'), opt(args, '--reason')); return console.log(`${c.id} rejected.`); }
    case 'ask':
      if (!args[0] || args[0].startsWith('--')) throw new UsageError('ask needs a question in quotes, e.g. stock-agent ask "how many Paracetamol packs do we have?"');
      return console.log(answerStockQuestion(args[0], await store.inventory(), catalog).answer);
    default: console.log(USAGE); if (cmd) process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((e) => {
  if (e instanceof UsageError) { console.error(`${e.message}\n\n${USAGE}`); process.exitCode = 2; return; }
  console.error(e instanceof ConfigError ? `Config error: ${e.message}` : `Error: ${e.message}`);
  process.exitCode = e instanceof ConfigError ? 2 : 1;
});

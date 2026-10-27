// The tools the agent may choose from. Each tool wraps an existing workflow and
// returns a compact, model-readable result. No tool changes stock: shelf_audit and
// delivery_intake can only PROPOSE change sets, which wait for a named pharmacist.
// There is deliberately no approve tool.
import { shelfAudit, deliveryIntake, expiryReport, draftRestock, queueReviews } from './workflows.js';
import { checkRequest } from '../safety/guard.js';

export class ToolError extends Error {}

const photoParam = (photos) => ({
  type: 'string',
  enum: photos.map((p) => p.id),
  description: 'Id of one of the photos the pharmacist attached to this request.',
});

// Tool definitions in the Chat Completions format (function metadata nested under
// `function`), as in dev.meta.ai/docs/tool-calling. Photo ids are restricted to the
// photos attached to this run, so the model can never point a tool at another file.
export function toolDefinitions(photos) {
  const fn = (name, description, properties = {}, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
  });
  const defs = [
    fn('expiry_flags', 'List expired and near-expiry lots in current stock. Read-only.'),
    fn('restock_draft', 'Draft a restock order per supplier from par levels and reorder points. Expired stock does not count. Draft only; nothing is sent. Read-only.'),
    fn('request_human_review', 'Hand a concern to the pharmacist and end the run. Use when a photo or result is unclear, or when the request is outside stock work.', {
      note: { type: 'string', description: 'Short stock-only note for the pharmacist (max 300 characters). No clinical content.' },
      ...(photos.length ? { photo: { ...photoParam(photos), description: 'Optional photo the note is about.' } } : {}),
    }, ['note']),
  ];
  if (photos.length) {
    defs.unshift(
      fn('shelf_audit', 'Audit a SHELF photo: find packs, read lot and expiry, flag expired and near-expiry lots, queue unreadable packs for the pharmacist, and PROPOSE quarantining expired lots. Proposals wait for pharmacist approval. Use at most once per photo.', { photo: photoParam(photos) }, ['photo']),
      fn('delivery_intake', 'Check an opened DELIVERY carton photo: count packs per lot, flag expired or short-dated lots (not received), queue unreadable packs, and PROPOSE receiving the good lots. Proposals wait for pharmacist approval. Use at most once per photo.', { photo: photoParam(photos) }, ['photo']),
    );
  }
  return defs;
}

export const TOOL_NAMES = ['shelf_audit', 'delivery_intake', 'expiry_flags', 'restock_draft', 'request_human_review'];

// Validate model-generated arguments ourselves: the docs note they are guided by the
// schema but not guaranteed to match it.
function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (raw === undefined || raw === null || raw === '') return {};
  try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* fall through */ }
  throw new ToolError('Arguments must be a JSON object.');
}

const lotLine = (l) => ({ sku: l.sku, lot: l.lot, expiry: l.expiry, count: l.count });

// Run one tool call. `run` carries state for this agent run (photos, which photos
// were already processed, proposed change sets, review items, handoff note).
export async function executeTool(name, rawArgs, ctx, run) {
  if (!TOOL_NAMES.includes(name)) throw new ToolError(`Unknown tool "${name}". Available: ${TOOL_NAMES.join(', ')}.`);
  const args = parseArgs(rawArgs);
  const photoById = (id) => {
    const p = run.photos.find((x) => x.id === id);
    if (!p) throw new ToolError(`Unknown photo "${id}". Attached photos: ${run.photos.map((x) => x.id).join(', ') || 'none'}.`);
    return p;
  };

  switch (name) {
    case 'shelf_audit':
    case 'delivery_intake': {
      const photo = photoById(args.photo);
      if (run.processed.has(photo.id)) throw new ToolError(`${photo.id} was already processed in this run (${run.processed.get(photo.id)}); it is not scanned twice, so no duplicate change set is proposed.`);
      const mode = name === 'shelf_audit' ? 'shelf' : 'delivery';
      run.processed.set(photo.id, name);
      const r = name === 'shelf_audit' ? await shelfAudit(photo.path, ctx) : await deliveryIntake(photo.path, ctx);
      const reviews = await queueReviews(ctx.store, mode, photo.url ?? photo.path, r.review);
      run.reviews.push(...reviews.map((x) => x.id));
      if (r.changeSet) run.changeSets.push(r.changeSet.id);
      const common = {
        photo: photo.id, packs_detected: r.scan.packs.length,
        sent_to_review_queue: reviews.map((x) => x.id),
        proposed_change_set: r.changeSet ? { id: r.changeSet.id, kind: r.changeSet.kind, changes: r.changeSet.changes.length, status: 'awaiting_pharmacist_approval' } : null,
        note: 'Stock is unchanged until a named pharmacist approves the change set.',
      };
      return name === 'shelf_audit'
        ? { ...common, expired_to_pull: r.pull.map(lotLine), near_expiry: r.nearExpiry.map(lotLine), lots_not_in_system: r.unknownLots.map(lotLine) }
        : { ...common, to_receive: r.received.map(lotLine), flagged_not_received: r.flagged.map(lotLine) };
    }
    case 'expiry_flags': {
      const rep = expiryReport(await ctx.store.inventory(), ctx.catalog, ctx.asOf, ctx.nearDays);
      const row = (l) => ({ sku: l.sku, name: l.name, lot: l.lot, expiry: l.expiry, qty: l.qty, days: l.days });
      return { as_of: ctx.asOf, near_expiry_days: ctx.nearDays, expired: rep.expired.map(row), near_expiry: rep.nearExpiry.map(row) };
    }
    case 'restock_draft': {
      const d = draftRestock(await ctx.store.inventory(), ctx.catalog, ctx.asOf, ctx.nearDays);
      run.restockDraft = d;
      return { status: d.status, as_of: d.asOf, lines: d.lines.map((l) => ({ sku: l.sku, name: l.name, supplier: l.supplier, on_hand: l.onHand, order_qty: l.orderQty })), note: 'Draft only. Nothing is sent.' };
    }
    case 'request_human_review': {
      const note = String(args.note ?? '').trim().slice(0, 300);
      if (!note) throw new ToolError('note is required.');
      if (!checkRequest(note).allowed) throw new ToolError('The note contains clinical or substitution wording, which this agent must not write. Keep it to stock facts.');
      const photo = args.photo ? photoById(args.photo).id : null;
      run.handoff = { note, photo };
      await ctx.store.log({ at: new Date().toISOString(), id: run.id, kind: 'agent_handoff', approver: null, changes: 0, note, photo });
      return { handed_to_pharmacist: true, note, photo };
    }
  }
}

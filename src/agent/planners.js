// Planners decide the next agent step. Both return an assistant message in the
// Chat Completions shape: { role, content, tool_calls: [{ id, type, function: { name, arguments } }] }.
//
// mockPlanner: offline, deterministic simulation of tool choice so tests and the demo
// run without a key. It reads only what a model would see (the conversation so far).
// It is NOT a model; README and the UI say so.
//
// metaPlanner: live Muse Spark tool calling through the Meta Model API.
import { MetaClient } from '../meta/client.js';

export function metaPlanner(cfg, fetchImpl) {
  const client = new MetaClient(cfg, fetchImpl);
  return {
    name: `meta (${cfg.agentModel ?? cfg.visionModel})`,
    async next({ messages, tools }) {
      const msg = await client.chatWithTools(messages, tools);
      // Keep only the fields the conversation needs; arguments stay a JSON string and
      // are validated by the loop before anything runs.
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls
        .filter((c) => c?.function?.name)
        .map((c) => ({ id: String(c.id ?? ''), type: 'function', function: { name: String(c.function.name), arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) } })) : [];
      return { role: 'assistant', content: typeof msg.content === 'string' ? msg.content : null, ...(calls.length ? { tool_calls: calls } : {}) };
    },
  };
}

export function getPlanner(cfg, fetchImpl) {
  return cfg.provider === 'meta' ? metaPlanner(cfg, fetchImpl) : mockPlanner();
}

const DELIVERY_HINT = /deliver|carton|intake|receiv/i;
const SHELF_HINT = /shelf|audit/i;

function history(messages) {
  const results = new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, safeJson(m.content)]));
  const calls = [];
  for (const m of messages) {
    for (const c of m.tool_calls ?? []) calls.push({ name: c.function.name, args: safeJson(c.function.arguments), result: results.get(c.id) });
  }
  return calls;
}
const safeJson = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return {}; } };

function parseUser(messages) {
  const text = messages.find((m) => m.role === 'user')?.content ?? '';
  const goal = (text.match(/^Request: (.*)$/m) ?? [])[1] ?? '';
  const photos = [...text.matchAll(/^- (photo-\d+): (.*)$/gm)].map((m) => ({ id: m[1], label: m[2] }));
  return { goal, photos };
}

export function mockPlanner() {
  let n = 0;
  const call = (name, args = {}) => ({ role: 'assistant', content: null, tool_calls: [{ id: `call_mock_${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  return {
    name: 'mock',
    async next({ messages }) {
      const { goal, photos } = parseUser(messages);
      const done = history(messages);
      const wantsExpiry = /expir|out of date|short.?dated/i.test(goal);
      const wantsRestock = /restock|re-?order|order|low stock|running low/i.test(goal);
      const everything = !wantsExpiry && !wantsRestock;

      // 1. Each attached photo once, choosing the tool from the photo name or the request.
      for (const p of photos) {
        if (done.some((c) => c.args?.photo === p.id)) continue;
        const delivery = DELIVERY_HINT.test(p.label) || (!SHELF_HINT.test(p.label) && DELIVERY_HINT.test(goal));
        return call(delivery ? 'delivery_intake' : 'shelf_audit', { photo: p.id });
      }
      // 2. A photo the tools could not read goes to the pharmacist instead of a guess.
      const failed = done.find((c) => (c.name === 'shelf_audit' || c.name === 'delivery_intake') && c.result?.error);
      if (failed) return call('request_human_review', { photo: failed.args.photo, note: `Could not read ${failed.args.photo} automatically; please check it by hand.` });
      // 3. Stock-wide checks the request asks for (or both when it names neither).
      if ((wantsExpiry || everything) && !done.some((c) => c.name === 'expiry_flags')) return call('expiry_flags');
      if ((wantsRestock || everything) && !done.some((c) => c.name === 'restock_draft')) return call('restock_draft');
      // 4. Final answer built from the tool results.
      return { role: 'assistant', content: summarize(done) };
    },
  };
}

function summarize(done) {
  const parts = [];
  const proposed = done.map((c) => c.result?.proposed_change_set?.id).filter(Boolean);
  const queued = done.flatMap((c) => c.result?.sent_to_review_queue ?? []);
  const scans = done.filter((c) => c.result?.packs_detected !== undefined);
  if (scans.length) parts.push(`Checked ${scans.length} photo(s), ${scans.reduce((s, c) => s + c.result.packs_detected, 0)} packs in total.`);
  const exp = done.find((c) => c.name === 'expiry_flags')?.result;
  if (exp) parts.push(`Stock has ${exp.expired.length} expired and ${exp.near_expiry.length} near-expiry lot(s).`);
  const rs = done.find((c) => c.name === 'restock_draft')?.result;
  if (rs) parts.push(`Restock draft has ${rs.lines.length} line(s); nothing was sent.`);
  parts.push(proposed.length ? `Proposed ${proposed.join(', ')}, waiting for pharmacist approval.` : 'No stock changes proposed.');
  if (queued.length) parts.push(`${queued.length} unclear pack(s) are in the review queue (${queued.join(', ')}).`);
  return parts.join(' ');
}

// Bounded agent loop: the planner (Muse Spark live, or the offline mock) chooses
// which tool to run next; this loop validates every call, runs it, feeds the result
// back, and stops on a final answer, a hand-off to the pharmacist, or the step limit.
// The loop can only PROPOSE stock changes. Approval stays with a named pharmacist.
import { toolDefinitions, executeTool, ToolError } from './tools.js';
import { checkRequest, REFUSAL } from '../safety/guard.js';

export const DEFAULT_MAX_STEPS = 6;
export const MAX_STEPS_LIMIT = 10;

export const SYSTEM_PROMPT = [
  'You are the stock-operations agent for a community pharmacy (synthetic demo data).',
  'Choose tools to complete the pharmacist\'s request. Call one tool at a time and read each result before choosing the next.',
  'Rules:',
  '- Stock, expiry and restock work only. Never give clinical, dosing, interaction or substitution advice. If asked, call request_human_review.',
  '- You cannot change stock. shelf_audit and delivery_intake only PROPOSE change sets; a named pharmacist must approve them.',
  '- Use shelf_audit for shelf photos and delivery_intake for opened delivery cartons. Process each photo at most once.',
  '- If a photo cannot be read or a tool fails, call request_human_review with a short stock-only note instead of guessing.',
  '- When done, reply with 2 to 4 plain sentences: what you checked, what is proposed and waiting for approval, and what needs the pharmacist. Do not claim stock was updated.',
].join('\n');

export function userMessage(goal, photos) {
  const lines = [`Request: ${goal}`];
  lines.push(photos.length ? 'Attached photos:' : 'Attached photos: none');
  for (const p of photos) lines.push(`- ${p.id}: ${p.label ?? p.id}`);
  return lines.join('\n');
}

const toolMessage = (id, content) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify(content) });

export async function runAgent({ goal, photos = [], ctx, planner, maxSteps = DEFAULT_MAX_STEPS, id = `AG-${Date.now()}` }) {
  goal = String(goal ?? '').trim().slice(0, 500);
  const limit = Math.min(Math.max(1, Math.floor(Number(maxSteps)) || DEFAULT_MAX_STEPS), MAX_STEPS_LIMIT);
  const run = { id, photos, processed: new Map(), changeSets: [], reviews: [], handoff: null, restockDraft: null };
  const base = { id, goal, planner: planner.name, provider: ctx.provider?.name ?? null, asOf: ctx.asOf, maxSteps: limit, photos: photos.map(({ id: pid, label, url }) => ({ id: pid, label, url })) };

  if (!goal) throw new ToolError('Give the agent a goal, e.g. "Check this shelf photo and draft today\'s restock".');
  // Deterministic guard before any model call: clinical requests never reach the planner.
  if (!checkRequest(goal).allowed) {
    return { ...base, refused: true, answer: REFUSAL, steps: [], changeSets: [], reviews: [], handoff: null, stoppedReason: 'refused_non_stock_request', pendingApproval: false };
  }

  const tools = toolDefinitions(photos);
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage(goal, photos) }];
  const steps = [];
  let answer = null;
  let stoppedReason = null;
  let turns = 0;

  while (!stoppedReason) {
    if (steps.length >= limit) { stoppedReason = 'max_steps'; break; }
    if (turns++ >= limit + 2) { stoppedReason = 'max_steps'; break; }
    const msg = await planner.next({ messages, tools });
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    // Keep the full assistant message (with tool_calls) in history, as the docs require.
    messages.push({ role: 'assistant', content: msg?.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      const text = String(msg?.content ?? '').trim();
      answer = checkRequest(text).allowed ? text : REFUSAL;
      stoppedReason = 'final_answer';
      break;
    }
    for (const call of calls) {
      const name = call?.function?.name;
      const rawArgs = call?.function?.arguments;
      if (steps.length >= limit) {
        messages.push(toolMessage(call.id, { error: 'Not run: step limit reached.' }));
        continue;
      }
      const step = { n: steps.length + 1, tool: name, args: safeArgs(rawArgs) };
      try {
        step.result = await executeTool(name, rawArgs, ctx, run);
        step.ok = true;
      } catch (e) {
        // Tool errors (bad name, bad args, replay miss, upstream failure) go back to the
        // model as a tool result so it can choose another step; nothing is changed.
        step.ok = false;
        step.error = e instanceof ToolError ? e.message : `Tool failed, nothing was changed: ${e.message}`;
      }
      steps.push(step);
      messages.push(toolMessage(call.id, step.ok ? step.result : { error: step.error }));
      if (run.handoff) { stoppedReason = 'handed_to_pharmacist'; break; }
    }
  }

  const all = await ctx.store.pending();
  const changeSets = run.changeSets.map((csId) => {
    const cs = all.find((c) => c.id === csId);
    return { id: csId, kind: cs?.kind, changes: cs?.changes?.length ?? 0, status: cs?.status };
  });
  await ctx.store.log({ at: new Date().toISOString(), id, kind: 'agent_run', approver: null, changes: 0, steps: steps.length, stoppedReason, proposed: run.changeSets });
  return {
    ...base, refused: false, answer, steps, changeSets, reviews: run.reviews, handoff: run.handoff,
    restockDraft: run.restockDraft, stoppedReason,
    pendingApproval: changeSets.some((c) => c.status === 'awaiting_pharmacist_approval'),
    note: 'The agent only proposes. Stock changes when a named pharmacist approves a change set.',
  };
}

function safeArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return { raw: String(raw).slice(0, 200) }; }
}

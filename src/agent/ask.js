// Stock-only question answering shared by the CLI and the web UI. Clinical and
// substitution questions are refused by the deterministic guard before anything else.
import { checkRequest } from '../safety/guard.js';

export function answerStockQuestion(question, inv, catalog) {
  const g = checkRequest(question);
  if (!g.allowed) return { refused: true, answer: g.message };
  const q = String(question || '').toLowerCase();
  const item = catalog.items.find((i) => q.includes(i.name.toLowerCase()));
  if (!item) return { refused: false, answer: 'I can answer stock questions about catalog items, e.g. "how many Paracetamol packs do we have?"' };
  const qty = inv.lots.filter((l) => l.sku === item.sku).reduce((s, l) => s + l.qty, 0);
  return { refused: false, sku: item.sku, qty, answer: `${item.name} ${item.strength} x${item.pack_size}: ${qty} packs on hand.` };
}

// The agent handles stock, expiry and ordering only. It never gives clinical advice
// or suggests substitutes. This deterministic check runs before any free-text request
// and on any text the agent writes into a draft.

const CLINICAL = [
  /\bsubstitut/i, /\balternative\b/i, /\binstead of\b/i, /\bswap\b/i, /\bequivalent\b/i, /\bgeneric (for|of)\b/i,
  /\bdos(e|age|ing)\b/i, /\bhow (much|many) (should|can) (i|he|she|they|we) take\b/i,
  /\binteract/i, /\bside effects?\b/i, /\bpregnan/i, /\bcontraindicat/i, /\bsafe (for|to take|with)\b/i,
  /\btreat(s|ment)?\b/i, /\bwhat is .* (for|used for)\b/i, /\bprescri(be|ption advice)\b/i,
  /بديل/, /جرعة/, /تفاعل/, /آثار جانبية/,
];

export const REFUSAL = 'I only handle stock, expiry and restock drafts. I can\u2019t give clinical or substitution advice. Please ask the pharmacist.';

export function checkRequest(text) {
  const hit = CLINICAL.find((re) => re.test(String(text || '')));
  return hit ? { allowed: false, message: REFUSAL } : { allowed: true };
}

// Throws if generated draft text drifts into clinical territory.
export function assertNonClinical(text) {
  if (!checkRequest(text).allowed) throw new Error('Draft contains clinical or substitution wording; blocked.');
  return text;
}

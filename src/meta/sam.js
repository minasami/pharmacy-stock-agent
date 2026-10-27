// Parse SAM 3.1 output. SAM returns special-token text rather than JSON, e.g.
//   <0f>0<|box;x1=10;y1=20;x2=110;y2=140;w=1000;h=640|><|mask;...|>
// We keep the boxes (and the score when present) and ignore mask payloads.

const BOX_RE = /<\|box;([^|]*)\|>/g;

export function parseSamBoxes(text) {
  if (typeof text !== 'string') return [];
  const boxes = [];
  for (const m of text.matchAll(BOX_RE)) {
    const fields = Object.fromEntries(
      m[1].split(';').map((kv) => kv.split('=')).filter((p) => p.length === 2)
        .map(([k, v]) => [k.trim(), Number(v)]),
    );
    const { x1, y1, x2, y2 } = fields;
    if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
    boxes.push({
      x1, y1, x2, y2,
      ...(Number.isFinite(fields.w) ? { imgW: fields.w } : {}),
      ...(Number.isFinite(fields.h) ? { imgH: fields.h } : {}),
      ...(Number.isFinite(fields.score) ? { score: fields.score } : {}),
    });
  }
  return dedupe(boxes);
}

// Drop near-duplicate boxes (IoU > 0.8) that SAM sometimes emits for one pack.
export function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const area = (r) => (r.x2 - r.x1) * (r.y2 - r.y1);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

function dedupe(boxes) {
  const kept = [];
  for (const b of boxes) if (!kept.some((k) => iou(k, b) > 0.8)) kept.push(b);
  return kept;
}

// Pull the text out of a /responses payload. The non-streaming envelope is not yet
// verified against the live API, so accept the common shapes.
export function responseText(json) {
  if (!json) return '';
  if (typeof json.output_text === 'string') return json.output_text;
  if (Array.isArray(json.output)) {
    return json.output.flatMap((o) => (Array.isArray(o.content) ? o.content : []))
      .map((c) => c.text || '').join('');
  }
  return '';
}

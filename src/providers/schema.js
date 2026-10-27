// What we ask the vision model to read from each detected pack. Identification only:
// there is deliberately no field for uses, doses, alternatives or substitutes.
export const READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['packs'],
  properties: {
    packs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['region', 'name', 'strength', 'pack_size', 'lot', 'expiry', 'confidence'],
        properties: {
          region: { type: 'integer', description: 'Index of the numbered box this pack is in' },
          name: { type: 'string', description: 'Product name exactly as printed; empty if unreadable' },
          strength: { type: 'string' },
          pack_size: { type: ['integer', 'null'] },
          lot: { type: 'string', description: 'Batch/lot code as printed; use ? for unreadable characters' },
          expiry: { type: 'string', description: 'Expiry as printed, e.g. 09/2027' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

export function readingPrompt(boxes) {
  const list = boxes.map((b, i) => `${i}: x1=${b.x1} y1=${b.y1} x2=${b.x2} y2=${b.y2}`).join('\n');
  return [
    'You are reading medicine pack labels in a pharmacy stock photo for an inventory count.',
    'A segmentation model found these pack regions (pixel coordinates):',
    list,
    'For each region, transcribe the printed product name, strength, pack size, lot/batch code and expiry date.',
    'Copy text exactly as printed. Do not guess: use "?" for characters you cannot read and lower the confidence.',
    'Do not add any medical information, uses, dosing, or alternative products.',
    'Return JSON matching the schema.',
  ].join('\n');
}

// Check a model reply against READING_SCHEMA in code. Needed where the host has no JSON
// mode (Muse Spark Open on Baseten), and harmless elsewhere. Anything malformed becomes
// an unreadable placeholder (confidence 0), which the matcher sends to a human.
export function normaliseReadings(out, boxes) {
  const packs = Array.isArray(out?.packs) ? out.packs : [];
  const str = (v) => (typeof v === 'string' ? v.slice(0, 120) : '');
  return boxes.map((_, i) => {
    const p = packs.find((x) => x && Number(x.region) === i);
    if (!p) return { region: i, name: '', strength: '', pack_size: null, lot: '', expiry: '', confidence: 0 };
    const size = Number(p.pack_size);
    const conf = Number(p.confidence);
    return {
      region: i,
      name: str(p.name),
      strength: str(p.strength),
      pack_size: Number.isInteger(size) && size > 0 ? size : null,
      lot: str(p.lot),
      expiry: str(p.expiry),
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    };
  });
}

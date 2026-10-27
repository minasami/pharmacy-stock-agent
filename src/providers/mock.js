// Deterministic offline provider. Replays the <image>.truth.json sidecar written by
// scripts/make_samples.py, so demos and tests run without an API key.
// It can only "read" the bundled synthetic sample photos; any other photo needs
// the live provider (MODEL_PROVIDER=meta with MODEL_API_KEY).
import { readFile } from 'node:fs/promises';

export class ReplayMissError extends Error {}

async function truth(imagePath) {
  const p = imagePath.replace(/\.(png|jpe?g|webp)$/i, '.truth.json');
  let raw;
  try { raw = await readFile(p, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    throw new ReplayMissError(`The offline replay provider has no recorded result for ${imagePath}. Use a bundled sample (samples/*.png), or set MODEL_PROVIDER=meta and MODEL_API_KEY to read new photos live.`);
  }
  const t = JSON.parse(raw);
  if (!Array.isArray(t.regions)) throw new Error(`Replay sidecar ${p} has no regions array.`);
  return t;
}

export const mockProvider = {
  name: 'mock',
  async detectPacks(imagePath) {
    return (await truth(imagePath)).regions.map((r) => ({ ...r.box, score: r.score }));
  },
  async readPacks(imagePath, boxes) {
    const t = await truth(imagePath);
    return boxes.map((_, i) => ({ region: i, ...t.regions[i].reading }));
  },
};

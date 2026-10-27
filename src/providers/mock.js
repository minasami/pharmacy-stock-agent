// Deterministic offline provider. Replays the <image>.truth.json sidecar written by
// scripts/make_samples.py, so demos and tests run without an API key.
import { readFile } from 'node:fs/promises';

async function truth(imagePath) {
  const p = imagePath.replace(/\.(png|jpe?g|webp)$/i, '.truth.json');
  return JSON.parse(await readFile(p, 'utf8'));
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

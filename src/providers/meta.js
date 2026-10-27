// Live provider: SAM 3.1 finds each pack, Muse Spark reads every numbered region in one call.
import { MetaClient } from '../meta/client.js';
import { READING_SCHEMA, readingPrompt } from './schema.js';

export function metaProvider(cfg, fetchImpl) {
  const client = new MetaClient(cfg, fetchImpl);
  return {
    name: 'meta',
    async detectPacks(imagePath) {
      return client.segment(imagePath, 'medicine box');
    },
    async readPacks(imagePath, boxes) {
      if (!boxes.length) return [];
      const out = await client.readJson(imagePath, readingPrompt(boxes), READING_SCHEMA);
      const packs = Array.isArray(out?.packs) ? out.packs : [];
      // One reading per region; a missing region becomes an unreadable placeholder.
      return boxes.map((_, i) => packs.find((p) => p.region === i)
        ?? { region: i, name: '', strength: '', pack_size: null, lot: '', expiry: '', confidence: 0 });
    },
  };
}

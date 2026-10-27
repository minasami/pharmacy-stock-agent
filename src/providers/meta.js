// Live provider: SAM 3.1 finds each pack, Muse Spark reads every numbered region in one call.
import { MetaClient } from '../meta/client.js';
import { READING_SCHEMA, readingPrompt, normaliseReadings } from './schema.js';

export function metaProvider(cfg, fetchImpl) {
  const client = new MetaClient(cfg, fetchImpl);
  return {
    name: 'meta',
    detector: `${cfg.samModel} (Meta Model API)`,
    canReadNewPhotos: true,
    async detectPacks(imagePath) {
      return client.segment(imagePath, 'medicine box');
    },
    async readPacks(imagePath, boxes) {
      if (!boxes.length) return [];
      const out = await client.readJson(imagePath, readingPrompt(boxes), READING_SCHEMA);
      // One reading per region; a missing or malformed region becomes an unreadable placeholder.
      return normaliseReadings(out, boxes);
    },
  };
}

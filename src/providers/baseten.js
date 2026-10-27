// Backup live provider: open-weights Muse Spark Open on Baseten Model APIs reads the packs.
// SAM 3.1 is only on the Meta Model API, so pack boxes come from:
//   1. SAM 3.1 on the Meta API, if MODEL_API_KEY is also set; otherwise
//   2. the recorded boxes of the bundled synthetic samples (the offline fixture sidecars),
//      clearly labelled "offline fixture, not SAM". Any other photo is refused with a
//      clear message instead of guessing regions.
import { MetaClient, basetenClient } from '../meta/client.js';
import { READING_SCHEMA, readingPrompt, normaliseReadings } from './schema.js';
import { mockProvider, ReplayMissError } from './mock.js';

export class SamUnavailableError extends ReplayMissError {}

export const FIXTURE_DETECTOR = 'recorded sample boxes (offline fixture, not SAM)';

export function basetenProvider(cfg, fetchImpl) {
  const reader = basetenClient(cfg, fetchImpl);
  const sam = cfg.apiKey ? new MetaClient(cfg, fetchImpl) : null;
  return {
    name: 'baseten',
    model: cfg.baseten.model,
    detector: sam ? `${cfg.samModel} (Meta Model API)` : FIXTURE_DETECTOR,
    canReadNewPhotos: Boolean(sam),
    async detectPacks(imagePath) {
      if (sam) return sam.segment(imagePath, 'medicine box');
      try {
        const boxes = await mockProvider.detectPacks(imagePath);
        return boxes.map((b) => ({ ...b, source: 'fixture' }));
      } catch (e) {
        if (!(e instanceof ReplayMissError)) throw e;
        throw new SamUnavailableError('SAM 3.1 is only on the Meta Model API and MODEL_API_KEY is not set, so this photo has no pack boxes. With MODEL_PROVIDER=baseten alone, only the bundled synthetic samples work (their recorded boxes are used, labelled as an offline fixture). Set MODEL_API_KEY as well to detect packs in new photos.');
      }
    },
    async readPacks(imagePath, boxes) {
      if (!boxes.length) return [];
      const out = await reader.readJson(imagePath, readingPrompt(boxes), READING_SCHEMA);
      return normaliseReadings(out, boxes);
    },
  };
}

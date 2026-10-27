import { mockProvider } from './mock.js';
import { metaProvider } from './meta.js';
import { basetenProvider } from './baseten.js';

export function getProvider(cfg, fetchImpl) {
  if (cfg.provider === 'meta') return metaProvider(cfg, fetchImpl);
  if (cfg.provider === 'baseten') return basetenProvider(cfg, fetchImpl);
  return mockProvider;
}

import { mockProvider } from './mock.js';
import { metaProvider } from './meta.js';

export function getProvider(cfg, fetchImpl) {
  return cfg.provider === 'meta' ? metaProvider(cfg, fetchImpl) : mockProvider;
}

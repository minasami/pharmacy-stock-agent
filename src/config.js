// Runtime configuration. The API key is read from the environment only and never logged.
//
// Provider switch:
//   MODEL_PROVIDER=mock  offline replay of the bundled synthetic samples (default, no key needed)
//   MODEL_PROVIDER=meta  live Meta Model API (SAM 3.1 + Muse Spark); needs MODEL_API_KEY
// If MODEL_PROVIDER is unset, the live provider is used only when MODEL_API_KEY is set.
export const PROVIDERS = ['mock', 'meta'];

export class ConfigError extends Error {}

function positiveNumber(raw, name, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive number (got "${raw}").`);
  return n;
}

export function loadConfig(env = process.env) {
  const apiKey = (env.MODEL_API_KEY || '').trim();
  const provider = (env.MODEL_PROVIDER || (apiKey ? 'meta' : 'mock')).trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new ConfigError(`MODEL_PROVIDER must be one of ${PROVIDERS.join(' | ')} (got "${env.MODEL_PROVIDER}").`);
  }
  if (provider === 'meta' && !apiKey) {
    throw new ConfigError('MODEL_PROVIDER=meta needs MODEL_API_KEY. Set the key, or use MODEL_PROVIDER=mock to run offline on the synthetic samples.');
  }
  return {
    provider,
    apiKey,
    baseUrl: (env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    visionModel: env.META_VISION_MODEL || 'muse-spark-1.3',
    samModel: env.META_SAM_MODEL || 'sam-3.1',
    nearExpiryDays: positiveNumber(env.NEAR_EXPIRY_DAYS, 'NEAR_EXPIRY_DAYS', 90),
    timeoutMs: positiveNumber(env.META_TIMEOUT_MS, 'META_TIMEOUT_MS', 60000),
  };
}

// Human-readable provider label for logs and the UI. Never includes the key.
export function providerLabel(cfg) {
  return cfg.provider === 'meta' ? `meta (live: ${cfg.samModel} + ${cfg.visionModel})` : 'mock (offline replay of synthetic samples)';
}

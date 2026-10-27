// Runtime configuration. The API key is read from the environment only and never logged.
//
// Provider switch:
//   MODEL_PROVIDER=mock  offline replay of the bundled synthetic samples (default, no key needed)
//   MODEL_PROVIDER=meta  live Meta Model API (SAM 3.1 + Muse Spark); needs MODEL_API_KEY
//   MODEL_PROVIDER=baseten  open-weights Muse Spark Open on Baseten Model APIs for the
//                          pack reads and the agent planner; needs BASETEN_API_KEY. SAM 3.1
//                          is Meta-API-only: it is used if MODEL_API_KEY is also set,
//                          otherwise the bundled samples use their recorded (fixture) boxes.
// If MODEL_PROVIDER is unset: MODEL_API_KEY -> meta, else BASETEN_API_KEY -> baseten, else mock.
export const PROVIDERS = ['mock', 'meta', 'baseten'];
export const BASETEN_DEFAULT_MODEL = 'meta-models/muse-spark-open-1026';
const REASONING = ['low', 'medium', 'high', 'xhigh'];

export class ConfigError extends Error {}

function positiveNumber(raw, name, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive number (got "${raw}").`);
  return n;
}

export function loadConfig(env = process.env) {
  const apiKey = (env.MODEL_API_KEY || '').trim();
  const basetenKey = (env.BASETEN_API_KEY || '').trim();
  const provider = (env.MODEL_PROVIDER || (apiKey ? 'meta' : basetenKey ? 'baseten' : 'mock')).trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new ConfigError(`MODEL_PROVIDER must be one of ${PROVIDERS.join(' | ')} (got "${env.MODEL_PROVIDER}").`);
  }
  if (provider === 'meta' && !apiKey) {
    throw new ConfigError('MODEL_PROVIDER=meta needs MODEL_API_KEY. Set the key, or use MODEL_PROVIDER=mock to run offline on the synthetic samples.');
  }
  if (provider === 'baseten' && !basetenKey) {
    throw new ConfigError('MODEL_PROVIDER=baseten needs BASETEN_API_KEY. Set the key, or use MODEL_PROVIDER=mock to run offline on the synthetic samples.');
  }
  const effort = (env.BASETEN_REASONING_EFFORT || '').trim().toLowerCase();
  if (effort && !REASONING.includes(effort)) throw new ConfigError(`BASETEN_REASONING_EFFORT must be one of ${REASONING.join(' | ')} (got "${env.BASETEN_REASONING_EFFORT}").`);
  return {
    provider,
    apiKey,
    baseUrl: (env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    visionModel: env.META_VISION_MODEL || 'muse-spark-1.3',
    samModel: env.META_SAM_MODEL || 'sam-3.1',
    agentModel: env.META_AGENT_MODEL || env.META_VISION_MODEL || 'muse-spark-1.3',
    nearExpiryDays: positiveNumber(env.NEAR_EXPIRY_DAYS, 'NEAR_EXPIRY_DAYS', 90),
    timeoutMs: positiveNumber(env.META_TIMEOUT_MS, 'META_TIMEOUT_MS', 60000),
    baseten: {
      apiKey: basetenKey,
      baseUrl: (env.BASETEN_BASE_URL || 'https://inference.baseten.co/v1').replace(/\/$/, ''),
      model: (env.BASETEN_MODEL || BASETEN_DEFAULT_MODEL).trim(),
      // Muse Spark Open always reasons (default effort xhigh), so allow longer calls.
      timeoutMs: positiveNumber(env.BASETEN_TIMEOUT_MS, 'BASETEN_TIMEOUT_MS', 120000),
      reasoningEffort: effort || null,
    },
  };
}

// Human-readable provider label for logs and the UI. Never includes the key.
export function providerLabel(cfg) {
  if (cfg.provider === 'meta') return `meta (live: ${cfg.samModel} + ${cfg.visionModel})`;
  if (cfg.provider === 'baseten') {
    const sam = cfg.apiKey ? `${cfg.samModel} on Meta API` : 'recorded sample boxes (SAM unavailable)';
    return `baseten (live: ${cfg.baseten.model}; boxes: ${sam})`;
  }
  return 'mock (offline replay of synthetic samples)';
}

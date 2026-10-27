// Runtime configuration. The API key is read from the environment only and never logged.
export function loadConfig(env = process.env) {
  return {
    provider: (env.MODEL_PROVIDER || (env.MODEL_API_KEY ? 'meta' : 'mock')).toLowerCase(),
    apiKey: env.MODEL_API_KEY || '',
    baseUrl: (env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    visionModel: env.META_VISION_MODEL || 'muse-spark-1.3',
    samModel: env.META_SAM_MODEL || 'sam-3.1',
    nearExpiryDays: Number(env.NEAR_EXPIRY_DAYS || 90),
  };
}

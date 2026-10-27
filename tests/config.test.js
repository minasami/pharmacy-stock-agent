import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, providerLabel, ConfigError } from '../src/config.js';

test('config: mock is the default; a key alone switches to live; explicit mock wins over a key', () => {
  assert.equal(loadConfig({}).provider, 'mock');
  assert.equal(loadConfig({ MODEL_API_KEY: 'LLM_test' }).provider, 'meta');
  assert.equal(loadConfig({ MODEL_API_KEY: 'LLM_test', MODEL_PROVIDER: 'mock' }).provider, 'mock');
  assert.equal(loadConfig({ MODEL_PROVIDER: ' MOCK ' }).provider, 'mock');
});

test('config: fails fast on an unknown provider, live without a key, or a bad expiry window', () => {
  assert.throws(() => loadConfig({ MODEL_PROVIDER: 'live' }), ConfigError);
  assert.throws(() => loadConfig({ MODEL_PROVIDER: 'meta' }), /needs MODEL_API_KEY/);
  assert.throws(() => loadConfig({ MODEL_PROVIDER: 'meta', MODEL_API_KEY: '   ' }), /needs MODEL_API_KEY/);
  assert.throws(() => loadConfig({ NEAR_EXPIRY_DAYS: 'ninety' }), /NEAR_EXPIRY_DAYS/);
  assert.equal(loadConfig({ NEAR_EXPIRY_DAYS: '60' }).nearExpiryDays, 60);
});

test('config: provider label never contains the API key', () => {
  const cfg = loadConfig({ MODEL_API_KEY: 'LLM_123_secretvalue' });
  assert.match(providerLabel(cfg), /^meta \(live: sam-3\.1 \+ muse-spark-1\.3\)$/);
  assert.ok(!providerLabel(cfg).includes('secretvalue'));
  assert.match(providerLabel(loadConfig({})), /^mock/);
});

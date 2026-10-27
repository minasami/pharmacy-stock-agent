// Minimal Meta Model API client (OpenAI-compatible surface), written for this entry.
// Notes from the public developer docs: base https://api.meta.ai/v1, Bearer auth,
// muse-spark-1.3 on /chat/completions (vision via image_url), sam-3.1 on /responses.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseSamBoxes, responseText } from './sam.js';

export async function imageDataUrl(path) {
  const ext = extname(path).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
  const b64 = (await readFile(path)).toString('base64');
  return `data:${mime};base64,${b64}`;
}

export class MetaClient {
  constructor(cfg, fetchImpl = globalThis.fetch) {
    if (!cfg.apiKey) throw new Error('MODEL_API_KEY is not set; use MODEL_PROVIDER=mock to run offline.');
    this.cfg = cfg;
    this.fetch = fetchImpl;
  }

  // POST with a per-request timeout and a small retry on rate limits and server
  // errors (HTTP 429 / 5xx, honouring Retry-After up to 10 s). Client errors
  // (400, 401, 403, 404, 422) are not retried. The key never appears in errors.
  async post(path, body) {
    const { timeoutMs = 60000, retries = 2, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = this.cfg;
    const payload = JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetch(`${this.cfg.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        if (attempt < retries) { await sleep(backoff(attempt)); continue; }
        throw new Error(timedOut
          ? `Meta API ${path} timed out after ${timeoutMs} ms`
          : `Meta API ${path} network error: ${this.redact(e?.message ?? String(e))}`);
      }
      if (res.ok) {
        try { return await res.json(); } catch { throw new Error(`Meta API ${path} returned a non-JSON body`); }
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        const ra = Number(res.headers?.get?.('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : backoff(attempt));
        continue;
      }
      const detail = this.redact((await res.text().catch(() => '')).slice(0, 300));
      const hint = res.status === 401 || res.status === 403
        ? ' (check MODEL_API_KEY and that credits or a card are on the account)'
        : res.status === 429 ? ' (rate limited; try again shortly)' : '';
      throw new Error(`Meta API ${path} failed: HTTP ${res.status}${hint} ${detail}`.trim());
    }
  }

  redact(text) {
    return this.cfg.apiKey ? String(text).split(this.cfg.apiKey).join('[redacted]') : String(text);
  }

  // SAM 3.1: segment every instance of a short noun phrase.
  async segment(imagePath, phrase = 'medicine box') {
    const json = await this.post('/responses', {
      model: this.cfg.samModel,
      // Shape from dev.meta.ai/docs/sam/overview: one user message with a short
      // noun phrase and one image part. Non-streaming returns the full result.
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: phrase },
          { type: 'input_image', image_url: await imageDataUrl(imagePath) },
        ],
      }],
    });
    return parseSamBoxes(responseText(json));
  }

  // Muse Spark vision with a JSON schema response.
  async readJson(imagePath, prompt, schema) {
    const json = await this.post('/chat/completions', {
      model: this.cfg.visionModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: await imageDataUrl(imagePath) } },
        ],
      }],
      response_format: { type: 'json_schema', json_schema: { name: 'pack_readings', schema, strict: true } },
    });
    return parseJsonLoose(json?.choices?.[0]?.message?.content ?? '');
  }
}

const backoff = (attempt) => 500 * 2 ** attempt;

export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('Model returned no JSON');
  return JSON.parse(body.slice(start));
}

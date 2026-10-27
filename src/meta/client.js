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

  async post(path, body) {
    const res = await this.fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Meta API ${path} failed: HTTP ${res.status} ${detail}`);
    }
    return res.json();
  }

  // SAM 3.1: segment every instance of a short noun phrase.
  async segment(imagePath, phrase = 'medicine box') {
    const json = await this.post('/responses', {
      model: this.cfg.samModel,
      input: [{
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

export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('Model returned no JSON');
  return JSON.parse(body.slice(start));
}

#!/usr/bin/env node
// Minimal web UI server. Node built-ins only (no npm dependencies).
// Binds to 127.0.0.1 by default. Runs on the offline replay provider unless
// MODEL_PROVIDER=meta / MODEL_API_KEY is set. Synthetic data only.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, providerLabel, ConfigError } from '../config.js';
import { getProvider } from '../providers/index.js';
import { Store } from '../inventory/store.js';
import { today, parseExpiry, expiryStatus, daysUntil } from '../inventory/expiry.js';
import { shelfAudit, deliveryIntake, expiryReport, draftRestock } from '../agent/workflows.js';
import { formatRestock } from '../agent/format.js';
import { answerStockQuestion } from '../agent/ask.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(ROOT, 'web');
const SAMPLES = join(ROOT, 'samples');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const SAFE_FILE = /^[\w.-]+\.(png|jpe?g|webp)$/i;
const MAX_BODY = 12 * 1024 * 1024;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// Pharmacist names are free text but must be present and sensible.
export function pharmacistName(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 80) throw new HttpError(400, 'Type the approving pharmacist\u2019s name (2-80 characters).');
  return s;
}

function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'Upload too large (max 12 MB).'); chunks.push(c); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Body must be JSON.'); }
}

export function createApp(opts = {}) {
  const cfg = opts.cfg ?? loadConfig();
  const store = opts.store ?? new Store(process.env.STOCK_STATE_DIR || undefined);
  const provider = opts.provider ?? getProvider(cfg);
  const asOf = () => opts.asOf ?? process.env.AS_OF ?? today();
  const nearDays = cfg.nearExpiryDays;
  const uploads = join(store.dir, 'uploads');
  let sampleHashes;

  async function samples() {
    const files = (await readdir(SAMPLES)).filter((f) => SAFE_FILE.test(f)).sort();
    if (!sampleHashes) {
      sampleHashes = new Map();
      for (const f of files) sampleHashes.set(sha(await readFile(join(SAMPLES, f))), f);
    }
    return files;
  }

  // Resolve the image to scan: a bundled synthetic sample, or an uploaded photo.
  // The replay provider can only replay bundled samples (it reads their sidecar),
  // so an upload that is byte-identical to a sample is mapped back to it.
  async function resolveImage(body) {
    const list = await samples();
    if (body.sample) {
      if (!list.includes(body.sample)) throw new HttpError(404, 'Unknown sample.');
      return { path: join('samples', body.sample), url: `/samples/${body.sample}`, label: body.sample };
    }
    const m = /^data:image\/[\w.+-]+;base64,(.+)$/s.exec(String(body.image ?? ''));
    if (!m) throw new HttpError(400, 'Send a sample name or an image data URL.');
    const buf = Buffer.from(m[1], 'base64');
    const kind = sniffImage(buf);
    if (!kind) throw new HttpError(415, 'Upload a PNG, JPEG or WebP photo.');
    const hash = sha(buf);
    const same = sampleHashes.get(hash);
    if (same) return { path: join('samples', same), url: `/samples/${same}`, label: `upload (${same})` };
    if (provider.name !== 'meta') {
      throw new HttpError(422, 'The offline replay provider only knows the bundled synthetic sample photos. Upload one of those, or set MODEL_API_KEY to read new photos with SAM 3.1 and Muse Spark.');
    }
    await mkdir(uploads, { recursive: true });
    const name = `${hash.slice(0, 16)}.${kind}`;
    await writeFile(join(uploads, name), buf);
    return { path: join(uploads, name), url: `/uploads/${name}`, label: 'upload' };
  }

  async function scan(body) {
    const mode = body.mode === 'delivery' ? 'delivery' : 'shelf';
    const img = await resolveImage(body);
    const catalog = await store.catalog();
    const ctx = { provider, catalog, store, asOf: asOf(), nearDays };
    const r = mode === 'delivery' ? await deliveryIntake(img.path, ctx) : await shelfAudit(img.path, ctx);
    const reviews = await store.addReviews(r.review.map((p) => ({
      source: mode, image: img.url, region: p.region, box: p.box, reading: p.reading, reasons: p.reviewReasons,
    })));
    const byRegion = new Map(reviews.map((rv) => [rv.region, rv.id]));
    const name = (sku) => catalog.items.find((i) => i.sku === sku)?.name ?? null;
    return {
      mode, provider: provider.name, asOf: asOf(), image: img.url, label: img.label,
      packs: r.scan.packs.map((p) => ({
        region: p.region, box: p.box, sku: p.sku, name: name(p.sku), reading: p.reading,
        needsReview: p.needsReview, reviewReasons: p.reviewReasons, reviewId: byRegion.get(p.region) ?? null,
        expiry: p.expiry, expiryStatus: p.expiryStatus,
      })),
      summary: mode === 'delivery'
        ? { toReceive: r.received, flagged: r.flagged, review: reviews.length }
        : { pull: r.pull, nearExpiry: r.nearExpiry, unknownLots: r.unknownLots, review: reviews.length },
      changeSet: r.changeSet,
    };
  }

  // Pharmacist identifies an unclear pack by choosing what is printed on it.
  // No catalog item is pre-selected: the agent never maps a doubtful read to a product.
  async function resolveReview(id, body) {
    const by = pharmacistName(body.by);
    const rv = (await store.reviews()).find((r) => r.id === id);
    if (!rv) throw new HttpError(404, `No review item ${id}`);
    if (rv.status !== 'open') throw new HttpError(409, `${id} is already ${rv.status}`);
    if (body.action === 'set_aside') {
      const note = String(body.note ?? '').slice(0, 200);
      return { review: await store.resolveReview(id, by, { action: 'set_aside', note }), changeSet: null };
    }
    if (body.action !== 'identify') throw new HttpError(400, 'action must be identify or set_aside');
    const catalog = await store.catalog();
    const item = catalog.items.find((i) => i.sku === body.sku);
    if (!item) throw new HttpError(400, 'Choose the catalog item printed on the pack.');
    const lot = String(body.lot ?? '').trim();
    if (!/^[\w-]{2,30}$/.test(lot)) throw new HttpError(400, 'Type the lot code as printed.');
    const expiry = parseExpiry(String(body.expiry ?? '').trim());
    if (!expiry) throw new HttpError(400, 'Type the expiry as printed, e.g. 09/2027.');
    const status = expiryStatus(expiry, asOf(), nearDays);
    let changeSet = null;
    if (rv.source === 'delivery' && status === 'ok') {
      changeSet = await store.propose({ kind: 'review_receive', source: `${rv.image} ${id}`, changes: [{ op: 'receive', sku: item.sku, lot, expiry, qty: 1 }] });
    } else if (rv.source === 'shelf' && status === 'expired') {
      changeSet = await store.propose({ kind: 'review_quarantine', source: `${rv.image} ${id}`, changes: [{ op: 'quarantine', sku: item.sku, lot, reason: `expired ${expiry}` }] });
    }
    const review = await store.resolveReview(id, by, { action: 'identify', sku: item.sku, lot, expiry, expiryStatus: status, changeSet: changeSet?.id ?? null });
    return { review, changeSet };
  }

  async function inventoryView() {
    const [inv, catalog] = [await store.inventory(), await store.catalog()];
    const d = asOf();
    const lots = inv.lots.map((l) => {
      const it = catalog.items.find((i) => i.sku === l.sku) ?? {};
      return { ...l, name: it.name, strength: it.strength, pack_size: it.pack_size, quarantined: l.quarantined ?? 0, status: expiryStatus(l.expiry, d, nearDays), days: daysUntil(l.expiry, d) };
    }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.expiry.localeCompare(b.expiry));
    const items = catalog.items.map((it) => {
      const mine = lots.filter((l) => l.sku === it.sku);
      const usable = mine.filter((l) => l.status !== 'expired').reduce((s, l) => s + l.qty, 0);
      return { sku: it.sku, name: it.name, strength: it.strength, pack_size: it.pack_size, usable, reorderPoint: it.reorder_point, parLevel: it.par_level, low: usable <= it.reorder_point };
    });
    return { pharmacy: inv.pharmacy, asOf: d, nearDays, lots, items, expiry: expiryReport(inv, catalog, d, nearDays) };
  }

  async function api(method, path, req) {
    const route = `${method} ${path}`;
    let m;
    if (route === 'GET /api/status') {
      const inv = await store.inventory();
      return { provider: provider.name, asOf: asOf(), nearDays, pharmacy: inv.pharmacy, synthetic: true, samples: await samples() };
    }
    if (route === 'POST /api/scan') return scan(await readBody(req));
    if (route === 'GET /api/catalog') return (await store.catalog()).items.map(({ sku, name, strength, pack_size }) => ({ sku, name, strength, pack_size }));
    if (route === 'GET /api/review') return store.reviews();
    if (method === 'POST' && (m = path.match(/^\/api\/review\/(RV-\d{3,})\/resolve$/))) return resolveReview(m[1], await readBody(req));
    if (route === 'GET /api/changesets') return store.pending();
    if (method === 'POST' && (m = path.match(/^\/api\/changesets\/(CS-\d{3,})\/(approve|reject)$/))) {
      const body = await readBody(req);
      const by = pharmacistName(body.by);
      try {
        return m[2] === 'approve' ? await store.approve(m[1], by) : await store.reject(m[1], by, String(body.reason ?? '').slice(0, 200));
      } catch (e) { throw new HttpError(/No change set/.test(e.message) ? 404 : 409, e.message); }
    }
    if (route === 'GET /api/inventory') return inventoryView();
    if (route === 'GET /api/restock') {
      const draft = draftRestock(await store.inventory(), await store.catalog(), asOf(), nearDays);
      return { ...draft, text: formatRestock(draft) };
    }
    if (route === 'GET /api/audit') return store.auditLog();
    if (route === 'POST /api/ask') {
      const body = await readBody(req);
      return answerStockQuestion(String(body.question ?? '').slice(0, 500), await store.inventory(), await store.catalog());
    }
    if (route === 'POST /api/reset') { await store.reset(); return { ok: true }; }
    throw new HttpError(404, 'Not found');
  }

  async function serveFile(res, dir, name) {
    const p = join(dir, name);
    if (!existsSync(p)) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(await readFile(p));
  }

  async function handle(req, res) {
    try {
      let path;
      try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { throw new HttpError(400, 'Bad URL'); }
      if (path.startsWith('/api/')) {
        const out = await api(req.method, path, req);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(out));
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      if (path === '/' || path === '/index.html') return await serveFile(res, WEB, 'index.html');
      if (path === '/app.js' || path === '/style.css') return await serveFile(res, WEB, path.slice(1));
      let m;
      if ((m = path.match(/^\/samples\/([^/]+)$/)) && SAFE_FILE.test(m[1])) return await serveFile(res, SAMPLES, m[1]);
      if ((m = path.match(/^\/uploads\/([^/]+)$/)) && SAFE_FILE.test(m[1])) return await serveFile(res, uploads, m[1]);
      throw new HttpError(404, 'Not found');
    } catch (e) {
      const status = e.status ?? (/required/.test(e.message) ? 400 : 500);
      if (status === 500) console.error(e);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'Internal error' : e.message }));
    }
  }

  return { handle, store, provider };
}

export function startServer({ port = 0, host = '127.0.0.1', ...opts } = {}) {
  const app = createApp(opts);
  const server = createServer((req, res) => { app.handle(req, res); });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let cfg;
  try { cfg = loadConfig(); } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`Config error: ${e.message}`);
    process.exit(2);
  }
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  const server = await startServer({ port, host, cfg });
  console.log(`Pharmacy Stock Agent UI on http://${host}:${server.address().port}  (provider: ${providerLabel(cfg)}, as of ${process.env.AS_OF || today()}, synthetic data)`);
}

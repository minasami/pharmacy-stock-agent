// Pharmacy Stock Agent web UI. Plain ES modules, no framework, no build step.
// All text is inserted with textContent, never innerHTML.
const $ = (sel) => document.querySelector(sel);
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  return out;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  // Errors interrupt screen readers (alert); confirmations are announced politely.
  t.setAttribute('role', err ? 'alert' : 'status');
  t.setAttribute('aria-live', err ? 'assertive' : 'polite');
  t.textContent = msg; t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 6000 : 3000);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

const STATUS_LABEL = { ok: 'OK', near_expiry: 'Near expiry', expired: 'Expired', unknown: 'Expiry unreadable', review: 'Needs review' };
const badge = (st, text) => h('span', { class: `badge b-${st}` }, text ?? STATUS_LABEL[st] ?? st.replaceAll('_', ' '));
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

// ---- pharmacist name, shared by every approve / resolve action ----
const nameKey = 'pharmacistName';
const getName = () => (localStorage.getItem(nameKey) || '').trim();
function nameField(onChange) {
  const input = h('input', { type: 'text', placeholder: 'e.g. Demo Pharmacist', value: getName(), maxlength: 80, autocomplete: 'off', 'aria-label': 'Approving pharmacist name' });
  input.addEventListener('input', () => { localStorage.setItem(nameKey, input.value); onChange?.(); });
  return h('label', {}, 'Approving pharmacist (your name, recorded in the audit log)', input);
}

// ---- photo with detected-pack overlay ----
function loadImage(src) {
  return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Image failed to load')); i.src = src; });
}
const packClass = (p) => (p.needsReview ? 'review' : p.expiryStatus === 'unknown' ? 'review' : p.expiryStatus);

async function overlay(src, packs, viewBox) {
  const img = await loadImage(src);
  const W = img.naturalWidth, H = img.naturalHeight;
  const vb = viewBox ?? [0, 0, W, H];
  const svg = s('svg', { viewBox: vb.join(' '), role: 'img', 'aria-label': `Photo with ${packs.length} detected packs` },
    s('image', { href: src, x: 0, y: 0, width: W, height: H }));
  for (const p of packs) {
    const b = p.box; const cls = `s-${packClass(p)}`;
    const label = `${p.region}${p.needsReview ? ' ?' : ''}`;
    const g = s('g', {}, s('title', {}, describePack(p)));
    g.append(s('rect', { class: `box ${cls}`, x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1, rx: 4 }));
    if (!viewBox) {
      g.append(s('rect', { class: `tag ${cls}`, x: b.x1, y: b.y1 - 28 < 0 ? b.y1 : b.y1 - 28, width: 18 + label.length * 13, height: 28, rx: 4 }));
      g.append(s('text', { class: 'lbl', x: b.x1 + 8, y: (b.y1 - 28 < 0 ? b.y1 : b.y1 - 28) + 21 }, label));
    }
    svg.append(g);
  }
  return h('div', { class: 'photo' }, svg);
}
function describePack(p) {
  const r = p.reading || {};
  return `Region ${p.region}: ${r.name || '?'} ${r.strength || ''} lot ${r.lot || '?'} exp ${r.expiry || '?'} (read confidence ${r.confidence ?? '?'})`;
}
const legend = () => h('div', { class: 'legend' }, h('span', { class: 'ok' }, 'OK'), h('span', { class: 'near' }, 'Near expiry'), h('span', { class: 'exp' }, 'Expired'), h('span', { class: 'rev' }, 'Needs a human (dashed)'));

// ---- views ----
let state = { status: null, lastScan: null };

async function viewScan(root) {
  const st = state.status;
  const mode = h('select', { 'aria-label': 'Photo type' }, h('option', { value: 'shelf' }, 'Shelf photo (audit expiry)'), h('option', { value: 'delivery' }, 'Delivery carton (receive stock)'));
  const result = h('div', { 'aria-live': 'polite', 'aria-busy': 'false' });
  const run = guard(async (body) => {
    result.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Detecting packs with SAM 3.1, reading labels with Muse Spark...'));
    result.setAttribute('aria-busy', 'true');
    try {
      state.lastScan = await api('/api/scan', { mode: mode.value, ...body });
      await renderScan(result, state.lastScan);
    } catch (e) {
      result.replaceChildren(h('p', { class: 'card', role: 'alert' }, `Scan failed: ${e.message}`));
      throw e;
    } finally { result.setAttribute('aria-busy', 'false'); }
    refreshCounts();
  });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Choose a shelf or delivery photo to scan' });
  const upload = (f) => {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => run({ image: rd.result });
    rd.readAsDataURL(f);
  };
  file.addEventListener('change', () => upload(file.files[0]));
  const drop = h('div', { class: 'dropzone' }, 'Drop a shelf or delivery photo here, or ', file);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); });
  const samples = st.samples.map((f) => h('button', { onclick: () => { mode.value = f.startsWith('delivery') ? 'delivery' : 'shelf'; run({ sample: f }); } }, `Use sample ${f}`));
  root.append(
    h('div', { class: 'card' },
      h('h2', {}, 'Scan a photo'),
      h('div', { class: 'row' }, mode, ...samples),
      h('p', { class: 'small muted' }, st.provider === 'meta'
        ? 'Live mode: photos are sent to the Meta Model API (sam-3.1 on /responses, muse-spark-1.3 on /chat/completions).'
        : st.provider === 'baseten'
        ? `Backup live mode: ${st.model} on Baseten reads the packs. Pack boxes: ${st.detector}.`
        : 'Offline replay mode (default): results for the bundled synthetic photos are replayed from recorded sidecar files. No API key or network needed. Uploading a copy of a sample photo works; other photos need live mode.'),
      drop),
    result);
  if (state.lastScan) await renderScan(result, state.lastScan);
}

async function renderScan(root, r) {
  const sm = r.summary;
  const line = (label, items, fmt) => h('li', {}, h('b', {}, `${label}: `), items.length ? items.map(fmt).join(', ') : 'none');
  const lotFmt = (l) => `${l.sku} lot ${l.lot}${l.count > 1 ? ` x${l.count}` : ''}`;
  const facts = r.mode === 'delivery'
    ? [line('To receive', sm.toReceive, lotFmt), line('Flagged, not received (expired or near expiry)', sm.flagged, (l) => `${l.sku} lot ${l.lot} exp ${l.expiry}`)]
    : [line('Pull now (expired)', sm.pull, lotFmt), line('Near expiry', sm.nearExpiry, (l) => `${l.sku} lot ${l.lot} (${l.expiry})`), line('Lots not in system', sm.unknownLots, lotFmt)];
  const table = h('table', {}, h('thead', {}, h('tr', {}, ...['#', 'Read from label', 'Lot', 'Expiry', 'Status'].map((t) => h('th', {}, t)))),
    h('tbody', {}, r.packs.map((p) => h('tr', {},
      h('td', {}, p.region),
      h('td', {}, `${p.reading.name || '?'} ${p.reading.strength || ''}${p.reading.pack_size ? ` x${p.reading.pack_size}` : ''}`),
      h('td', {}, p.reading.lot || '?'),
      h('td', {}, p.reading.expiry || '?'),
      h('td', {}, p.needsReview ? badge('review', `Review ${p.reviewId ?? ''}`) : badge(p.expiryStatus))))));
  root.replaceChildren(h('div', { class: 'grid' },
    h('div', { class: 'card' }, h('h2', {}, `${r.packs.length} packs detected`), await overlay(r.image, r.packs), legend(),
      h('p', { class: 'small muted' }, `${r.label} · provider ${r.provider}${r.provider === 'baseten' ? ` · pack boxes: ${r.detector}` : ''} · as of ${r.asOf}`)),
    h('div', { class: 'card' },
      h('h2', {}, r.mode === 'delivery' ? 'Delivery intake' : 'Shelf audit'),
      h('ul', {}, facts, h('li', {}, h('b', {}, 'Sent to review queue: '), `${sm.review} unclear pack(s)`)),
      r.changeSet
        ? h('p', {}, 'Proposed ', h('b', {}, r.changeSet.id), ` (${r.changeSet.changes.length} change(s)). Nothing changes until a pharmacist approves it. `, h('a', { href: '#approve' }, 'Go to approvals'))
        : h('p', { class: 'muted' }, 'No stock changes proposed.'),
      sm.review ? h('p', {}, h('a', { href: '#review' }, 'Open the review queue')) : null,
      table)));
}

async function viewReview(root) {
  const [items, catalog] = await Promise.all([api('/api/review'), api('/api/catalog')]);
  const open = items.filter((i) => i.status === 'open');
  const done = items.filter((i) => i.status !== 'open');
  const buttons = [];
  const sync = () => buttons.forEach((b) => { b.disabled = getName().length < 2; });
  root.append(h('div', { class: 'card' },
    h('h2', {}, `Review queue: ${open.length} open`),
    h('p', { class: 'small muted' }, 'These packs could not be read or matched with confidence, so the agent did not guess. Look at the pack and record what is printed on it, or set it aside. Nothing is pre-selected and no other product is ever suggested.'),
    nameField(sync)));
  if (!open.length) root.append(h('p', { class: 'empty' }, 'Nothing waiting for review. Scan a photo to fill the queue.'));
  for (const it of open) {
    const sku = h('select', { 'aria-label': 'Catalog item printed on the pack' }, h('option', { value: '' }, '- choose what is printed on the pack -'),
      catalog.map((c) => h('option', { value: c.sku }, `${c.name} ${c.strength} x${c.pack_size} (${c.sku})`)));
    const lot = h('input', { type: 'text', placeholder: 'as printed', size: 10, 'aria-label': 'Lot' });
    const exp = h('input', { type: 'text', placeholder: 'MM/YYYY', size: 8, 'aria-label': 'Expiry' });
    const note = h('input', { type: 'text', placeholder: 'optional note', size: 18, 'aria-label': 'Note' });
    const idBtn = h('button', { class: 'primary', onclick: guard(async () => {
      const r = await api(`/api/review/${it.id}/resolve`, { action: 'identify', by: getName(), sku: sku.value, lot: lot.value, expiry: exp.value });
      toast(`${it.id} resolved by ${r.review.resolvedBy}${r.changeSet ? `; proposed ${r.changeSet.id} for approval` : '; no stock change needed'}`);
      route();
    }) }, 'Record as identified');
    const asideBtn = h('button', { onclick: guard(async () => {
      await api(`/api/review/${it.id}/resolve`, { action: 'set_aside', by: getName(), note: note.value });
      toast(`${it.id} set aside`); route();
    }) }, 'Set aside (count by hand)');
    buttons.push(idBtn, asideBtn);
    const r = it.reading || {};
    const pad = 20;
    const vb = [it.box.x1 - pad, it.box.y1 - pad, it.box.x2 - it.box.x1 + 2 * pad, it.box.y2 - it.box.y1 + 2 * pad];
    root.append(h('div', { class: 'card row', style: 'align-items:flex-start' },
      h('div', { class: 'crop' }, await overlay(it.image, [{ ...it, needsReview: true }], vb).catch(() => h('p', { class: 'muted' }, 'image unavailable'))),
      h('div', { style: 'flex:1;min-width:280px' },
        h('h3', { style: 'margin-top:0' }, `${it.id} `, badge('open'), h('span', { class: 'muted small' }, ` from ${it.source} photo, region ${it.region}`)),
        h('div', { class: 'small' }, `Model read: "${r.name || '?'}" ${r.strength || ''} ${r.pack_size ? `x${r.pack_size}` : ''} · lot "${r.lot || '?'}" · exp "${r.expiry || '?'}" · confidence ${r.confidence ?? '?'}`),
        h('ul', { class: 'reasons small' }, it.reasons.map((x) => h('li', {}, x))),
        h('div', { class: 'row' }, h('label', {}, 'Item', sku), h('label', {}, 'Lot', lot), h('label', {}, 'Expiry', exp), idBtn),
        h('div', { class: 'row', style: 'margin-top:8px' }, note, asideBtn))));
  }
  sync();
  if (done.length) {
    root.append(h('div', { class: 'card' }, h('h2', {}, 'Resolved'), h('table', {},
      h('thead', {}, h('tr', {}, ...['Item', 'Outcome', 'By', 'When'].map((t) => h('th', {}, t)))),
      h('tbody', {}, done.map((d) => h('tr', {},
        h('td', {}, d.id),
        h('td', {}, d.resolution.action === 'identify' ? `${d.resolution.sku} lot ${d.resolution.lot} exp ${d.resolution.expiry}${d.resolution.changeSet ? ` → ${d.resolution.changeSet}` : ''}` : `set aside${d.resolution.note ? `: ${d.resolution.note}` : ''}`),
        h('td', {}, d.resolvedBy), h('td', {}, fmtTime(d.resolvedAt))))))));
  }
}

const CHANGE_TEXT = { receive: (c) => `Receive ${c.qty} x ${c.sku} lot ${c.lot} (exp ${c.expiry})`, quarantine: (c) => `Quarantine ${c.sku} lot ${c.lot} (${c.reason})`, set_count: (c) => `Set ${c.sku} lot ${c.lot} to ${c.qty}` };

async function viewApprove(root) {
  const [sets, log] = await Promise.all([api('/api/changesets'), api('/api/audit')]);
  const waiting = sets.filter((c) => c.status === 'awaiting_pharmacist_approval');
  const buttons = [];
  const sync = () => buttons.forEach((b) => { b.disabled = getName().length < 2; });
  root.append(h('div', { class: 'card' },
    h('h2', {}, `Waiting for pharmacist approval: ${waiting.length}`),
    h('p', { class: 'small muted' }, 'Stock only changes when a named pharmacist approves a change set. Every decision goes in the audit log.'),
    nameField(sync)));
  if (!waiting.length) root.append(h('p', { class: 'empty' }, 'Nothing waiting. Scan a photo or resolve a review item to propose changes.'));
  for (const c of waiting) {
    const reason = h('input', { type: 'text', placeholder: 'reason (optional)', size: 20, 'aria-label': `Reason for rejecting ${c.id} (optional)` });
    const ok = h('button', { class: 'primary', onclick: guard(async () => { const r = await api(`/api/changesets/${c.id}/approve`, { by: getName() }); toast(`${r.id} approved by ${r.approvedBy}; stock updated`); route(); }) }, `Approve as ${getName() || '...'}`);
    const no = h('button', { class: 'danger', onclick: guard(async () => { await api(`/api/changesets/${c.id}/reject`, { by: getName(), reason: reason.value }); toast(`${c.id} rejected`); route(); }) }, 'Reject');
    buttons.push(ok, no);
    root.append(h('div', { class: 'card' },
      h('h3', { style: 'margin-top:0' }, `${c.id} · ${c.kind.replaceAll('_', ' ')} `, badge(c.status, 'awaiting approval')),
      h('div', { class: 'small muted' }, `from ${c.source} · proposed ${fmtTime(c.createdAt)}`),
      h('ul', {}, c.changes.map((x) => h('li', {}, (CHANGE_TEXT[x.op] ?? JSON.stringify)(x)))),
      h('div', { class: 'row' }, ok, reason, no)));
  }
  const nameInput = root.querySelector('input');
  nameInput.addEventListener('input', () => buttons.filter((b) => b.classList.contains('primary')).forEach((b) => { b.textContent = `Approve as ${getName() || '...'}`; }));
  sync();
  const decided = sets.filter((c) => c.status !== 'awaiting_pharmacist_approval');
  if (decided.length || log.length) {
    root.append(h('div', { class: 'card' }, h('h2', {}, 'Audit log'), h('table', {},
      h('thead', {}, h('tr', {}, ...['When', 'Item', 'Action', 'Pharmacist', 'Changes'].map((t) => h('th', {}, t)))),
      h('tbody', {}, [...log].reverse().map((e) => h('tr', {}, h('td', {}, fmtTime(e.at)), h('td', {}, e.id), h('td', {}, e.kind.replaceAll('_', ' ')), h('td', {}, e.approver), h('td', {}, e.changes)))))));
  }
}

async function viewInventory(root) {
  const inv = await api('/api/inventory');
  const onlyFlags = h('input', { type: 'checkbox' });
  const tbody = h('tbody');
  const fill = () => tbody.replaceChildren(...inv.lots.filter((l) => !onlyFlags.checked || l.status !== 'ok').map((l) => h('tr', { class: `flag-${l.status}` },
    h('td', {}, `${l.name} ${l.strength} x${l.pack_size}`), h('td', {}, l.sku), h('td', {}, l.lot), h('td', {}, l.expiry),
    h('td', {}, l.days < 0 ? `${-l.days} days ago` : `in ${l.days} days`), h('td', {}, badge(l.status)),
    h('td', {}, l.qty), h('td', {}, l.quarantined || ''))));
  onlyFlags.addEventListener('change', fill); fill();
  const ex = inv.expiry;
  root.append(
    h('div', { class: 'card' }, h('h2', {}, `Inventory · ${inv.pharmacy}`),
      h('p', {}, badge(ex.expired.length ? 'expired' : 'unknown', `${ex.expired.length} expired lot(s) in sellable stock`), ' ', badge(ex.nearExpiry.length ? 'near_expiry' : 'unknown', `${ex.nearExpiry.length} near expiry (≤ ${inv.nearDays} days)`), h('span', { class: 'muted small' }, `  as of ${inv.asOf}. Printed MM/YYYY means the end of that month.`)),
      h('label', { style: 'flex-direction:row;align-items:center;gap:6px' }, onlyFlags, 'Show only flagged lots'),
      h('table', {}, h('thead', {}, h('tr', {}, ...['Item', 'SKU', 'Lot', 'Expiry', 'Days', 'Flag', 'Sellable packs', 'Quarantined'].map((t) => h('th', {}, t)))), tbody)),
    h('div', { class: 'card' }, h('h2', {}, 'Stock levels'), h('table', {},
      h('thead', {}, h('tr', {}, ...['Item', 'Usable (excl. expired)', 'Reorder at', 'Par'].map((t) => h('th', {}, t)))),
      h('tbody', {}, inv.items.map((i) => h('tr', {}, h('td', {}, `${i.name} ${i.strength} x${i.pack_size}`), h('td', {}, i.usable, ' ', i.low ? badge('near_expiry', 'low') : ''), h('td', {}, i.reorderPoint), h('td', {}, i.parLevel)))))),
    askCard());
}

function askCard() {
  const q = h('input', { type: 'text', placeholder: 'How many Paracetamol packs do we have?', size: 40, 'aria-label': 'Stock question' });
  const out = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
  const go = guard(async () => { const r = await api('/api/ask', { question: q.value }); out.textContent = r.answer; out.style.color = r.refused ? 'var(--exp)' : ''; });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'card' }, h('h2', {}, 'Stock question'), h('p', { class: 'small muted' }, 'Stock counts only. Clinical and substitution questions are refused.'), h('div', { class: 'row' }, q, h('button', { onclick: go }, 'Ask')), out);
}

async function viewRestock(root) {
  const d = await api('/api/restock');
  const download = () => { const a = h('a', { href: URL.createObjectURL(new Blob([d.text], { type: 'text/plain' })), download: `restock-draft-${d.asOf}.txt` }); a.click(); URL.revokeObjectURL(a.href); };
  root.append(h('div', { class: 'card' },
    h('h2', {}, 'Restock order draft'),
    h('p', {}, badge('awaiting_pharmacist_approval', 'DRAFT'), ' Nothing is sent. The pharmacist signs and places the order themselves. Expired stock does not count toward stock on hand.'),
    d.lines.length ? null : h('p', { class: 'empty' }, 'No items are at or below their reorder point.'),
    Object.entries(d.bySupplier).map(([sup, lines]) => h('div', {}, h('h3', {}, `To: ${sup}`), h('table', {},
      h('thead', {}, h('tr', {}, ...['Item', 'Order (packs)', 'On hand', 'Of which near expiry', 'Reorder at', 'Par'].map((t) => h('th', {}, t)))),
      h('tbody', {}, lines.map((l) => h('tr', {}, h('td', {}, `${l.name} ${l.strength} x${l.pack_size}`), h('td', {}, h('b', {}, l.orderQty)), h('td', {}, l.onHand), h('td', {}, l.nearExpiryQty || ''), h('td', {}, l.reorderPoint), h('td', {}, l.parLevel))))))),
    h('h3', {}, 'Printable draft'), h('pre', { class: 'draft' }, d.text),
    h('button', { onclick: download }, 'Download draft (.txt)')));
}

// ---- agent run: the model chooses the steps, the pharmacist still approves ----
const TOOL_LABEL = { shelf_audit: 'Shelf audit', delivery_intake: 'Delivery intake', expiry_flags: 'Expiry flags', restock_draft: 'Restock draft', request_human_review: 'Hand to pharmacist' };
async function viewAgent(root) {
  const st = state.status;
  const goal = h('textarea', { rows: 2, maxlength: 500, 'aria-label': 'What should the agent do?', placeholder: 'e.g. Morning check: audit the shelf, receive the delivery and draft the reorder' });
  goal.value = state.agentGoal ?? 'Morning check: audit the shelf, receive the delivery and draft the reorder';
  const picks = st.samples.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => {
    const box = h('input', { type: 'checkbox', value: f, checked: true });
    return { f, box, el: h('label', { class: 'check' }, box, ` ${f}`) };
  });
  const file = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Add your own photos for the agent' });
  const steps = h('select', { 'aria-label': 'Maximum agent steps' }, ...[3, 4, 6, 8, 10].map((n) => h('option', { value: n, selected: n === 6 }, `max ${n} steps`)));
  const out = h('div', { 'aria-live': 'polite', 'aria-busy': 'false' });
  const readFile = (f) => new Promise((ok, fail) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = () => fail(new Error('Could not read the photo')); rd.readAsDataURL(f); });
  const go = guard(async () => {
    state.agentGoal = goal.value;
    out.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'The agent is choosing and running steps...'));
    out.setAttribute('aria-busy', 'true');
    try {
      const images = await Promise.all([...file.files].map(readFile));
      state.lastAgent = await api('/api/agent', { goal: goal.value, samples: picks.filter((p) => p.box.checked).map((p) => p.f), images, maxSteps: Number(steps.value) });
      renderAgent(out, state.lastAgent);
    } catch (e) {
      out.replaceChildren(h('p', { class: 'card', role: 'alert' }, `Agent run failed: ${e.message}`));
      throw e;
    } finally { out.setAttribute('aria-busy', 'false'); }
    refreshCounts();
  });
  root.append(
    h('div', { class: 'card' },
      h('h2', {}, 'Agent run'),
      h('p', {}, 'Say what you need. The agent picks its own steps from five tools (shelf audit, delivery intake, expiry flags, restock draft, hand to pharmacist), one at a time, up to the step limit. It can only propose stock changes; you approve them on the Approvals page.'),
      goal,
      h('div', { class: 'row' }, ...picks.map((p) => p.el), file, steps, h('button', { class: 'primary', onclick: go }, 'Run agent')),
      h('p', { class: 'small muted' }, st.planner?.startsWith('meta')
        ? `Live mode: ${st.planner} chooses each step through tool calling on the Meta Model API.`
        : st.planner?.startsWith('baseten')
        ? `Backup live mode: ${st.planner} (open-weights Muse Spark Open) chooses each step through tool calling on Baseten.`
        : 'Offline mode (default): a deterministic mock planner simulates the model\u2019s tool choices from your request and the photo names, so the demo runs without a key. It is not a model.')),
    out);
  if (state.lastAgent) renderAgent(out, state.lastAgent);
}

function renderAgent(root, r) {
  if (r.refused) { root.replaceChildren(h('div', { class: 'card', role: 'alert' }, h('p', {}, r.answer))); return; }
  const outcome = (s) => {
    if (!s.ok) return `Error: ${s.error}`;
    const x = s.result;
    if (x.proposed_change_set || x.packs_detected !== undefined) {
      return [`${x.packs_detected} packs.`, x.proposed_change_set ? ` Proposed ${x.proposed_change_set.id}, awaiting approval.` : ' No change proposed.', x.sent_to_review_queue.length ? ` Review queue: ${x.sent_to_review_queue.join(', ')}.` : ''].join('');
    }
    if (s.tool === 'expiry_flags') return `${x.expired.length} expired, ${x.near_expiry.length} near expiry.`;
    if (s.tool === 'restock_draft') return `${x.lines.length} draft line(s). Nothing sent.`;
    if (s.tool === 'request_human_review') return `Note for you: ${x.note}`;
    return 'Done.';
  };
  const args = (a) => (a && Object.keys(a).length ? ` (${Object.values(a).join(', ')})` : '');
  root.replaceChildren(h('div', { class: 'card' },
    h('h3', {}, `Steps chosen by ${r.planner === 'mock' ? 'the offline mock planner' : r.planner} (${r.steps.length} of max ${r.maxSteps})`),
    h('ol', { class: 'trace' }, ...r.steps.map((s) => h('li', { class: s.ok ? '' : 'err' }, h('b', {}, TOOL_LABEL[s.tool] ?? s.tool), args(s.args), ': ', outcome(s)))),
    h('p', {}, h('b', {}, 'Stopped: '), r.stoppedReason.replaceAll('_', ' ')),
    r.answer ? h('p', {}, h('b', {}, 'Agent: '), r.answer) : null,
    r.handoff ? h('p', { role: 'note' }, h('b', {}, 'Handed to you: '), r.handoff.note) : null,
    h('p', {}, r.pendingApproval
      ? ['Nothing in stock changed yet. ', h('a', { href: '#approve' }, `Review and approve ${r.changeSets.map((c) => c.id).join(', ')}`)]
      : 'No stock changes proposed.'),
    r.reviews.length ? h('p', {}, h('a', { href: '#review' }, `Open the review queue (${r.reviews.length} unclear pack(s))`)) : null,
    r.restockDraft ? h('p', {}, h('a', { href: '#restock' }, 'Open the restock draft')) : null));
}

// ---- shell ----
const VIEWS = { agent: viewAgent, scan: viewScan, review: viewReview, approve: viewApprove, inventory: viewInventory, restock: viewRestock };

async function refreshCounts() {
  const [rv, cs] = await Promise.all([api('/api/review'), api('/api/changesets')]);
  $('#n-review').textContent = rv.filter((r) => r.status === 'open').length || '';
  $('#n-approve').textContent = cs.filter((c) => c.status === 'awaiting_pharmacist_approval').length || '';
}

async function route(focusView = false) {
  const name = (location.hash.slice(1) || 'scan');
  const view = VIEWS[name] ?? viewScan;
  document.querySelectorAll('nav a').forEach((a) => {
    const on = a.getAttribute('href') === `#${name}`;
    a.classList.toggle('active', on);
    if (on) { a.setAttribute('aria-current', 'page'); document.title = `${a.textContent.replace(/\s*\d+\s*$/, '').replace(/^\d+ · /, '').trim()} · Pharmacy Stock Agent`; } else a.removeAttribute('aria-current');
  });
  const root = h('div');
  try { await view(root); } catch (e) { root.append(h('p', { class: 'card' }, `Error: ${e.message}`)); }
  $('#view').replaceChildren(root);
  // Move keyboard and screen-reader focus to the new view after in-app navigation.
  if (focusView) $('#view').focus({ preventScroll: false });
  refreshCounts().catch(() => {});
}

async function init() {
  state.status = await api('/api/status');
  const st = state.status;
  $('#status').replaceChildren(
    h('div', {}, 'Provider: ', h('b', {}, st.provider === 'meta' ? 'Meta Model API (live)' : st.provider === 'baseten' ? 'Baseten Muse Spark Open (live backup)' : 'offline replay')),
    h('div', {}, 'As of ', h('b', {}, st.asOf), ` · ${st.pharmacy}`));
  $('#reset').addEventListener('click', guard(async () => {
    if (!confirm('Reset stock, review queue, approvals and audit log to the synthetic seed?')) return;
    await api('/api/reset', {}); state.lastScan = null; toast('Demo data reset'); location.hash = '#scan'; route();
  }));
  window.addEventListener('hashchange', () => route(true));
  route();
}
init().catch((e) => toast(e.message, true));

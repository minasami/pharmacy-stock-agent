// Static accessibility checks for the no-build web UI (no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('web/index.html', 'utf8');
const js = readFileSync('web/app.js', 'utf8');
const css = readFileSync('web/style.css', 'utf8');

test('a11y: page landmarks, skip link, live regions and focus handling are present', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<a class="skip" href="#view">Skip to main content<\/a>/);
  assert.match(html, /<nav aria-label="[^"]+">/);
  assert.match(html, /<main id="view" tabindex="-1"/);
  assert.match(html, /id="toast" role="status" aria-live="polite"/);
  assert.match(js, /setAttribute\('aria-current', 'page'\)/);
  assert.match(js, /\$\('#view'\)\.focus/);
  assert.match(js, /role', err \? 'alert' : 'status'/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test('a11y: every text input and select created in the UI has a label', () => {
  // Inputs are either wrapped in a <label> by h('label', ..., input) or carry aria-label.
  const created = js.match(/h\('(input|select)', \{[^}]*\}/g) ?? [];
  assert.ok(created.length >= 6);
  for (const el of created) {
    if (/type: 'checkbox'/.test(el)) continue; // wrapped in a visible <label>
    assert.match(el, /'aria-label'/, `missing aria-label: ${el}`);
  }
});

test('a11y: status colours keep white badge text at WCAG AA contrast (>= 4.5:1)', () => {
  const lum = (hex) => {
    const c = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const name of ['ok', 'near', 'exp', 'rev', 'muted']) {
    const hex = css.match(new RegExp(`--${name}:(#[0-9a-f]{6})`, 'i'))[1];
    const ratio = (1 + 0.05) / (lum(hex) + 0.05);
    assert.ok(ratio >= 4.5, `--${name} ${hex} contrast ${ratio.toFixed(2)}`);
  }
});

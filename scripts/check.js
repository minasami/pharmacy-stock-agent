// "Build" check for a no-build project: syntax-check every JS file (server and
// browser), parse the JSON data files, and make sure the UI references resolve.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
['src', 'web', 'scripts', 'tests', 'data', 'samples'].forEach(walk);
let n = 0;
for (const f of files) {
  if (f.endsWith('.js')) { execFileSync(process.execPath, ['--check', f]); n++; }
  if (f.endsWith('.json')) { JSON.parse(readFileSync(f, 'utf8')); n++; }
}
const html = readFileSync('web/index.html', 'utf8');
for (const ref of ['/app.js', '/style.css']) if (!html.includes(ref)) throw new Error(`index.html missing ${ref}`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.devDependencies ?? {}).length) throw new Error('Expected zero npm dependencies');
console.log(`check ok: ${n} files (JS syntax + JSON), 0 npm dependencies`);

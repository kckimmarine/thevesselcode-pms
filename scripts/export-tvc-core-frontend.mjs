#!/usr/bin/env node
/** Write docs/exports/tvc-core-frontend.txt (index + js/core, ui, services). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/exports/tvc-core-frontend.txt');
const targets = ['index.html', 'js/core', 'js/ui', 'js/services'];

let out = '';
function walk(p) {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
        fs.readdirSync(p).forEach((f) => walk(path.join(p, f)));
    } else if (p.endsWith('.js') || p.endsWith('.html')) {
        const rel = path.relative(ROOT, p).replace(/\\/g, '/');
        out += `=== FILE: ${rel} ===\n${fs.readFileSync(p, 'utf8')}\n=== END FILE ===\n\n`;
    }
}
targets.forEach((t) => walk(path.join(ROOT, t)));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');
console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);

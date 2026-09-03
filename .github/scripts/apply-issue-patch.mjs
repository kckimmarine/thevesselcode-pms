#!/usr/bin/env node
/**
 * Parse GitHub Issue body and write files.
 *
 * Expected format (Gemini-friendly):
 *
 *   ### `js/services/inventory.js`
 *   ```javascript
 *   // full file contents
 *   ```
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const root = process.cwd();
const body = process.env.ISSUE_BODY || '';

const BLOCK_RE = /###\s+`([^`]+)`\s*\r?\n```[\w.-]*\r?\n([\s\S]*?)```/g;

const DENY = [
    /^deploy\/\.env/i,
    /\.env(\.|$)/i,
    /electron\/keys\//i,
    /^\.github\/workflows\//i,
    /^\.git(\/|$)/i,
];

function normalizeRel(rel) {
    return path.normalize(String(rel || '').trim()).replace(/\\/g, '/');
}

function isAllowed(rel) {
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    return !DENY.some((rule) => rule.test(rel));
}

let count = 0;
for (const match of body.matchAll(BLOCK_RE)) {
    const rel = normalizeRel(match[1]);
    const content = `${match[2].replace(/\s+$/, '')}\n`;
    if (!isAllowed(rel)) {
        console.warn(`SKIP denied path: ${rel}`);
        continue;
    }
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    console.log(`WROTE ${rel}`);
    count += 1;
}

if (count === 0) {
    console.error('No patch blocks found.');
    console.error('Use headings like ### `path/to/file.ext` followed by a fenced code block.');
    process.exit(1);
}

console.log(`Applied ${count} file(s).`);

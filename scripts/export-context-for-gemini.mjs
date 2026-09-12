#!/usr/bin/env node
/**
 * Export core TVC-PMS sources into one text bundle for Gemini / external review.
 *
 * Usage:
 *   node scripts/export-context-for-gemini.mjs
 *   npm run export:gemini-context   (if wired in package.json)
 *
 * Output: gemini-full-context.txt (repository root)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'gemini-full-context.txt');

const EXCLUDE_DIR_NAMES = new Set([
    'node_modules',
    '.git',
    'vendor',
    'dist',
    'out',
    'release',
    'playwright-report',
    'test-results',
]);

const EXCLUDE_FILE_PATTERNS = [
    /^public\/data\/impa/i,
    /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|webm|zip|xlsx|xls|db|sqlite)$/i,
    /gemini-full-context\.txt$/,
];

function shouldSkipDir(rel) {
    const parts = rel.split(path.sep).filter(Boolean);
    return parts.some((p) => EXCLUDE_DIR_NAMES.has(p));
}

function shouldIncludeFile(relPosix) {
    if (EXCLUDE_FILE_PATTERNS.some((re) => re.test(relPosix))) return false;

    if (relPosix === 'index.html') return true;
    if (relPosix === 'css/app.css') return true;
    if (relPosix.startsWith('js/') && relPosix.endsWith('.js')) return true;
    if (relPosix.startsWith('api/') && relPosix.endsWith('.js')) return true;

    return false;
}

function walkFiles(dir, baseRel, out) {
    if (shouldSkipDir(baseRel)) return;
    for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const rel = path.posix.join(baseRel.replace(/\\/g, '/'), name);
        const st = fs.statSync(abs);
        if (st.isDirectory()) {
            walkFiles(abs, rel, out);
            continue;
        }
        if (!shouldIncludeFile(rel)) continue;
        out.push({ rel, abs });
    }
}

function main() {
    const files = [];
    walkFiles(ROOT, '', files);
    files.sort((a, b) => a.rel.localeCompare(b.rel));

    const parts = [];
    parts.push(`# TVC-PMS full context export`);
    parts.push(`# Generated: ${new Date().toISOString()}`);
    parts.push(`# Files: ${files.length}`);
    parts.push('');

    for (const { rel, abs } of files) {
        let content;
        try {
            content = fs.readFileSync(abs, 'utf8');
        } catch (e) {
            content = `/* ERROR reading file: ${e.message} */\n`;
        }
        parts.push(`=== FILE: ${rel} ===`);
        parts.push(content);
        if (!content.endsWith('\n')) parts.push('');
        parts.push('=== END FILE ===');
        parts.push('');
    }

    fs.writeFileSync(OUT_FILE, parts.join('\n'), 'utf8');
    const sizeMb = (fs.statSync(OUT_FILE).size / (1024 * 1024)).toFixed(2);
    console.log(`Wrote ${OUT_FILE} (${files.length} files, ${sizeMb} MB)`);
}

main();

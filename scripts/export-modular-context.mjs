#!/usr/bin/env node
/**
 * Modular codebase export for Gemini (Superintendent) audit.
 *
 * Default (3 sections per TVC spec):
 *   context-1-frontend.txt, context-2-backend.txt, context-3-views-shell.txt
 *
 * Lightweight chat upload (--split):
 *   context-1-frontend-shell.txt, context-2-frontend-app.txt,
 *   context-3-frontend-spare.txt, context-4-frontend-ui-services.txt,
 *   context-5-backend.txt, context-6-views-shell.txt
 *
 * Usage:
 *   node scripts/export-modular-context.mjs
 *   node scripts/export-modular-context.mjs --split
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLIT = process.argv.includes('--split');

const EXCLUDE_DIR_NAMES = new Set(['node_modules', '.git', 'vendor', 'dist', 'out', 'release']);
const EXCLUDE_FILE_BASENAMES = new Set(['package-lock.json', 'impa-full.json']);
const EXCLUDE_EXT = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
    '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.zip',
    '.xlsx', '.xls', '.db', '.sqlite',
]);

function relPosix(abs) {
    return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function shouldSkipDir(relPosix) {
    return relPosix.split('/').some((p) => EXCLUDE_DIR_NAMES.has(p));
}

function shouldSkipFile(relPosix) {
    const base = path.posix.basename(relPosix);
    if (EXCLUDE_FILE_BASENAMES.has(base)) return true;
    const ext = path.posix.extname(relPosix).toLowerCase();
    if (EXCLUDE_EXT.has(ext)) return true;
    if (/\/chapters\/.*\.json$/i.test(relPosix)) return true;
    if (/\/impa-full\.json$/i.test(relPosix)) return true;
    return false;
}

function walk(dir, out) {
    const relDir = relPosix(dir);
    if (shouldSkipDir(relDir)) return;
    for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const rel = relPosix(abs);
        const st = fs.statSync(abs);
        if (st.isDirectory()) walk(abs, out);
        else if (!shouldSkipFile(rel)) out.add(abs);
    }
}

function collectDir(relDir) {
    const out = new Set();
    const abs = path.join(ROOT, relDir);
    if (fs.existsSync(abs)) walk(abs, out);
    return [...out];
}

function collectSql(dirRel) {
    const absDir = path.join(ROOT, dirRel);
    if (!fs.existsSync(absDir)) return [];
    return fs.readdirSync(absDir)
        .filter((n) => n.endsWith('.sql'))
        .map((n) => path.join(absDir, n));
}

function jsRootFiles() {
    const dir = path.join(ROOT, 'js');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join(dir, f));
}

function buildSection(files) {
    const sorted = [...files].sort((a, b) => relPosix(a).localeCompare(relPosix(b)));
    const parts = [];
    for (const abs of sorted) {
        const rel = relPosix(abs);
        let content;
        try { content = fs.readFileSync(abs, 'utf8'); }
        catch (e) { content = `/* ERROR: ${e.message} */\n`; }
        parts.push(`=== FILE: ${rel} ===`);
        parts.push(content);
        if (!content.endsWith('\n')) parts.push('');
        parts.push('=== END FILE ===');
        parts.push('');
    }
    return parts.join('\n');
}

function writeOut(filename, files) {
    const outPath = path.join(ROOT, filename);
    const body = buildSection(files);
    fs.writeFileSync(outPath, body, 'utf8');
    const bytes = fs.statSync(outPath).size;
    const lines = body.split('\n').length;
    const kb = (bytes / 1024).toFixed(1);
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const sizeLabel = bytes >= 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
    return { filename, outPath, bytes, lines, fileCount: files.length, sizeLabel };
}

function toolkitFiles() {
    const list = [];
    const a = path.join(ROOT, 'toolkit.html');
    const b = path.join(ROOT, 'public/toolkit.html');
    if (fs.existsSync(a)) list.push(a);
    if (fs.existsSync(b)) list.push(b);
    return list;
}

function sectionFrontendMonolith() {
    const list = [path.join(ROOT, 'index.html')];
    list.push(...collectDir('js/core'));
    list.push(...collectDir('js/ui'));
    list.push(...collectDir('js/services'));
    list.push(...jsRootFiles());
    return [...new Set(list)];
}

function sectionBackend() {
    const list = [...collectDir('api')];
    list.push(...collectSql('deploy'));
    list.push(...collectSql('database'));
    return [...new Set(list)];
}

function sectionViewsShell() {
    const list = [...collectDir('css'), ...collectDir('electron'), ...collectDir('home'), ...toolkitFiles()];
    return [...new Set(list)];
}

function sectionFrontendShell() {
    const list = [path.join(ROOT, 'index.html'), ...collectDir('js/core')];
    for (const f of jsRootFiles()) {
        if (path.basename(f) !== 'app.js') list.push(f);
    }
    return [...new Set(list)];
}

function sectionFrontendApp() {
    return [path.join(ROOT, 'js/app.js')].filter((f) => fs.existsSync(f));
}

function sectionFrontendSpare() {
    const p = path.join(ROOT, 'js/ui/spareMenu.js');
    return fs.existsSync(p) ? [p] : [];
}

function sectionFrontendUiServices() {
    const ui = collectDir('js/ui').filter((f) => path.basename(f) !== 'spareMenu.js');
    const svc = collectDir('js/services');
    return [...new Set([...ui, ...svc])];
}

function main() {
    console.log(`# TVC modular context export${SPLIT ? ' (split / Gemini chat)' : ' (3 sections)'}\n`);

    const results = [];
    if (SPLIT) {
        results.push(writeOut('context-1-frontend-shell.txt', sectionFrontendShell()));
        results.push(writeOut('context-2-frontend-app.txt', sectionFrontendApp()));
        results.push(writeOut('context-3-frontend-spare.txt', sectionFrontendSpare()));
        results.push(writeOut('context-4-frontend-ui-services.txt', sectionFrontendUiServices()));
        results.push(writeOut('context-5-backend.txt', sectionBackend()));
        results.push(writeOut('context-6-views-shell.txt', sectionViewsShell()));
    } else {
        results.push(writeOut('context-1-frontend.txt', sectionFrontendMonolith()));
        results.push(writeOut('context-2-backend.txt', sectionBackend()));
        results.push(writeOut('context-3-views-shell.txt', sectionViewsShell()));
    }

    for (const r of results) {
        console.log(r.filename);
        console.log(`  files: ${r.fileCount}`);
        console.log(`  bytes: ${r.bytes} (${r.sizeLabel})`);
        console.log(`  lines: ${r.lines}`);
        console.log(`  path:  ${r.outPath}`);
        console.log('');
    }
}

main();

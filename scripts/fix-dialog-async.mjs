import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = [
    'js/app.js',
    'js/ui/defectReport.js',
    'js/ui/spareMenu.js',
    'js/ui/runHours.js',
    'js/auth.js',
    'js/services/masterBackup.js',
];

function findFunctionStarts(src) {
    const starts = [];
    const re = /\b(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
        starts.push({ index: m.index, async: !!m[1], name: m[2] });
    }
    return starts;
}

function functionBodyEnd(src, openBrace) {
    let depth = 0;
    for (let i = openBrace; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return src.length - 1;
}

function patchFile(rel) {
    const full = path.join(ROOT, rel);
    let src = fs.readFileSync(full, 'utf8');
    const starts = findFunctionStarts(src);
    let offset = 0;
    let patched = src;
    const inserts = [];

    for (const fn of starts) {
        const brace = patched.indexOf('{', fn.index);
        if (brace < 0) continue;
        const end = functionBodyEnd(patched, brace);
        const body = patched.slice(brace, end + 1);
        if (!body.includes('await TVC_Dialog.')) continue;
        if (fn.async) continue;
        inserts.push(fn.index);
    }

    // apply from end to start
    inserts.sort((a, b) => b - a);
    for (const idx of inserts) {
        patched = patched.slice(0, idx) + 'async ' + patched.slice(idx);
    }

    fs.writeFileSync(full, patched, 'utf8');
    console.log('async patched', rel, inserts.length);
}

for (const f of FILES) patchFile(f);

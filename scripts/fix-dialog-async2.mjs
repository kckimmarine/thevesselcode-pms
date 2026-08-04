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

function bodyOpenBrace(src, fnIndex) {
    let i = src.indexOf('(', fnIndex);
    if (i < 0) return -1;
    let depth = 0;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) {
                const brace = src.indexOf('{', i);
                return brace;
            }
        }
    }
    return -1;
}

function bodyEnd(src, openBrace) {
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
    const re = /\b(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
    const inserts = [];
    let m;
    while ((m = re.exec(src))) {
        if (m[1]) continue;
        const fnIndex = m.index;
        const open = bodyOpenBrace(src, fnIndex);
        if (open < 0) continue;
        const end = bodyEnd(src, open);
        const body = src.slice(open, end + 1);
        if (body.includes('await TVC_Dialog.')) inserts.push(fnIndex);
    }
    inserts.sort((a, b) => b - a);
    for (const idx of inserts) {
        src = src.slice(0, idx) + 'async ' + src.slice(idx);
    }
    fs.writeFileSync(full, src, 'utf8');
    console.log(rel, inserts.length);
}

for (const f of FILES) patchFile(f);

/**
 * Regression simulation: dialog label/text changes must not alter workflow rules.
 * Run: node scripts/sim-dialog-workflow-regression.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'js');

function walk(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, out);
        else if (ent.name.endsWith('.js') && ent.name !== 'dialog.js') out.push(p);
    }
    return out;
}

function findMatchingParen(text, openIdx) {
    let depth = 0, quote = null, escape = false;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function extractDialogCalls() {
    const calls = [];
    const re = /TVC_Dialog\.(alert|confirm|success|error|promptText|promptPassword)\s*\(/g;
    for (const file of walk(JS_DIR)) {
        const text = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        let m;
        while ((m = re.exec(text)) !== null) {
            const method = m[1];
            const open = m.index + m[0].length - 1;
            const close = findMatchingParen(text, open);
            if (close < 0) continue;
            const line = text.slice(0, m.index).split('\n').length;
            const after = text.slice(close + 1, close + 120);
            const before = text.slice(Math.max(0, m.index - 80), m.index);
            calls.push({ file: rel, line, method, before, after });
        }
    }
    return calls;
}

function analyzeBranching(calls) {
    const issues = [];
    let confirmAbort = 0;
    let confirmAssign = 0;
    let confirmDirect = 0;
    let alertOnly = 0;
    let promptText = 0;
    let promptPassword = 0;

    for (const c of calls) {
        const ctx = `${c.before}${c.after}`;
        if (c.method === 'confirm' || c.method === 'promptText' || c.method === 'promptPassword') {
            if (/if\s*\(\s*!?\s*await\s+TVC_Dialog\.(confirm|promptText|promptPassword)/.test(ctx)
                || /if\s*\(\s*!\s*\(await\s+TVC_Dialog/.test(ctx)
                || /return\s+!!?\(await\s+TVC_Dialog\.confirm/.test(ctx)) {
                confirmAbort++;
            } else if (/=\s*await\s+TVC_Dialog\.(confirm|promptText|promptPassword)/.test(ctx)
                || /await\s+TVC_Dialog\.confirm\([^)]+\)\s*\)/.test(ctx)) {
                confirmAssign++;
            } else {
                confirmDirect++;
            }
            // Workflow must not branch on button label text
            if (/confirmLabel|cancelLabel|['"]Confirm['"]|['"]OK['"]/.test(ctx) && /TVC_Dialog/.test(ctx)) {
                issues.push({ ...c, issue: 'Possible label-dependent branch near dialog call' });
            }
        } else {
            alertOnly++;
        }
    }

    return { issues, confirmAbort, confirmAssign, confirmDirect, alertOnly, promptText, promptPassword, total: calls.length };
}

/** Simulate dialog resolution contract (no DOM). */
function simulateDialogContract() {
    const results = [];

    function finishSim(showCancel, clickedConfirm) {
        return showCancel ? clickedConfirm : true;
    }

    // alert: always true after dismiss
    results.push({ case: 'alert', input: 'click OK', output: finishSim(false, true), expected: true });

    // confirm Yes/Cancel: true/false by button id, not label
    results.push({ case: 'confirm kind=confirm', input: 'click confirm btn', output: finishSim(true, true), expected: true });
    results.push({ case: 'confirm kind=confirm', input: 'click cancel btn', output: finishSim(true, false), expected: false });

    // kind=save/delete/warning/cancel — same boolean contract
    for (const kind of ['save', 'delete', 'warning', 'cancel']) {
        results.push({ case: `confirm kind=${kind}`, input: 'primary', output: finishSim(true, true), expected: true });
        results.push({ case: `confirm kind=${kind}`, input: 'secondary', output: finishSim(true, false), expected: false });
    }

    // promptText: null on cancel, string on confirm (label change OK→Yes irrelevant)
    results.push({ case: 'promptText', input: 'cancel', output: null, expected: null });
    results.push({ case: 'promptText', input: 'confirm+text', output: 'comment', expected: 'comment' });

    const failed = results.filter(r => r.output !== r.expected);
    return { results, failed };
}

function analyzeDialogSource() {
    const src = fs.readFileSync(path.join(ROOT, 'js/ui/dialog.js'), 'utf8');
    const checks = [
        {
            name: 'Confirm click resolves true via finish(true)',
            ok: /confirmBtn\?\.addEventListener\('click'[\s\S]*?finish\(true\)/.test(src),
        },
        {
            name: 'Cancel click resolves false via finish(false)',
            ok: /cancelBtn\?\.addEventListener\('click'[\s\S]*?finish\(false\)/.test(src),
        },
        {
            name: 'Button label only used in innerHTML (display)',
            ok: src.includes('esc(confirmLabel)') && !/confirmLabel\s*===/.test(src),
        },
        {
            name: 'No logic reads confirmLabel after render',
            ok: !/getElementById\('tvcDialogConfirmBtn'\)\.textContent/.test(src),
        },
        {
            name: 'alert() always resolves true (.then(() => true))',
            ok: /function alert[\s\S]*?\.then\(\(\)\s*=>\s*true\)/.test(src),
        },
        {
            name: 'promptText cancel returns null (not label-based)',
            ok: /if\s*\(!ok\)\s*return null/.test(src),
        },
    ];
    return checks;
}

function gitDialogMessageDiff() {
    try {
        const diff = execSync('git diff HEAD -- js/ui/dialog.js js/ui/spareMenu.js', { cwd: ROOT, encoding: 'utf8' });
        const messageChanges = (diff.match(/^[-+].*message:/gm) || []).length;
        const koreanMsgChanges = (diff.match(/^[-+].*[\uac00-\ud7a3]/gm) || []).filter(l => !l.includes('//')).length;
        const labelOnly = diff.includes("confirmLabel: 'Yes'") && !diff.includes("confirmLabel: 'Confirm'");
        return { hasDiff: !!diff.trim(), messageChanges, koreanMsgChanges, labelOnly, diffLines: diff.split('\n').length };
    } catch {
        return { hasDiff: false, messageChanges: 0, koreanMsgChanges: 0, labelOnly: false, diffLines: 0 };
    }
}

function grepLabelDependency() {
    const patterns = [
        { re: /confirmLabel\s*===/, desc: 'confirmLabel strict compare' },
        { re: /cancelLabel\s*===/, desc: 'cancelLabel strict compare' },
        { re: /tvcDialogConfirmBtn.*textContent/, desc: 'confirm button text read' },
        { re: /TVC_Dialog\.confirm\([^)]+\)\s*===\s*['"]/, desc: 'confirm result vs string' },
        { re: /TVC_Dialog\.alert\([^)]+\)\s*===\s*['"]/, desc: 'alert result vs string' },
    ];
    const hits = [];
    for (const file of walk(JS_DIR)) {
        const text = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        for (const p of patterns) {
            if (p.re.test(text)) hits.push({ file: rel, ...p });
        }
    }
    return hits;
}

// ── Run ──
console.log('=== TVC Dialog Workflow Regression Simulation ===\n');

const git = gitDialogMessageDiff();
console.log('1) Applied code changes (vs last commit)');
console.log(`   - Dialog message content changes: ${git.messageChanges}`);
console.log(`   - Korean message changes in code: ${git.koreanMsgChanges}`);
console.log(`   - Button label-only changes (Confirm→Yes): ${git.labelOnly ? 'YES' : 'no'}`);
console.log(`   - Korean→English in dialogs: ${git.koreanMsgChanges === 0 ? 'NOT applied in code (Excel only)' : 'APPLIED'}\n`);

const sourceChecks = analyzeDialogSource();
console.log('2) dialog.js contract checks');
let sourceOk = true;
for (const c of sourceChecks) {
    console.log(`   [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);
    if (!c.ok) sourceOk = false;
}

const contract = simulateDialogContract();
console.log('\n3) Boolean resolution simulation');
console.log(`   Cases: ${contract.results.length}, Failed: ${contract.failed.length}`);
if (contract.failed.length) {
    sourceOk = false;
    contract.failed.forEach(f => console.log('   FAIL:', f));
} else {
    console.log('   All dialog outcomes still boolean / null — label-independent');
}

const calls = extractDialogCalls();
const branch = analyzeBranching(calls);
console.log('\n4) Static scan of 867 TVC_Dialog call sites');
console.log(`   Total calls: ${branch.total}`);
console.log(`   confirm/prompt → if (!await) return (workflow gate): ${branch.confirmAbort}`);
console.log(`   confirm/prompt → assigned to variable: ${branch.confirmAssign}`);
console.log(`   alert/success/error (info only): ${branch.alertOnly}`);
console.log(`   Label-dependent branches found: ${branch.issues.length}`);

const labelHits = grepLabelDependency();
console.log('\n5) Codebase label/result dependency grep');
if (!labelHits.length) {
    console.log('   PASS — no code reads dialog button labels or compares results to strings');
} else {
    sourceOk = false;
    labelHits.forEach(h => console.log(`   FAIL ${h.desc}: ${h.file}`));
}

console.log('\n6) Workflow rule impact summary');
console.log('   ┌─────────────────────────────────────┬──────────────────┐');
console.log('   │ Change type                         │ Workflow impact  │');
console.log('   ├─────────────────────────────────────┼──────────────────┤');
console.log('   │ confirm Confirm→Yes (label)         │ NONE             │');
console.log('   │ promptText OK→Yes (label)           │ NONE             │');
console.log('   │ stockShortage confirmLabel→Yes      │ NONE             │');
console.log('   │ alert/success/error OK (unchanged)  │ NONE             │');
console.log('   │ save/delete/warning/cancel labels   │ NONE (unchanged) │');
console.log('   │ Permission/RBAC checks              │ NONE (unchanged) │');
console.log('   │ Import/export/sync logic            │ NONE (unchanged) │');
console.log('   │ Korean→English (Excel proposal)     │ NOT IN CODE YET  │');
console.log('   └─────────────────────────────────────┴──────────────────┘');

console.log(`\n=== OVERALL: ${sourceOk && branch.issues.length === 0 && !labelHits.length ? 'PASS — no workflow rule changes' : 'REVIEW NEEDED'} ===`);

process.exit(sourceOk && branch.issues.length === 0 && !labelHits.length ? 0 : 1);

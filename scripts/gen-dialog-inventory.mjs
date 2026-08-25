/**
 * Scan TVC_Dialog usage and export alert/confirm inventory by mode.
 * Run: node scripts/gen-dialog-inventory.mjs
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'data', 'TVC-Dialog-Alert-Inventory.xlsx');

const METHODS = ['alert', 'confirm', 'success', 'error', 'promptText', 'promptPassword'];

const KIND_DEFAULTS = {
    save: { confirmLabel: 'Save', cancelLabel: 'Cancel', confirmClass: 'btn-green', dialogType: 'confirm' },
    confirm: { confirmLabel: 'Yes', cancelLabel: 'Cancel', confirmClass: 'btn-green', dialogType: 'confirm' },
    delete: { confirmLabel: 'Delete', cancelLabel: 'Cancel', confirmClass: 'btn-red', dialogType: 'confirm' },
    cancel: { confirmLabel: 'Yes', cancelLabel: 'No', confirmClass: 'btn-green', dialogType: 'confirm' },
    warning: { confirmLabel: 'Continue', cancelLabel: 'Cancel', confirmClass: 'btn-green', dialogType: 'confirm' },
    alert: { confirmLabel: 'OK', cancelLabel: null, confirmClass: 'btn-green', dialogType: 'alert' },
    success: { confirmLabel: 'OK', cancelLabel: null, confirmClass: 'btn-green', dialogType: 'success' },
    error: { confirmLabel: 'OK', cancelLabel: null, confirmClass: 'btn-red', dialogType: 'error' },
    approve: { confirmLabel: 'Yes', cancelLabel: 'Cancel', confirmClass: 'btn-green', dialogType: 'confirm' },
};

const METHOD_DEFAULT_KIND = {
    alert: 'alert',
    confirm: 'confirm',
    success: 'success',
    error: 'error',
    promptText: 'confirm',
    promptPassword: 'confirm',
};

const KNOWN_HELPERS = {
    stockShortageDialogOpts: {
        title: 'Insufficient stock',
        confirmLabel: 'Yes',
        cancelLabel: 'Cancel',
        kind: 'confirm',
    },
};

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const WRAP = { wrapText: true, vertical: 'top' };

function styleHeaderRow(row) {
    row.eachCell(cell => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { ...WRAP, horizontal: 'center' };
    });
    row.height = 22;
}

function addSheet(wb, name, columns, rows) {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));
    styleHeaderRow(ws.getRow(1));
    rows.forEach(r => {
        const row = ws.addRow(r);
        row.alignment = WRAP;
    });
    if (columns.length <= 26) {
        ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
    }
    return ws;
}

function walkJs(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walkJs(p, out);
        else if (ent.name.endsWith('.js') && ent.name !== 'dialog.js') out.push(p);
    }
    return out;
}

function lineOf(text, index) {
    return text.slice(0, index).split('\n').length;
}

function findMatchingParen(text, openIdx) {
    let depth = 0;
    let quote = null;
    let escape = false;
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
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function unescapeString(raw, quote) {
    if (quote === '`') {
        return raw
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\`/g, '`')
            .replace(/\$\{[^}]+\}/g, '{…}');
    }
    return raw
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');
}

function parseStringAt(text, start) {
    const q = text[start];
    if (q !== '"' && q !== "'" && q !== '`') return null;
    let i = start + 1;
    let raw = '';
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\\') {
            raw += text.slice(i, i + 2);
            i += 2;
            continue;
        }
        if (ch === q) {
            return { value: unescapeString(raw, q), end: i + 1 };
        }
        raw += ch;
        i++;
    }
    return null;
}

function parseObjectLiteral(text) {
    const out = {};
    let i = 0;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') return out;
    i++;
    while (i < text.length) {
        while (i < text.length && /[\s,]/.test(text[i])) i++;
        if (text[i] === '}') break;
        const keyMatch = text.slice(i).match(/^([a-zA-Z_$][\w$]*)\s*:/);
        if (!keyMatch) break;
        const key = keyMatch[1];
        i += keyMatch[0].length;
        while (i < text.length && /\s/.test(text[i])) i++;
        const ch = text[i];
        if (ch === '"' || ch === "'" || ch === '`') {
            const parsed = parseStringAt(text, i);
            if (parsed) {
                out[key] = parsed.value;
                i = parsed.end;
            } else i++;
        } else {
            const valMatch = text.slice(i).match(/^([a-zA-Z_$][\w$]*|true|false|null|\d+)/);
            if (valMatch) {
                out[key] = valMatch[1];
                i += valMatch[0].length;
            } else i++;
        }
    }
    return out;
}

function normalizeMessage(msg) {
    return String(msg || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function patternMessage(msg) {
    return normalizeMessage(msg)
        .replace(/\b\d+\b/g, '{n}')
        .replace(/"[A-Za-z0-9 _\-./]+"/g, '"{name}"')
        .replace(/\{…\}/g, '{var}');
}

function resolveButtons(method, opts = {}) {
    const kind = opts.kind || METHOD_DEFAULT_KIND[method] || 'confirm';
    const defs = KIND_DEFAULTS[kind] || KIND_DEFAULTS.confirm;
    const isAlertLike = method === 'alert' || method === 'success' || method === 'error'
        || kind === 'alert' || kind === 'success' || kind === 'error';
    const primary = opts.confirmLabel || defs.confirmLabel || 'OK';
    const secondary = isAlertLike ? null : (opts.cancelLabel ?? defs.cancelLabel ?? 'Cancel');
    return {
        kind,
        dialogType: method === 'promptText' ? 'prompt (textarea)'
            : method === 'promptPassword' ? 'prompt (password)'
            : defs.dialogType || method,
        primaryButton: primary,
        secondaryButton: secondary,
        buttonPattern: secondary ? `${primary} | ${secondary}` : primary,
        confirmClass: opts.confirmClass || defs.confirmClass || 'btn-green',
    };
}

function inferModes(context, message, fileRel, fnName) {
    const modes = new Set();
    const ctx = context.toLowerCase();
    const msg = String(message || '').toLowerCase();

    const add = (...m) => m.forEach(x => modes.add(x));

    if (/isadminaccount|admin mode|administrator/.test(ctx)) add('Admin');
    if (/ishqaccount|hq mode|hq superintendent|superintendent/.test(ctx)) add('HQ');
    if (/iscaptainhub|captain hub|master hub|vessel_master/.test(ctx)) add('Master');
    if (/isenginevesselmode|department\s*===?\s*['"]engine['"]|chief engineer/.test(ctx)) add('Engine');
    if (/isdeckvesselmode|department\s*===?\s*['"]deck['"]|chief officer/.test(ctx)) add('Deck');

    if (/hq mode only|available in hq/.test(msg)) {
        modes.clear();
        add('HQ');
    }
    if (/chief engineer \/ captain permission|chief engineer, chief officer, captain/.test(msg)) {
        add('Engine', 'Deck', 'Master');
    }
    if (/chief engineer \/ captain/.test(msg) && !/chief officer/.test(msg)) {
        add('Engine', 'Master');
    }
    if (/superintendent \(hq\)|hq superintendent/.test(msg)) {
        add('HQ');
    }

    // File / feature hints
    if (/runhours|run hours/.test(fileRel + fnName + msg)) add('Engine', 'Deck', 'Master');
    if (/workpermit|work permit/.test(fileRel + fnName)) add('Engine', 'Deck', 'Master', 'HQ');
    if (/defectreport|defect report/.test(fileRel + fnName)) add('Engine', 'Deck', 'Master', 'HQ');
    if (/sparemenu|spare|requisition|consumption/.test(fileRel + fnName)) add('Engine', 'Deck', 'Master', 'HQ');
    if (/masterbackup|database backup|database restore/.test(fileRel + fnName + msg)) add('Engine', 'Deck', 'Master', 'HQ');
    if (/admin|registry|license|app update|signing key/.test(fileRel + fnName + msg)) add('Admin', 'HQ');

    if (!modes.size) add('All modes');
    return [...modes].sort().join(', ');
}

function nearestFunctionName(text, index) {
    const before = text.slice(Math.max(0, index - 4000), index);
    const fns = [...before.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)];
    if (fns.length) return fns[fns.length - 1][1];
    const methods = [...before.matchAll(/(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)];
    if (methods.length) return methods[methods.length - 1][1];
    return '';
}

function inferArea(fileRel, fnName, message) {
    const f = `${fileRel} ${fnName} ${message}`.toLowerCase();
    if (/spare|requisition|consumption|inventory|quotation|order|vendor|bom/.test(f)) return 'SPARE';
    if (/defect|casereport|case report/.test(f)) return 'Defect Report';
    if (/workpermit|work permit/.test(f)) return 'Work Permit';
    if (/workreport|work report|maintenance|pms master|job|group|equipment/.test(f)) return 'PMS / Work Report';
    if (/runhours|running hours/.test(f)) return 'Running Hours';
    if (/backup|restore|import|export|sync|transfer|casereport|monthly/.test(f)) return 'Data Sync / Export';
    if (/auth|login|sign in|permission denied/.test(f)) return 'Auth / RBAC';
    if (/admin|license|registry|app update|company|vessel form/.test(f)) return 'Admin / HQ Setup';
    if (/attachment|popup|pop-up/.test(f)) return 'Attachments / Browser';
    return 'General';
}

function inferTrigger(fnName, message, method) {
    const m = `${fnName} ${message}`.toLowerCase();
    if (/delete|remove|purge/.test(m)) return 'Delete action';
    if (/save/.test(m) || method === 'promptText') return 'Save / Submit';
    if (/confirm/.test(m)) return 'Confirm workflow step';
    if (/approve/.test(m)) return 'Approve workflow step';
    if (/import|restore|backup|export|transfer/.test(m)) return 'Import / Export / Backup';
    if (/permission|login|sign in|denied|required/.test(m)) return 'Permission / validation gate';
    if (/select|check one|not found|no permission/.test(m)) return 'Selection / state validation';
    if (/popup|pop-up/.test(m)) return 'Browser popup blocked';
    if (/success|saved|confirmed|approved|deleted|complete/.test(m)) return 'Success feedback';
    if (/failed|error/.test(m)) return 'Error feedback';
    return 'User action';
}

function parseCallArg(argText) {
    const trimmed = argText.trim();
    if (!trimmed) return {};
    const helperMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (helperMatch && KNOWN_HELPERS[helperMatch[1]]) {
        const base = { ...KNOWN_HELPERS[helperMatch[1]] };
        const innerOpen = trimmed.indexOf('(');
        const innerClose = findMatchingParen(trimmed, innerOpen);
        if (innerOpen >= 0 && innerClose > innerOpen) {
            const inner = trimmed.slice(innerOpen + 1, innerClose).trim();
            if (inner.startsWith('`') || inner.startsWith('"') || inner.startsWith("'")) {
                const parsed = parseStringAt(inner, 0);
                if (parsed) base.message = parsed.value;
            } else if (inner.includes('${')) {
                const bt = inner.match(/^`([\s\S]*)`$/);
                if (bt) base.message = unescapeString(bt[1], '`');
            } else {
                base.message = `{${inner.slice(0, 80)}}`;
            }
        }
        return base;
    }
    if (trimmed.startsWith('{')) return parseObjectLiteral(trimmed);
    const str = parseStringAt(trimmed, 0);
    if (str) return { message: str.value };
    return { message: trimmed.slice(0, 120) };
}

function extractDialogs(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const rows = [];
    const re = /TVC_Dialog\.(alert|confirm|success|error|promptText|promptPassword)\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const method = m[1];
        const open = m.index + m[0].length - 1;
        const close = findMatchingParen(text, open);
        if (close < 0) continue;
        const argText = text.slice(open + 1, close);
        const opts = parseCallArg(argText);
        const line = lineOf(text, m.index);
        const contextStart = Math.max(0, m.index - 1200);
        const context = text.slice(contextStart, Math.min(text.length, close + 400));
        const fnName = nearestFunctionName(text, m.index);
        const buttons = resolveButtons(method, opts);
        const message = opts.message || '';
        const title = opts.title || (method === 'promptText' ? "Company's Comments" : method === 'promptPassword' ? 'Password' : '');
        rows.push({
            file: rel,
            line,
            area: inferArea(rel, fnName, message),
            functionName: fnName,
            trigger: inferTrigger(fnName, message, method),
            modes: inferModes(context, message, rel, fnName),
            dialogMethod: method,
            kind: buttons.kind,
            dialogType: buttons.dialogType,
            title: title || '(none)',
            message: normalizeMessage(message),
            messagePattern: patternMessage(message),
            primaryButton: buttons.primaryButton,
            secondaryButton: buttons.secondaryButton || '(none)',
            buttonPattern: buttons.buttonPattern,
            confirmClass: buttons.confirmClass,
        });
    }
    return rows;
}

function dedupeKey(r) {
    return [r.dialogMethod, r.kind, r.title, r.messagePattern, r.buttonPattern, r.modes, r.area].join('\0');
}

function main() {
    const files = walkJs(JS_DIR);
    const all = files.flatMap(extractDialogs);
    all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    const uniqueMap = new Map();
    for (const r of all) {
        const k = dedupeKey(r);
        if (!uniqueMap.has(k)) {
            uniqueMap.set(k, { ...r, occurrences: 1, locations: [`${r.file}:${r.line}`] });
        } else {
            const u = uniqueMap.get(k);
            u.occurrences += 1;
            u.locations.push(`${r.file}:${r.line}`);
        }
    }
    const unique = [...uniqueMap.values()].sort((a, b) => a.area.localeCompare(b.area) || a.messagePattern.localeCompare(b.messagePattern));

    const modeSheets = ['HQ', 'Master', 'Engine', 'Deck', 'Admin', 'All modes'];
    const byMode = {};
    for (const mode of modeSheets) byMode[mode] = [];
    for (const r of unique) {
        const modes = r.modes.split(', ').map(s => s.trim());
        for (const mode of modeSheets) {
            if (modes.includes(mode)) byMode[mode].push(r);
        }
    }

    const buttonSummaryMap = new Map();
    for (const r of unique) {
        const k = `${r.dialogType}|${r.kind}|${r.buttonPattern}|${r.confirmClass}`;
        if (!buttonSummaryMap.has(k)) {
            buttonSummaryMap.set(k, {
                dialogType: r.dialogType,
                kind: r.kind,
                buttonPattern: r.buttonPattern,
                primaryButton: r.primaryButton,
                secondaryButton: r.secondaryButton,
                confirmClass: r.confirmClass,
                count: r.occurrences,
                examples: [r.messagePattern.slice(0, 120)],
            });
        } else {
            const s = buttonSummaryMap.get(k);
            s.count += r.occurrences;
            if (s.examples.length < 3) s.examples.push(r.messagePattern.slice(0, 120));
        }
    }
    const buttonSummary = [...buttonSummaryMap.values()].sort((a, b) => b.count - a.count);

    const kindRows = Object.entries(KIND_DEFAULTS).map(([kind, v]) => ({
        kind,
        dialogType: v.dialogType,
        defaultPrimary: v.confirmLabel,
        defaultSecondary: v.cancelLabel || '(none)',
        buttonPattern: v.cancelLabel ? `${v.confirmLabel} | ${v.cancelLabel}` : v.confirmLabel,
        confirmClass: v.confirmClass,
        note: kind === 'approve' ? 'Used in code but not defined in dialog.js KIND — falls back to Confirm | Cancel' : '',
    }));

    const overviewRows = [
        { item: 'Source', value: 'TVC_Dialog (js/ui/dialog.js) — in-app modal' },
        { item: 'Modes', value: 'HQ | Master (Captain Hub) | Engine | Deck | Admin | All modes' },
        { item: 'Dialog methods', value: 'alert, confirm, success, error, promptText, promptPassword' },
        { item: 'Total call sites', value: String(all.length) },
        { item: 'Unique patterns', value: String(unique.length) },
        { item: 'Generated', value: new Date().toISOString().slice(0, 19).replace('T', ' ') },
        { item: 'Regenerate', value: 'node scripts/gen-dialog-inventory.mjs' },
        { item: 'Note', value: 'Mode column is heuristic (guard clauses + message keywords). Review before unification.' },
    ];

    const cols = [
        { header: 'Area', key: 'area', width: 18 },
        { header: 'Modes', key: 'modes', width: 22 },
        { header: 'Trigger', key: 'trigger', width: 20 },
        { header: 'Type', key: 'dialogType', width: 14 },
        { header: 'Kind', key: 'kind', width: 10 },
        { header: 'Title', key: 'title', width: 18 },
        { header: 'Message', key: 'messagePattern', width: 48 },
        { header: 'Primary Btn', key: 'primaryButton', width: 12 },
        { header: 'Secondary Btn', key: 'secondaryButton', width: 14 },
        { header: 'Button Pattern', key: 'buttonPattern', width: 18 },
        { header: 'Btn Class', key: 'confirmClass', width: 12 },
        { header: 'Count', key: 'occurrences', width: 8 },
        { header: 'Sample Location', key: 'locations', width: 36 },
        { header: 'Function', key: 'functionName', width: 22 },
    ];

    const fullCols = [
        ...cols.slice(0, 6),
        { header: 'Sample Message', key: 'message', width: 48 },
        ...cols.slice(6),
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TVC-PMS';
    wb.created = new Date();

    addSheet(wb, 'Overview', [
        { header: 'Item', key: 'item', width: 22 },
        { header: 'Value', key: 'value', width: 80 },
    ], overviewRows);

    addSheet(wb, 'Dialog Kind Defaults', [
        { header: 'Kind', key: 'kind', width: 12 },
        { header: 'Dialog Type', key: 'dialogType', width: 14 },
        { header: 'Default Primary', key: 'defaultPrimary', width: 14 },
        { header: 'Default Secondary', key: 'defaultSecondary', width: 16 },
        { header: 'Button Pattern', key: 'buttonPattern', width: 18 },
        { header: 'Confirm Class', key: 'confirmClass', width: 14 },
        { header: 'Note', key: 'note', width: 40 },
    ], kindRows);

    addSheet(wb, 'Button Patterns', [
        { header: 'Dialog Type', key: 'dialogType', width: 14 },
        { header: 'Kind', key: 'kind', width: 10 },
        { header: 'Button Pattern', key: 'buttonPattern', width: 18 },
        { header: 'Primary', key: 'primaryButton', width: 12 },
        { header: 'Secondary', key: 'secondaryButton', width: 14 },
        { header: 'Btn Class', key: 'confirmClass', width: 12 },
        { header: 'Occurrences', key: 'count', width: 12 },
        { header: 'Example Messages', key: 'examples', width: 60 },
    ], buttonSummary.map(r => ({ ...r, examples: r.examples.join('\n') })));

    addSheet(wb, 'All Unique Dialogs', fullCols, unique.map(r => ({
        ...r,
        locations: r.locations.slice(0, 3).join('\n') + (r.locations.length > 3 ? `\n+${r.locations.length - 3} more` : ''),
    })));

    for (const mode of modeSheets) {
        addSheet(wb, `${mode} Mode`, cols, byMode[mode].map(r => ({
            ...r,
            message: r.messagePattern,
            locations: r.locations[0],
        })));
    }

    addSheet(wb, 'All Call Sites', [
        { header: 'File', key: 'file', width: 34 },
        { header: 'Line', key: 'line', width: 8 },
        { header: 'Modes', key: 'modes', width: 22 },
        { header: 'Type', key: 'dialogType', width: 14 },
        { header: 'Kind', key: 'kind', width: 10 },
        { header: 'Title', key: 'title', width: 18 },
        { header: 'Message', key: 'message', width: 50 },
        { header: 'Buttons', key: 'buttonPattern', width: 18 },
        { header: 'Function', key: 'functionName', width: 22 },
        { header: 'Area', key: 'area', width: 18 },
    ], all);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    wb.xlsx.writeFile(OUT).then(() => {
        console.log(`Wrote ${OUT}`);
        console.log(`Call sites: ${all.length}, unique patterns: ${unique.length}`);
    });
}

main();

/**
 * One-time migration: window.alert/confirm -> TVC_Dialog (English).
 * Adds async to enclosing function declarations when await is injected.
 */
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

const KO_EN = [
    [/로그인이 필요합니다\.?/g, 'Sign in required.'],
    [/로그인 필요/g, 'Sign in required'],
    [/로그인 중…/g, 'Signing in…'],
    [/로그인 중\.\.\./g, 'Signing in…'],
    [/시스템 준비 중…/g, 'Preparing system…'],
    [/로그인 실패/g, 'Sign in failed'],
    [/로그인 중 오류가 발생했습니다\.?/g, 'An error occurred while signing in.'],
    [/저장하시겠습니까\?/g, 'Save changes?'],
    [/작성을 취소하시겠습니까\?/g, 'Cancel editing?'],
    [/완료하시겠습니까\?/g, 'Complete this action?'],
    [/삭제하시겠습니까\?/g, 'Delete this item?'],
    [/Confirm하시겠습니까\?/g, 'Confirm selected item(s)?'],
    [/([0-9]+)건의 Defect Report를 삭제하시겠습니까\?/g, 'Delete $1 defect report(s)?'],
    [/([0-9]+)건의 Defect Report를 Confirm하시겠습니까\?/g, 'Confirm $1 defect report(s)?'],
    [/([0-9]+)건의 Work Report/g, '$1 Work Report(s)'],
    [/를 Confirm하시겠습니까\?/g, ' — confirm selected item(s)?'],
    [/를 Approve하시겠습니까\?/g, ' — approve selected item(s)?'],
    [/이 작업 항목을 삭제하시겠습니까\?/g, 'Delete this maintenance item?'],
    [/Job Code를 입력하세요\.?/g, 'Enter Job Code.'],
    [/GROUP을 선택하세요\.?/g, 'Select a GROUP.'],
    [/동일한 Job Code가 이미 존재합니다\.?/g, 'Job Code already exists.'],
    [/타 부서 항목은 편집할 수 없습니다\.?/g, 'Cannot edit items from another department.'],
    [/항목이 추가되었습니다\.?/g, 'Item added.'],
    [/항목이 수정되었습니다\.?/g, 'Item updated.'],
    [/Postpone Date를 입력하세요\.?/g, 'Enter Postpone Date.'],
    [/Confirm할 수 있는 항목이 없습니다\.?/g, 'No items available to confirm.'],
    [/Confirm 실패/g, 'Confirm failed'],
    [/([0-9]+)건 Confirm 완료/g, '$1 item(s) confirmed'],
    [/마지막 Running Hours Update를 되돌리시겠습니까\?/g, 'Revert the last Running Hours update?\nWork Plan due dates will be recalculated.'],
    [/Running Hours Update가 되돌려졌습니다\.?/g, 'Running Hours update reverted.'],
    [/Running Hours Update가 이미 완료되었습니다\.?/g, 'Running Hours update is already complete.\nUse Revert to update again.'],
    [/되돌릴 Update 기록이 없습니다\.?/g, 'No update record to revert.'],
    [/PMS Master Excel을 Import 합니다\.?/g, 'Import PMS Master Excel?'],
    [/Group · Equipment · Jobs가 갱신됩니다\. 계속할까요\?/g, 'Group, Equipment, and Jobs will be updated. Continue?'],
    [/Defect Report를 삭제하시겠습니까\?/g, 'Delete this defect report?'],
    [/재고 차감 · LAST DONE \/ NEXT DATE 갱신/g, '(Stock deduction · LAST DONE / NEXT DATE update)'],
    [/미완료 Work Report ([0-9]+)건 — Cancel 선택 후 Work Plan에서 입력하세요\.?/g, '$1 unfinished Work Report(s) — select Cancel and enter them in Work Plan.'],
];

function translateKoEn(text) {
    let out = text;
    for (const [re, rep] of KO_EN) out = out.replace(re, rep);
    return out;
}

function replaceConfirmCalls(src) {
    let i = 0;
    let out = '';
    while (i < src.length) {
        const m = src.slice(i).match(/(?:window\.)?confirm\s*\(/);
        if (!m || m.index == null) {
            out += src.slice(i);
            break;
        }
        const start = i + m.index;
        out += src.slice(i, start);
        let p = start + m[0].length;
        let depth = 1;
        let quote = null;
        while (p < src.length && depth > 0) {
            const ch = src[p];
            if (quote) {
                if (ch === '\\') { p += 2; continue; }
                if (ch === quote) quote = null;
            } else if (ch === '\'' || ch === '"' || ch === '`') {
                quote = ch;
            } else if (ch === '(') depth++;
            else if (ch === ')') depth--;
            p++;
        }
        const inner = src.slice(start + m[0].length, p - 1);
        const translated = translateKoEn(inner);
        out += `await TVC_Dialog.confirm({ message: ${translated} })`;
        i = p;
    }
    return out;
}

function replaceAlertCalls(src) {
    return src
        .replace(/return\s+alert\s*\(/g, 'await TVC_Dialog.alert(')
        .replace(/(?:window\.)?alert\s*\(/g, 'await TVC_Dialog.alert(');
}

function addAsyncToFunctions(src) {
    const needsAwait = src.includes('await TVC_Dialog.');
    if (!needsAwait) return src;
    return src.replace(/\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g, (match, name, offset) => {
        const before = src.slice(Math.max(0, offset - 12), offset);
        if (before.endsWith('async ')) return match;
        const fnStart = offset;
        let brace = src.indexOf('{', fnStart);
        if (brace < 0) return match;
        let depth = 0;
        let end = brace;
        for (let i = brace; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        const body = src.slice(brace, end + 1);
        if (!body.includes('await TVC_Dialog.')) return match;
        return `async function ${name}(`;
    });
}

function migrateFile(relPath) {
    const full = path.join(ROOT, relPath);
    let src = fs.readFileSync(full, 'utf8');
    src = translateKoEn(src);
    src = replaceConfirmCalls(src);
    src = replaceAlertCalls(src);
    src = addAsyncToFunctions(src);
    // fix return await TVC_Dialog.alert -> await ...; return;
    src = src.replace(/return await TVC_Dialog\.alert\(([^;]*)\);/g, 'await TVC_Dialog.alert($1); return;');
    fs.writeFileSync(full, src, 'utf8');
    console.log('migrated', relPath);
}

for (const f of FILES) migrateFile(f);

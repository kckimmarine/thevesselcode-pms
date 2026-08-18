/**
 * Final pilot release — Setup.exe (4 SKU) + App Update ZIP + handoff note.
 * Trigger: npm run release
 * Config:  release/v{version}.json  (must match package.json version)
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function run(cmd, args, opts = {}) {
    console.log('\n>', cmd, args.join(' '));
    const r = spawnSync(cmd, args, {
        cwd: root,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...opts.env },
    });
    if (r.status !== 0) process.exit(r.status || 1);
}

function loadReleaseConfig(version) {
    const file = path.join(root, 'release', `v${version}.json`);
    if (!fs.existsSync(file)) {
        console.error(`Release config not found: release/v${version}.json`);
        console.error('Create it before running npm run release');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formatReleaseNotes(config) {
    const lines = [`TVC-PMS v${config.version}${config.label ? ` — ${config.label}` : ''}`];
    for (const item of config.changelog || []) {
        lines.push(`· ${item}`);
    }
    return lines.join('\n');
}

function cleanDist(distDir, version, skus) {
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    for (const f of fs.readdirSync(distDir)) {
        if (/^tvc_app_update_.*\.zip$/i.test(f) || /^TVC-PMS App Update v/i.test(f)) {
            fs.unlinkSync(path.join(distDir, f));
            console.log('Removed old', f);
        }
    }
    for (const sku of skus) {
        const exact = `TVC-PMS-${sku}-${version}-Setup.exe`;
        const p = path.join(distDir, exact);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log('Removed old', exact);
        }
    }
}

function writeHandoff(config, zipPath, zipSizeMb) {
    const outDir = path.join(root, 'release');
    fs.mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const handoffPath = path.join(outDir, `v${config.version}-handoff-${date}.txt`);
    const zipName = path.basename(zipPath);

    const lines = [
        `[TVC-PMS v${config.version} App Update — 후배 전달용]`,
        '',
        `■ 파일: ${zipName}`,
        `■ 경로: ${zipPath}`,
        `■ 용량: 약 ${zipSizeMb} MB`,
        `■ ${config.handoff?.delivery || 'ZIP 1개 전달'}`,
        '',
        '■ 포함 SKU: ' + (config.target_skus || []).join(', '),
        '',
        '■ 변경 사항',
        ...(config.changelog || []).map(c => `- ${c}`),
        '',
        '■ 설치',
        ...(config.handoff?.install_steps || []).map((s, i) => `${i + 1}. ${s}`),
        '',
        '■ 주의',
        ...(config.handoff?.warnings || []).map(w => `- ${w}`),
        '',
        '■ 설치 후 테스트',
        ...(config.test_checklist || []).map(t => `[ ] ${t}`),
    ];
    fs.writeFileSync(handoffPath, lines.join('\n'), 'utf8');
    return handoffPath;
}

function findAppUpdateZip(distDir, version) {
    const canonical = path.join(distDir, `TVC-PMS App Update v${version}.zip`);
    if (fs.existsSync(canonical)) return canonical;
    const prefix = `tvc_app_update_${version.replace(/[^\w.-]+/g, '_')}_`;
    const matches = fs.readdirSync(distDir)
        .filter(n => (n.startsWith(prefix) || n.startsWith('TVC-PMS App Update v')) && n.endsWith('.zip'))
        .sort()
        .reverse();
    return matches.length ? path.join(distDir, matches[0]) : null;
}

async function main() {
    const version = pkg.version;
    const config = loadReleaseConfig(version);
    if (config.version !== version) {
        console.error(`release/v${config.version}.json does not match package.json version ${version}`);
        process.exit(1);
    }

    const skus = config.target_skus || ['HQ_OFFICE', 'VESSEL_ENGINE', 'VESSEL_DECK', 'VESSEL_MASTER'];
    const distDir = path.join(root, 'dist');
    const notes = formatReleaseNotes(config);

    console.log('='.repeat(60));
    console.log(`TVC-PMS Release v${version}`);
    console.log('='.repeat(60));
    console.log('\nChangelog:');
    console.log(notes);
    console.log('');

    cleanDist(distDir, version, skus);

    run('node', ['scripts/generate-license-keys.mjs']);
    for (const sku of skus) {
        run('node', ['scripts/build-one-sku.mjs', sku, 'nsis']);
    }

    run('node', ['scripts/build-app-update-zip.mjs', version]);

    const zipPath = findAppUpdateZip(distDir, version);
    if (!zipPath) {
        console.error('App Update ZIP not found after build');
        process.exit(1);
    }
    const zipSizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    const handoffPath = writeHandoff(config, zipPath, zipSizeMb);

    console.log('\n' + '='.repeat(60));
    console.log('RELEASE COMPLETE');
    console.log('='.repeat(60));
    console.log('\nApp Update ZIP:', zipPath);
    console.log('Handoff note:  ', handoffPath);
    console.log('\n후배 전달: 위 ZIP 1개 (+ handoff.txt 내용 참고)');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

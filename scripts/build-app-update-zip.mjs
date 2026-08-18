/**
 * Build App Update ZIP from dist/*-Setup.exe (Admin Package App Update equivalent).
 * Usage: node scripts/build-app-update-zip.mjs [version] [--notes "release notes"]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const TARGET_SKUS = ['HQ_OFFICE', 'VESSEL_ENGINE', 'VESSEL_DECK', 'VESSEL_MASTER'];
const KIND = 'TVC_APP_UPDATE';
const MANIFEST_VERSION = 1;
const SETUPS_DIR = 'setups/';
const JSON_NAME = 'tvc_app_update.json';

function loadReleaseNotes(version) {
    const file = path.join(root, 'release', `v${version}.json`);
    if (!fs.existsSync(file)) return null;
    try {
        const config = JSON.parse(fs.readFileSync(file, 'utf8'));
        const lines = [`TVC-PMS v${config.version}${config.label ? ` — ${config.label}` : ''}`];
        for (const item of config.changelog || []) lines.push(`· ${item}`);
        return lines.join('\n');
    } catch {
        return null;
    }
}

function parseArgs(argv) {
    let version = pkg.version;
    let notes = loadReleaseNotes(version) || [
        `TVC-PMS v${version}`,
        '· CE/CO Confirm 후 Monthly Report Export → Master Hub',
        '· Defect / Postpone / Work Permit Confirm 후 Export',
        '· Data History Monthly 탭 PMS/SPARE Master 제외',
    ].join('\n');
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--notes' && argv[i + 1]) {
            notes = argv[++i];
        } else if (!argv[i].startsWith('-')) {
            version = argv[i];
        }
    }
    return { version, notes };
}

function findSetupExe(distDir, sku, version) {
    const exact = path.join(distDir, `TVC-PMS-${sku}-${version}-Setup.exe`);
    if (fs.existsSync(exact)) return exact;
    const prefix = `TVC-PMS-${sku}-`;
    const suffix = '-Setup.exe';
    const matches = fs.readdirSync(distDir)
        .filter(n => n.startsWith(prefix) && n.endsWith(suffix))
        .sort()
        .reverse();
    if (!matches.length) return null;
    return path.join(distDir, matches[0]);
}

async function main() {
    const { version, notes } = parseArgs(process.argv);
    const distDir = path.join(root, 'dist');
    if (!fs.existsSync(distDir)) {
        console.error('dist/ not found. Run: npm run dist  (or build-one-sku per SKU)');
        process.exit(1);
    }

    const setups = [];
    const missing = [];
    for (const sku of TARGET_SKUS) {
        const setupPath = findSetupExe(distDir, sku, version);
        if (!setupPath) {
            missing.push(sku);
            continue;
        }
        const filename = path.basename(setupPath).replace(/[\\/]/g, '_');
        const stat = fs.statSync(setupPath);
        setups.push({ sku, filename, path: setupPath, bytes: stat.size });
        console.log(`  + ${sku}: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    }

    if (!setups.length) {
        console.error('No Setup.exe found in dist/ for:', TARGET_SKUS.join(', '));
        console.error(`Expected e.g. TVC-PMS-VESSEL_ENGINE-${version}-Setup.exe`);
        console.error('Run: npm run dist');
        process.exit(1);
    }
    if (missing.length) {
        console.warn('Warning: missing Setup for:', missing.join(', '));
    }

    const manifest = {
        kind: KIND,
        version: MANIFEST_VERSION,
        app_version: version,
        notes,
        target_skus: setups.map(s => s.sku),
        setups: setups.map(s => ({ sku: s.sku, filename: s.filename, bytes: s.bytes })),
        exported_at: new Date().toISOString(),
        exported_by: 'build-app-update-zip',
        affects_operational_data: false,
    };

    const zip = new JSZip();
    zip.file(JSON_NAME, JSON.stringify(manifest, null, 2));
    for (const s of setups) {
        zip.file(SETUPS_DIR + s.filename, fs.readFileSync(s.path));
    }

    const outName = `TVC-PMS App Update v${version}.zip`;
    const outPath = path.join(distDir, outName);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    fs.writeFileSync(outPath, buf);

    console.log('\nApp Update ZIP written:');
    console.log(' ', outPath);
    console.log('  Version:', version);
    console.log('  SKUs:', setups.map(s => s.sku).join(', '));
    console.log('  Size:', (buf.length / 1024 / 1024).toFixed(1), 'MB');
    console.log('\nSend this ZIP to HQ/Vessel → Import → App Update → Install update.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

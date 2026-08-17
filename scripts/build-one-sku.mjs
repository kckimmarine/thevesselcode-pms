/* Build one Pilot SKU (dir or nsis) — faster than full dist */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SKUS, getSku } = require('../electron/sku.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const sku = String(process.argv[2] || 'VESSEL_ENGINE').toUpperCase();
const target = String(process.argv[3] || 'dir').toLowerCase(); // dir | nsis
const def = getSku(sku);
if (!def) {
    console.error('Unknown SKU:', sku);
    console.error('Options:', Object.keys(SKUS).join(', '));
    process.exit(1);
}

function run(cmd, args, env = {}) {
    console.log('>', cmd, args.join(' '));
    const r = spawnSync(cmd, args, {
        cwd: root,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...env },
    });
    if (r.status !== 0) process.exit(r.status || 1);
}

run('node', ['scripts/generate-license-keys.mjs']);

const cfgDir = path.join(root, 'build', 'electron-builder');
const stampDir = path.join(root, 'build', 'sku-stamps');
fs.mkdirSync(cfgDir, { recursive: true });
fs.mkdirSync(stampDir, { recursive: true });

const stamp = {
    sku: def.sku,
    companyId: def.companyId,
    vesselId: def.vesselId || null,
    productName: def.productName,
    label: def.label,
};
const stampSrc = path.join(stampDir, `${sku}.json`);
fs.writeFileSync(stampSrc, JSON.stringify(stamp, null, 2));

const winTarget = target === 'nsis' ? 'nsis' : 'dir';
const buildOut = `dist/_build_${sku}`;
const config = {
    ...pkg.build,
    appId: def.appId || `com.thevesselcode.tvc-pms.${sku.toLowerCase()}`,
    productName: def.productName,
    executableName: def.executableName || def.productName,
    extraResources: [{ from: stampSrc.replace(/\\/g, '/'), to: 'sku.json' }],
    artifactName: `TVC-PMS-${sku}-\${version}-Setup.\${ext}`,
    directories: { ...(pkg.build.directories || {}), output: buildOut },
    win: {
        ...(pkg.build.win || {}),
        executableName: def.executableName || def.productName,
        target: [winTarget],
    },
};
const cfgPath = path.join(cfgDir, `${sku}-${winTarget}.json`);
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

console.log(`\n=== Building ${sku} (${def.productName}) → ${winTarget} ===\n`);
run('npx', ['electron-builder', '--win', winTarget, '--config', cfgPath], {
    TVC_BUILD_SKU: sku,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
});

const builtSetup = fs.readdirSync(path.join(root, buildOut))
    .filter(n => n.startsWith(`TVC-PMS-${sku}-`) && n.endsWith('-Setup.exe'))
    .sort()
    .reverse()[0];
if (builtSetup) {
    const src = path.join(root, buildOut, builtSetup);
    const dest = path.join(root, 'dist', builtSetup);
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('Copied to dist/', builtSetup);
}

console.log('\nDone. See dist/');

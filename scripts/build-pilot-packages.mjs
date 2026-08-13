/* Build Windows NSIS installers for each Pilot SKU (seat license — no unbound embed) */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SKUS } = require('../electron/sku.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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
// Dev/unbound seeds still useful for local Electron; packaged apps use sku.json only.
run('node', ['scripts/issue-license.mjs', '--all', '--months', '3']);

const cfgDir = path.join(root, 'build', 'electron-builder');
const stampDir = path.join(root, 'build', 'sku-stamps');
fs.mkdirSync(cfgDir, { recursive: true });
fs.mkdirSync(stampDir, { recursive: true });

for (const sku of Object.keys(SKUS)) {
    const def = SKUS[sku];
    const stamp = {
        sku: def.sku,
        companyId: def.companyId,
        vesselId: def.vesselId || null,
        productName: def.productName,
        label: def.label,
    };
    const stampSrc = path.join(stampDir, `${sku}.json`);
    fs.writeFileSync(stampSrc, JSON.stringify(stamp, null, 2));

    const cfgPath = path.join(cfgDir, `${sku}.json`);
    // Per-SKU appId + install dir so Master/Engine/Deck/HQ can all sit on one PC
    const config = {
        ...pkg.build,
        appId: def.appId || `com.thevesselcode.tvc-pms.${sku.toLowerCase()}`,
        productName: def.productName,
        executableName: def.executableName || def.productName,
        // Identity only — runnable seat license is applied after install (per PC).
        extraResources: [
            { from: stampSrc.replace(/\\/g, '/'), to: 'sku.json' },
        ],
        artifactName: `TVC-PMS-${sku}-\${version}-Setup.\${ext}`,
        directories: {
            ...(pkg.build.directories || {}),
            output: 'dist',
        },
        nsis: {
            ...(pkg.build.nsis || {}),
            shortcutName: def.productName,
            include: undefined,
            // Separate Start Menu / uninstall entries per SKU
            uninstallDisplayName: def.productName,
        },
        win: {
            ...(pkg.build.win || {}),
            executableName: def.executableName || def.productName,
        },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

    console.log('\n=== Building', sku, `(${def.productName}) ===\n`);
    run('npx', ['electron-builder', '--win', 'nsis', '--config', cfgPath], {
        TVC_BUILD_SKU: sku,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    });
}

console.log('\nPilot packages written under dist/');
console.log('Packaged apps require a seat license (see docs/seat-license.md).');
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
    for (const f of fs.readdirSync(dist).filter(n => n.endsWith('.exe'))) {
        console.log(' -', f);
    }
}

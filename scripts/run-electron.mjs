/* Launch Electron with TVC_DEV_SKU (and ensure pilot licenses exist) */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sku = process.argv[2] || 'HQ_OFFICE';

spawnSync('node', ['scripts/generate-license-keys.mjs'], { cwd: root, stdio: 'inherit', shell: true });
spawnSync('node', ['scripts/issue-license.mjs', '--all'], { cwd: root, stdio: 'inherit', shell: true });

const r = spawnSync('npx', ['electron', '.'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TVC_DEV_SKU: sku, TVC_BUILD_SKU: sku },
});
process.exit(r.status || 0);

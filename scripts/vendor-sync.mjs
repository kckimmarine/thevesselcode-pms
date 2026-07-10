/**
 * node_modules → vendor/ 복사 (오프라인 배포용)
 * 실행: node scripts/vendor-sync.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');

const MAP = [
    ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
    ['node_modules/exceljs/dist/exceljs.min.js', 'exceljs.min.js'],
    ['node_modules/xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js'],
];

fs.mkdirSync(VENDOR, { recursive: true });
for (const [src, dest] of MAP) {
    const from = path.join(ROOT, src);
    const to = path.join(VENDOR, dest);
    if (!fs.existsSync(from)) {
        console.error(`Missing: ${src} — run npm install first`);
        process.exit(1);
    }
    fs.copyFileSync(from, to);
    console.log(`Copied ${dest}`);
}
console.log('vendor/ sync complete');

/**
 * Build multi-size Windows ICO from extracted company logo PNGs.
 * Title-bar sizes (16/24/32) use desktop-16/32 extracts — not generic SVG atoms.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extractedDir = path.join(root, 'icons', 'extracted');
const src256 = path.join(extractedDir, 'desktop-256.png');
const srcFallback = path.join(root, 'icons', 'company-logo.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function pickExtractedSource(size) {
    const candidates = [
        path.join(extractedDir, `desktop-${size}.png`),
        size === 24 ? path.join(extractedDir, 'desktop-32.png') : null,
        size === 64 ? path.join(extractedDir, 'desktop-64.png') : null,
        src256,
        srcFallback,
    ].filter(Boolean);
    return candidates.find(p => fs.existsSync(p)) || null;
}

async function resizeForTray(size) {
    const picked = pickExtractedSource(size);
    if (!picked) throw new Error(`No logo source for ${size}px`);
    let pipeline = sharp(picked).resize(size, size, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
    }).ensureAlpha();

    if (size <= 32) {
        const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
        const out = Buffer.from(data);
        const cx = (info.width - 1) / 2;
        const cy = (info.height - 1) / 2;
        const r = Math.min(cx, cy) - 0.15;
        for (let y = 0; y < info.height; y++) {
            for (let x = 0; x < info.width; x++) {
                const i = (y * info.width + x) * 4;
                const d = Math.hypot(x - cx, y - cy);
                if (d > r + 0.55) {
                    out[i + 3] = 0;
                } else if (d > r - 0.2) {
                    out[i] = 47;
                    out[i + 1] = 52;
                    out[i + 2] = 63;
                    out[i + 3] = 255;
                } else if (out[i + 3] < 40) {
                    out[i + 3] = 0;
                } else if (out[i + 3] < 200) {
                    out[i + 3] = 255;
                }
            }
        }
        return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    }

    return pipeline.png().toBuffer();
}

async function main() {
    if (!fs.existsSync(src256) && !fs.existsSync(srcFallback)) {
        throw new Error('Missing icons/extracted/desktop-256.png or icons/company-logo.png');
    }

    const outDir = path.join(root, 'icons', 'generated');
    fs.mkdirSync(outDir, { recursive: true });

    const buffers = [];
    for (const size of sizes) {
        const buf = await resizeForTray(size);
        const pngPath = path.join(outDir, `icon-${size}.png`);
        fs.writeFileSync(pngPath, buf);
        buffers.push(buf);
        console.log(`wrote ${path.relative(root, pngPath)} (${buf.length} bytes)`);
    }

    const ico = await pngToIco(buffers);
    const icoPath = path.join(root, 'build', 'icon.ico');
    fs.mkdirSync(path.dirname(icoPath), { recursive: true });
    fs.writeFileSync(icoPath, ico);
    console.log(`wrote ${path.relative(root, icoPath)} (${ico.length} bytes)`);

    const master256 = await resizeForTray(256);
    for (const rel of ['build/icon.png', 'icons/app-icon.png', 'icons/company-logo.png']) {
        fs.writeFileSync(path.join(root, rel), master256);
        console.log(`synced ${rel}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

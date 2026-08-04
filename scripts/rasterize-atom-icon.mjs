/**
 * Rasterize icons/atom-logo.svg → build/icon.png + icons/app-icon.png + build/icon.ico
 * using Electron (already a dependency) so cubic Atom paths stay exact.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'icons', 'atom-logo.svg');
const outPng = path.join(root, 'build', 'icon.png');
const outApp = path.join(root, 'icons', 'app-icon.png');
const outIco = path.join(root, 'build', 'icon.ico');
const helper = path.join(root, 'scripts', '_rasterize-atom-helper.cjs');

fs.mkdirSync(path.join(root, 'build'), { recursive: true });

fs.writeFileSync(helper, `
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = process.env.TVC_SVG;
const out = process.env.TVC_OUT;
const size = 256;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    webPreferences: { offscreen: true },
  });
  const svgText = fs.readFileSync(svg, 'utf8');
  const html = \`<!DOCTYPE html><html><body style="margin:0;background:transparent">
    \${svgText.replace('<svg', '<svg width="\${size}" height="\${size}"')}
  </body></html>\`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 200));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.writeFileSync(out, img.toPNG());
  app.quit();
});
`);

const electronBin = path.join(root, 'node_modules', 'electron', 'cli.js');
const r = spawnSync(process.execPath, [electronBin, helper], {
    cwd: root,
    env: { ...process.env, TVC_SVG: svgPath, TVC_OUT: outPng },
    stdio: 'inherit',
    shell: false,
});
if (r.status !== 0) process.exit(r.status || 1);

fs.copyFileSync(outPng, outApp);

// Minimal ICO wrapping PNG (Vista+)
const png = fs.readFileSync(outPng);
const buf = Buffer.alloc(22 + png.length);
buf.writeUInt16LE(0, 0);
buf.writeUInt16LE(1, 2);
buf.writeUInt16LE(1, 4);
buf[6] = 0; buf[7] = 0; buf[8] = 0; buf[9] = 0;
buf.writeUInt16LE(1, 10);
buf.writeUInt16LE(32, 12);
buf.writeUInt32LE(png.length, 14);
buf.writeUInt32LE(22, 18);
png.copy(buf, 22);
fs.writeFileSync(outIco, buf);

try { fs.unlinkSync(helper); } catch (_) {}
console.log('Rasterized Atom mark →', outPng, outIco);

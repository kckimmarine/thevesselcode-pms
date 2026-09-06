/**
 * Build enriched IMPA catalog JSON + category catalog-page SVGs.
 * Run: node scripts/build-impa-catalog.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pagesDir = join(root, 'data/impa-catalog-pages');

const CATEGORY_PAGE = {
  Rigging: 'rigging.svg',
  Paint: 'paint.svg',
  Lubricants: 'lubricants.svg',
  Engine: 'engine.svg',
  Safety: 'safety.svg',
  Piping: 'piping.svg',
  Fasteners: 'fasteners.svg',
  Electrical: 'electrical.svg',
  Cleaning: 'cleaning.svg',
};

const BASE = [
  { code: '330101', name: 'Rope Manila 32mm', unit: 'COIL', category: 'Rigging', rob: 4 },
  { code: '330102', name: 'Wire Rope 12mm Galvanized', unit: 'MTR', category: 'Rigging', rob: 120 },
  { code: '330201', name: 'Shackle Bow Type 25T', unit: 'PCS', category: 'Rigging', rob: 12 },
  { code: '330301', name: 'Paint Antifouling Red', unit: 'LTR', category: 'Paint', rob: 80 },
  { code: '330302', name: 'Paint Primer Epoxy Grey', unit: 'LTR', category: 'Paint', rob: 45 },
  { code: '330401', name: 'Brush Paint 100mm', unit: 'PCS', category: 'Paint', rob: 24 },
  { code: '330501', name: 'Grease Multi-Purpose NLGI 2', unit: 'KG', category: 'Lubricants', rob: 36 },
  { code: '330502', name: 'Hydraulic Oil ISO 46', unit: 'LTR', category: 'Lubricants', rob: 200 },
  { code: '330601', name: 'Filter Oil Engine', unit: 'PCS', category: 'Engine', rob: 6 },
  { code: '330602', name: 'Filter Fuel Primary', unit: 'PCS', category: 'Engine', rob: 4 },
  { code: '330701', name: 'Gasket Set Cylinder Head', unit: 'SET', category: 'Engine', rob: 1 },
  { code: '330801', name: 'Belt V-Type A-65', unit: 'PCS', category: 'Engine', rob: 3 },
  { code: '330901', name: 'Safety Helmet White', unit: 'PCS', category: 'Safety', rob: 18 },
  { code: '330902', name: 'Safety Gloves Leather', unit: 'PR', category: 'Safety', rob: 30 },
  { code: '331001', name: 'Life Jacket SOLAS', unit: 'PCS', category: 'Safety', rob: 28 },
  { code: '331101', name: 'Fire Extinguisher CO2 5kg', unit: 'PCS', category: 'Safety', rob: 8 },
  { code: '331201', name: 'Valve Gate Bronze 50mm', unit: 'PCS', category: 'Piping', rob: 5 },
  { code: '331202', name: 'Flange Blind 50mm', unit: 'PCS', category: 'Piping', rob: 4 },
  { code: '331301', name: 'Bolt Hex M16 x 60', unit: 'PCS', category: 'Fasteners', rob: 150 },
  { code: '331302', name: 'Nut Hex M16', unit: 'PCS', category: 'Fasteners', rob: 160 },
  { code: '331401', name: 'Electrical Cable 3C 2.5mm²', unit: 'MTR', category: 'Electrical', rob: 250 },
  { code: '331402', name: 'Lamp Fluorescent 20W', unit: 'PCS', category: 'Electrical', rob: 20 },
  { code: '331501', name: 'Cleaning Compound Degreaser', unit: 'LTR', category: 'Cleaning', rob: 60 },
  { code: '331502', name: 'Rag Cotton Industrial', unit: 'KG', category: 'Cleaning', rob: 25 },
];

function specsFor(item) {
  const cat = item.category;
  const common = { 'IMPA Edition': '7th', 'Catalog Section': cat };
  if (cat === 'Rigging') {
    return { ...common, 'Material': item.name.includes('Wire') ? 'Galvanized steel' : 'Manila hemp', 'Standard': 'ISO 1140 / ISO 2408' };
  }
  if (cat === 'Paint') {
    return { ...common, 'Finish': item.name.includes('Antifouling') ? 'Matte antifouling' : 'Epoxy primer', 'Coverage': '8–10 m²/L', 'VOC': '< 400 g/L' };
  }
  if (cat === 'Lubricants') {
    return { ...common, 'Grade': item.name.includes('ISO') ? 'ISO VG 46' : 'NLGI 2', 'Operating Temp': '-20°C to +120°C' };
  }
  if (cat === 'Engine') {
    return { ...common, 'Application': item.name.includes('Filter') ? 'Primary filtration' : 'OEM replacement', 'Service Interval': 'Per PMS' };
  }
  if (cat === 'Safety') {
    return { ...common, 'Certification': item.name.includes('SOLAS') ? 'SOLAS / MED' : 'ISO 12402', 'Colour': item.name.includes('White') ? 'White' : 'Standard' };
  }
  if (cat === 'Piping') {
    return { ...common, 'Nominal Size': 'DN50 (2")', 'Pressure Class': 'PN16', 'Body Material': 'Bronze / Steel' };
  }
  if (cat === 'Fasteners') {
    return { ...common, 'Thread': 'M16 × 2.0', 'Length': item.name.includes('Bolt') ? '60 mm' : '—', 'Grade': '8.8 / A4-80' };
  }
  if (cat === 'Electrical') {
    return { ...common, 'Voltage': '220 V AC', 'Insulation': item.name.includes('Cable') ? 'PVC 3C' : '—', 'Rating': item.name.includes('Lamp') ? '20 W' : '2.5 mm²' };
  }
  return { ...common, 'Form': 'Liquid / bulk', 'Flash Point': '> 60°C', 'Dilution': 'Ready to use' };
}

function catalogSvg(category, filename) {
  const title = category.toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 880" role="img" aria-label="${title} catalog plate">
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#c5d4e8" stroke-width="0.6"/>
    </pattern>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8f4ea"/>
      <stop offset="100%" stop-color="#ebe4d4"/>
    </linearGradient>
  </defs>
  <rect width="640" height="880" fill="url(#paper)"/>
  <rect x="24" y="24" width="592" height="832" fill="none" stroke="#1a365d" stroke-width="3"/>
  <rect x="40" y="40" width="560" height="120" fill="#1a365d"/>
  <text x="320" y="88" text-anchor="middle" fill="#f7fafc" font-family="Georgia, serif" font-size="28" font-weight="700">IMPA CATALOG PLATE</text>
  <text x="320" y="118" text-anchor="middle" fill="#bee3f8" font-family="ui-monospace, monospace" font-size="14" letter-spacing="4">${title}</text>
  <rect x="48" y="180" width="544" height="520" fill="url(#grid)" stroke="#2b6cb0" stroke-width="2"/>
  <circle cx="320" cy="440" r="140" fill="none" stroke="#2d3748" stroke-width="2" stroke-dasharray="8 6"/>
  <line x1="180" y1="440" x2="460" y2="440" stroke="#2d3748" stroke-width="1.5"/>
  <line x1="320" y1="300" x2="320" y2="580" stroke="#2d3748" stroke-width="1.5"/>
  <text x="320" y="450" text-anchor="middle" fill="#4a5568" font-family="Georgia, serif" font-size="22">TECHNICAL ILLUSTRATION</text>
  <text x="320" y="478" text-anchor="middle" fill="#718096" font-family="ui-monospace, monospace" font-size="12">SCALE 1:5 · DIM. IN mm UNLESS NOTED</text>
  <rect x="48" y="720" width="544" height="120" fill="#edf2f7" stroke="#a0aec0" stroke-width="1"/>
  <text x="64" y="752" fill="#2d3748" font-family="ui-monospace, monospace" font-size="11">REF: ${filename.replace('.svg', '').toUpperCase()}</text>
  <text x="64" y="776" fill="#4a5568" font-family="ui-sans-serif, system-ui" font-size="12">Space-Marine style specification sheet · THE VESSEL CODE STORE</text>
  <text x="64" y="800" fill="#718096" font-family="ui-sans-serif, system-ui" font-size="11">Dimensions and tolerances per manufacturer datasheet.</text>
  <text x="64" y="824" fill="#718096" font-family="ui-sans-serif, system-ui" font-size="11">Verify onboard stock (ROB) before requisition.</text>
</svg>`;
}

mkdirSync(pagesDir, { recursive: true });
for (const [cat, file] of Object.entries(CATEGORY_PAGE)) {
  writeFileSync(join(pagesDir, file), catalogSvg(cat, file), 'utf8');
}

const catalog = BASE.map(item => ({
  impa_code: item.code,
  code: item.code,
  name: item.name,
  unit: item.unit,
  category: item.category,
  rob: item.rob,
  catalog_page: `/data/impa-catalog-pages/${CATEGORY_PAGE[item.category]}`,
  specs: specsFor(item),
}));

writeFileSync(join(root, 'data/impa-catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');

const tsLines = [
  '/** IMPA STORE seed — generated by scripts/build-impa-catalog.mjs */',
  'export type ImpaSeedItem = {',
  '  impa_code: string;',
  '  code: string;',
  '  name: string;',
  '  unit: string;',
  '  category: string;',
  '  rob: number;',
  '  catalog_page: string;',
  '  specs: Record<string, string>;',
  '};',
  '',
  `export const IMPA_SEED: ImpaSeedItem[] = ${JSON.stringify(catalog, null, 2)};`,
  '',
];
writeFileSync(join(root, 'data/seed-data.ts'), tsLines.join('\n'), 'utf8');
console.log(`Wrote ${catalog.length} items and ${Object.keys(CATEGORY_PAGE).length} catalog pages.`);

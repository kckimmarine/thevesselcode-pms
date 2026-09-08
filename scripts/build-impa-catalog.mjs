/**
 * Build enriched IMPA catalog JSON + Space-Marine style plate SVGs.
 * Run: node scripts/build-impa-catalog.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pagesDir = join(root, 'data/impa-catalog-pages');
const platesDir = join(root, 'data/impa-plates');
const itemsDir = join(platesDir, 'items');

const CATEGORY_PAGE = {
  Rigging: 'rigging.svg',
  Paint: 'paint.svg',
  Lubricants: 'lubricants.svg',
  Engine: 'engine.svg',
  Safety: 'safety.svg',
  'Safety & Fire Fighting': 'safety.svg',
  Piping: 'piping.svg',
  'Valves & Cocks': 'piping.svg',
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
  { code: '590101', name: 'Fire Hose Synthetic 2.5" x 20m with couplings', unit: 'PCS', category: 'Safety & Fire Fighting', rob: 4 },
  { code: '590203', name: 'Fog/Jet Fire Nozzle 65A (Dual Purpose)', unit: 'PCS', category: 'Safety & Fire Fighting', rob: 6 },
  { code: '590705', name: 'SCBA Self-Contained Breathing Apparatus 300 Bar', unit: 'SET', category: 'Safety & Fire Fighting', rob: 4 },
  { code: '591211', name: 'EEBD Emergency Escape Breathing Device 15 Min', unit: 'PCS', category: 'Safety & Fire Fighting', rob: 12 },
  { code: '591720', name: 'Immersion Suit Insulated (SOLAS/MED approved)', unit: 'PCS', category: 'Safety & Fire Fighting', rob: 6 },
  { code: '812101', name: 'JIS Cast Iron Globe Valve 10K 50A Flanged', unit: 'PCS', category: 'Valves & Cocks', rob: 2 },
  { code: '812105', name: 'JIS Cast Iron Globe Valve 10K 100A Flanged', unit: 'PCS', category: 'Valves & Cocks', rob: 1 },
  { code: '812204', name: 'JIS Cast Iron Angle Valve 10K 80A Flanged', unit: 'PCS', category: 'Valves & Cocks', rob: 2 },
  { code: '812312', name: 'Cast Steel Gate Valve 10K 150A Flanged', unit: 'PCS', category: 'Valves & Cocks', rob: 1 },
  { code: '812851', name: 'Bronze Screw-Down Check Valve 16K 25A', unit: 'PCS', category: 'Valves & Cocks', rob: 3 },
];

function derivePlateNo(code) {
  const c = String(code || '').replace(/\D/g, '').padStart(6, '0');
  if (c.length < 4) return '';
  return `PL-${c.slice(0, 2)}-${c.slice(2, 4)}`;
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function specsFor(item) {
  const cat = item.category;
  const common = {
    'IMPA Edition': '7th',
    'Catalog Section': cat,
    Material: 'Per manufacturer datasheet',
    Standard: 'IMPA / ISO marine supply',
  };

  if (cat === 'Rigging') {
    const isWire = item.name.includes('Wire');
    const isShackle = item.name.includes('Shackle');
    return {
      ...common,
      Dimensions: isWire ? 'Ø12 mm × coil' : (isShackle ? 'WLL 25 t · bow type' : 'Ø32 mm × 220 m coil'),
      Material: isWire ? 'Galvanized steel wire' : (isShackle ? 'Alloy steel, hot-dip galvanized' : 'Manila hemp 3-strand'),
      Standard: 'ISO 1140 / ISO 2408',
      'Breaking Load': isWire ? '≥ 78 kN' : (isShackle ? 'SWL 25 t' : '≥ 32 kN'),
    };
  }
  if (cat === 'Paint') {
    const isBrush = item.name.includes('Brush');
    return {
      ...common,
      Dimensions: isBrush ? '100 mm bristle width' : '20 L pail',
      Material: isBrush ? 'Hog bristle / hardwood handle' : 'Marine-grade coating',
      Finish: item.name.includes('Antifouling') ? 'Matte antifouling' : (item.name.includes('Primer') ? 'Epoxy primer' : 'Application tool'),
      Standard: 'IMO PSPC / ISO 12944',
      Coverage: isBrush ? '—' : '8–10 m²/L',
      VOC: isBrush ? '—' : '< 400 g/L',
    };
  }
  if (cat === 'Lubricants') {
    const isOil = item.name.includes('ISO');
    return {
      ...common,
      Dimensions: isOil ? '208 L drum / bulk' : '18 kg pail',
      Material: isOil ? 'Mineral hydraulic base oil' : 'Lithium complex grease',
      Grade: isOil ? 'ISO VG 46' : 'NLGI 2',
      Standard: isOil ? 'ISO 6743-4 / DIN 51524' : 'NLGI GC-LB',
      'Operating Temp': '-20°C to +120°C',
    };
  }
  if (cat === 'Engine') {
    const isFilter = item.name.includes('Filter');
    const isBelt = item.name.includes('Belt');
    const isGasket = item.name.includes('Gasket');
    return {
      ...common,
      Dimensions: isFilter ? 'OEM spin-on cartridge' : (isBelt ? 'A-65 V-belt profile' : (isGasket ? 'Cylinder head set' : 'OEM fit')),
      Material: isFilter ? 'Cellulose / synthetic media' : (isBelt ? 'Chloroprene rubber' : 'Multi-layer steel & composite'),
      Voltage: '—',
      Standard: 'OEM / ISO 4548 (filters)',
      Application: isFilter ? 'Engine lube / fuel filtration' : 'OEM replacement',
      'Service Interval': 'Per PMS running hours',
    };
  }
  if (cat === 'Safety' || cat === 'Safety & Fire Fighting') {
    const isSol = item.name.includes('SOLAS');
    const isCo2 = item.name.includes('CO2');
    const isHose = item.name.includes('Fire Hose');
    const isNozzle = item.name.includes('Nozzle');
    const isScba = item.name.includes('SCBA');
    const isEebd = item.name.includes('EEBD');
    const isSuit = item.name.includes('Immersion');
    return {
      ...common,
      Dimensions: isHose ? '2.5" × 20 m with couplings' : (isNozzle ? '65A dual-purpose fog/jet' : (isScba ? '300 bar cylinder / full face mask' : (isEebd ? '15 min duration' : (isSuit ? 'Adult universal · insulated' : (isCo2 ? 'CO₂ 5 kg portable' : 'Standard size'))))),
      Material: isHose ? 'Synthetic rubber lined' : (isScba || isEebd ? 'Composite cylinder / demand valve' : (isSuit ? 'Neoprene / nylon outer' : (isCo2 ? 'Steel cylinder / brass valve' : (item.name.includes('Gloves') ? 'Split leather' : 'ABS / HDPE shell')))),
      Standard: isSol || isSuit ? 'SOLAS / MED' : (isScba || isEebd ? 'EN 137 / SOLAS' : (isCo2 ? 'EN 3 / MED' : (isHose ? 'EN 14540 / ISO 14557' : 'ISO 12402'))),
      Certification: isSol || isSuit ? 'SOLAS Ch. III' : (isScba ? 'EN 137 Type 2' : (isEebd ? 'SOLAS Ch. II-2' : 'ISO / CE marked')),
      Rating: isHose ? '2.5" working pressure' : (isNozzle ? '65A jet/fog' : '—'),
      Voltage: '—',
    };
  }
  if (cat === 'Valves & Cocks') {
    const isGlobe = item.name.includes('Globe');
    const isAngle = item.name.includes('Angle');
    const isGate = item.name.includes('Gate');
    const isCheck = item.name.includes('Check');
    const rating = item.name.includes('16K') ? 'JIS 16K' : 'JIS 10K';
    const sizeMatch = item.name.match(/(\d+)A/);
    const size = sizeMatch ? `${sizeMatch[1]}A` : '—';
    return {
      ...common,
      Dimensions: `${size} flanged · face-to-face per JIS B2220`,
      Material: isCheck ? 'Bronze body' : (isGate ? 'Cast steel body' : 'Cast iron body'),
      Standard: 'JIS B2220 / JIS F 7300',
      Rating: rating,
      'Body Material': isCheck ? 'Bronze' : (isGate ? 'Cast steel' : 'Cast iron'),
      'End Connection': 'Flanged RF',
      Type: isGlobe ? 'Globe' : (isAngle ? 'Angle' : (isGate ? 'Gate' : 'Check (screw-down)')),
    };
  }
  if (cat === 'Piping') {
    return {
      ...common,
      Dimensions: 'DN50 (2") · face-to-face 180 mm',
      Material: 'Bronze body / stainless trim',
      Standard: 'ISO 7005 / PN16',
      'Pressure Class': 'PN16',
      'Body Material': 'Bronze / gunmetal',
    };
  }
  if (cat === 'Fasteners') {
    const isBolt = item.name.includes('Bolt');
    return {
      ...common,
      Dimensions: isBolt ? 'M16 × 60 mm hex' : 'M16 hex nut',
      Material: 'Alloy steel, zinc plated',
      Standard: 'ISO 4014 / DIN 931',
      Thread: 'M16 × 2.0',
      Grade: '8.8 / A4-80',
    };
  }
  if (cat === 'Electrical') {
    const isCable = item.name.includes('Cable');
    return {
      ...common,
      Dimensions: isCable ? '3C × 2.5 mm²' : 'T8 20 W tube',
      Material: isCable ? 'Copper conductor, PVC sheath' : 'Glass tube / phosphor coating',
      Voltage: '220 V AC / 60 Hz',
      Standard: 'IEC 60227 / IEC 60092',
      Insulation: isCable ? 'PVC 3-core' : '—',
      Rating: isCable ? '2.5 mm² / 20 A' : '20 W',
    };
  }
  return {
    ...common,
    Dimensions: 'Bulk liquid',
    Material: 'Industrial degreaser base',
    Standard: 'IMO / MARPOL compliant',
    'Flash Point': '> 60°C',
    Form: 'Ready to use',
  };
}

function categoryIllustration(category) {
  switch (category) {
    case 'Rigging':
      return `
        <path d="M200 420 Q280 360 360 420 Q440 480 520 420" fill="none" stroke="#2d3748" stroke-width="3"/>
        <ellipse cx="360" cy="420" rx="28" ry="18" fill="none" stroke="#2d3748" stroke-width="2"/>
        <line x1="160" y1="420" x2="560" y2="420" stroke="#718096" stroke-width="1" stroke-dasharray="4 3"/>
        <text x="360" y="405" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#4a5568">Ø / WLL</text>`;
    case 'Paint':
      return `
        <rect x="300" y="360" width="120" height="140" rx="8" fill="none" stroke="#2d3748" stroke-width="2"/>
        <rect x="330" y="330" width="60" height="36" rx="4" fill="#c53030" stroke="#2d3748" stroke-width="1.5"/>
        <line x1="250" y1="500" x2="470" y2="500" stroke="#718096" stroke-width="1"/>`;
    case 'Electrical':
      return `
        <path d="M180 460 L300 380 L420 460 L540 380" fill="none" stroke="#2d3748" stroke-width="2.5"/>
        <circle cx="300" cy="380" r="6" fill="#2b6cb0"/>
        <circle cx="420" cy="460" r="6" fill="#2b6cb0"/>
        <text x="360" y="520" text-anchor="middle" font-size="11" fill="#4a5568" font-family="ui-monospace,monospace">220V 3C</text>`;
    case 'Engine':
      return `
        <rect x="280" y="360" width="160" height="120" rx="6" fill="none" stroke="#2d3748" stroke-width="2"/>
        <circle cx="360" cy="420" r="36" fill="none" stroke="#2d3748" stroke-width="1.5"/>
        <line x1="324" y1="420" x2="396" y2="420" stroke="#718096" stroke-width="1"/>
        <line x1="360" y1="384" x2="360" y2="456" stroke="#718096" stroke-width="1"/>`;
    default:
      return `
        <circle cx="360" cy="430" r="90" fill="none" stroke="#2d3748" stroke-width="2" stroke-dasharray="8 6"/>
        <line x1="270" y1="430" x2="450" y2="430" stroke="#718096" stroke-width="1"/>
        <line x1="360" y1="340" x2="360" y2="520" stroke="#718096" stroke-width="1"/>`;
  }
}

function itemPlateSvg(item, plateNo, specs) {
  const title = escXml(item.category.toUpperCase());
  const name = escXml(item.name);
  const code = escXml(item.code);
  const dim = escXml(specs.Dimensions || '—');
  const mat = escXml(specs.Material || '—');
  const std = escXml(specs.Standard || '—');
  const illus = categoryIllustration(item.category);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 960" role="img" aria-label="${name} catalog plate">
  <defs>
    <pattern id="grid-${code}" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#c5d4e8" stroke-width="0.5"/>
    </pattern>
    <linearGradient id="paper-${code}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8f4ea"/>
      <stop offset="100%" stop-color="#e8dfd0"/>
    </linearGradient>
  </defs>
  <rect width="720" height="960" fill="url(#paper-${code})"/>
  <rect x="20" y="20" width="680" height="920" fill="none" stroke="#1a365d" stroke-width="4"/>
  <rect x="36" y="36" width="648" height="110" fill="#1a365d"/>
  <text x="360" y="78" text-anchor="middle" fill="#f7fafc" font-family="Georgia, serif" font-size="26" font-weight="700">IMPA CATALOG PLATE</text>
  <text x="360" y="108" text-anchor="middle" fill="#bee3f8" font-family="ui-monospace, monospace" font-size="13" letter-spacing="3">${title} · ${escXml(plateNo)}</text>
  <text x="48" y="175" fill="#2d3748" font-family="ui-monospace,monospace" font-size="14" font-weight="700">IMPA ${code}</text>
  <text x="48" y="198" fill="#4a5568" font-family="Georgia,serif" font-size="16">${name}</text>
  <rect x="40" y="220" width="640" height="500" fill="url(#grid-${code})" stroke="#2b6cb0" stroke-width="2"/>
  ${illus}
  <text x="360" y="560" text-anchor="middle" fill="#4a5568" font-family="Georgia, serif" font-size="18">TECHNICAL ILLUSTRATION</text>
  <text x="360" y="586" text-anchor="middle" fill="#718096" font-family="ui-monospace, monospace" font-size="11">SCALE 1:5 · DIM. IN mm UNLESS NOTED</text>
  <line x1="120" y1="620" x2="220" y2="620" stroke="#2d3748" stroke-width="1"/>
  <text x="230" y="624" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">${dim}</text>
  <line x1="400" y1="650" x2="500" y2="650" stroke="#2d3748" stroke-width="1"/>
  <text x="510" y="654" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">${mat}</text>
  <rect x="40" y="740" width="640" height="180" fill="#edf2f7" stroke="#a0aec0" stroke-width="1"/>
  <text x="56" y="772" fill="#1a365d" font-family="ui-monospace,monospace" font-size="12" font-weight="700">SPECIFICATION DATASHEET</text>
  <text x="56" y="798" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">DIMENSIONS: ${dim}</text>
  <text x="56" y="820" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">MATERIAL: ${mat}</text>
  <text x="56" y="842" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">STANDARD: ${std}</text>
  <text x="56" y="872" fill="#718096" font-family="ui-sans-serif,system-ui" font-size="10">THE VESSEL CODE STORE · Space-Marine specification sheet</text>
  <text x="56" y="894" fill="#718096" font-family="ui-sans-serif,system-ui" font-size="10">Verify onboard ROB before requisition.</text>
</svg>`;
}

function catalogSvg(category, filename, plateNo) {
  const title = category.toUpperCase();
  const ref = plateNo || filename.replace('.svg', '').toUpperCase();
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
  ${categoryIllustration(category)}
  <text x="320" y="450" text-anchor="middle" fill="#4a5568" font-family="Georgia, serif" font-size="22">TECHNICAL ILLUSTRATION</text>
  <rect x="48" y="720" width="544" height="120" fill="#edf2f7" stroke="#a0aec0" stroke-width="1"/>
  <text x="64" y="752" fill="#2d3748" font-family="ui-monospace, monospace" font-size="11">PLATE: ${ref}</text>
</svg>`;
}

mkdirSync(pagesDir, { recursive: true });
mkdirSync(platesDir, { recursive: true });
mkdirSync(itemsDir, { recursive: true });

for (const [cat, file] of Object.entries(CATEGORY_PAGE)) {
  writeFileSync(join(pagesDir, file), catalogSvg(cat, file), 'utf8');
}

const catalog = BASE.map(item => {
  const plate_id = derivePlateNo(item.code);
  const specs = specsFor(item);
  writeFileSync(join(itemsDir, `${item.code}.svg`), itemPlateSvg(item, plate_id, specs), 'utf8');
  return {
    impa_code: item.code,
    code: item.code,
    name: item.name,
    unit: item.unit,
    category: item.category,
    rob: item.rob,
    plate_id,
    plate_no: plate_id,
    specs,
  };
});

const plateNos = new Map();
for (const item of catalog) {
  if (!item.plate_no) continue;
  if (!plateNos.has(item.plate_no)) plateNos.set(item.plate_no, item.category);
}
for (const [plateNo, category] of plateNos) {
  writeFileSync(join(platesDir, `${plateNo}.svg`), catalogSvg(category, `${plateNo}.svg`, plateNo), 'utf8');
}

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
  '  plate_id: string;',
  '  plate_no: string;',
  '  specs: Record<string, string>;',
  '};',
  '',
  `export const IMPA_SEED: ImpaSeedItem[] = ${JSON.stringify(catalog, null, 2)};`,
  '',
];
writeFileSync(join(root, 'data/seed-data.ts'), tsLines.join('\n'), 'utf8');
console.log(`Wrote ${catalog.length} items, ${catalog.length} item plates, ${plateNos.size} shared plates.`);

const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts');
const FINDINGS_FILE = path.join(ARTIFACT_DIR, 'findings.json');
const SCREEN_DIR = path.join(ARTIFACT_DIR, 'screenshots');

function ensureDirs() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
}

function emptyStore() {
  return {
    startedAt: new Date().toISOString(),
    findings: [],
    steps: [],
    consoleErrors: [],
    pageErrors: [],
  };
}

function load() {
  ensureDirs();
  if (!fs.existsSync(FINDINGS_FILE)) return emptyStore();
  try {
    return JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
  } catch {
    return emptyStore();
  }
}

function save(store) {
  ensureDirs();
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(FINDINGS_FILE, JSON.stringify(store, null, 2));
}

function reset() {
  ensureDirs();
  save(emptyStore());
}

function addFinding(finding) {
  const store = load();
  store.findings.push({
    at: new Date().toISOString(),
    severity: finding.severity || 'bug',
    category: finding.category || 'general',
    title: finding.title,
    detail: finding.detail || '',
    screenshot: finding.screenshot || '',
    viewport: finding.viewport || '',
    account: finding.account || '',
  });
  save(store);
}

function addStep(step) {
  const store = load();
  store.steps.push({ at: new Date().toISOString(), ...step });
  save(store);
}

function addConsoleError(entry) {
  const store = load();
  store.consoleErrors.push({ at: new Date().toISOString(), ...entry });
  save(store);
}

function addPageError(entry) {
  const store = load();
  store.pageErrors.push({ at: new Date().toISOString(), ...entry });
  save(store);
}

function screenshotPath(name) {
  ensureDirs();
  const safe = String(name).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(SCREEN_DIR, safe.endsWith('.png') ? safe : `${safe}.png`);
}

function relScreenshot(absPath) {
  return path.relative(path.join(__dirname, '..', '..'), absPath).replace(/\\/g, '/');
}

module.exports = {
  ARTIFACT_DIR,
  FINDINGS_FILE,
  SCREEN_DIR,
  ensureDirs,
  load,
  save,
  reset,
  addFinding,
  addStep,
  addConsoleError,
  addPageError,
  screenshotPath,
  relScreenshot,
};

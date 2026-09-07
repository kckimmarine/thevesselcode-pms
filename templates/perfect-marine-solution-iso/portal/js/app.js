import { getSession, signIn, signOut, onAuthChange } from './auth.js';
import {
  listDocuments,
  upsertDocument,
  listCars,
  upsertCar,
  listChecklist,
  setChecklistItem,
  listEvidence,
  uploadEvidence,
  evidenceDownloadUrl,
} from './db.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function showView(name) {
  $$('[data-view]').forEach((el) => el.classList.toggle('hidden', el.dataset.view !== name));
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === name));
}

async function renderDashboard() {
  const [docs, cars, checklist, evidence] = await Promise.all([
    listDocuments(),
    listCars(),
    listChecklist(),
    listEvidence(),
  ]);
  const openCars = cars.filter((c) => c.status !== 'closed').length;
  const doneCheck = checklist.filter((c) => c.completed).length;
  $('#stat-docs').textContent = docs.length;
  $('#stat-cars').textContent = openCars;
  $('#stat-checklist').textContent = `${doneCheck}/${checklist.length}`;
  $('#stat-evidence').textContent = evidence.length;
}

async function renderDocuments() {
  const docs = await listDocuments();
  const tbody = $('#doc-table tbody');
  tbody.innerHTML = docs
    .map(
      (d) => `<tr>
        <td>${esc(d.doc_id)}</td>
        <td>${esc(d.title)}</td>
        <td>${esc(d.doc_type)}</td>
        <td>${esc(d.revision)}</td>
        <td>${esc(d.status)}</td>
      </tr>`
    )
    .join('');
}

async function renderChecklist() {
  const items = await listChecklist();
  const root = $('#checklist-root');
  root.innerHTML = items
    .map(
      (it) => `<label class="check-row">
        <input type="checkbox" data-key="${esc(it.item_key)}" ${it.completed ? 'checked' : ''} />
        <span>${esc(it.label)}</span>
        <input type="text" class="check-note" data-note="${esc(it.item_key)}" placeholder="메모" value="${esc(it.notes || '')}" />
      </label>`
    )
    .join('');
  root.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const key = cb.dataset.key;
      const note = root.querySelector(`[data-note="${key}"]`)?.value || '';
      await setChecklistItem(key, cb.checked, note);
      renderDashboard().catch(console.error);
    });
  });
}

async function renderCars() {
  const cars = await listCars();
  const tbody = $('#car-table tbody');
  tbody.innerHTML = cars
    .map(
      (c) => `<tr>
        <td>${esc(c.car_id)}</td>
        <td>${esc(c.title)}</td>
        <td>${esc(c.source)}</td>
        <td>${esc(c.status)}</td>
      </tr>`
    )
    .join('');
}

async function renderEvidence() {
  const rows = await listEvidence();
  const tbody = $('#evidence-table tbody');
  tbody.innerHTML = rows
    .map(
      (e) => `<tr>
        <td>${esc(e.filename)}</td>
        <td>${esc(e.description)}</td>
        <td>${esc(e.audit_clause)}</td>
        <td><button type="button" class="btn-link" data-dl="${esc(e.storage_path)}">다운로드</button></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('[data-dl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = await evidenceDownloadUrl(btn.dataset.dl);
      window.open(url, '_blank');
    });
  });
}

function bindForms() {
  $('#doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await upsertDocument({
      doc_id: fd.get('doc_id'),
      title: fd.get('title'),
      doc_type: fd.get('doc_type'),
      revision: fd.get('revision') || '0.1',
      status: fd.get('status') || 'draft',
      folder: fd.get('folder') || '',
    });
    e.target.reset();
    await renderDocuments();
    await renderDashboard();
  });

  $('#car-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await upsertCar({
      car_id: fd.get('car_id'),
      title: fd.get('title'),
      source: fd.get('source'),
      status: fd.get('status') || 'open',
      description: fd.get('description') || '',
    });
    e.target.reset();
    await renderCars();
    await renderDashboard();
  });

  $('#evidence-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('file');
    if (!file || !file.size) return alert('파일을 선택하세요.');
    await uploadEvidence(file, {
      description: fd.get('description'),
      audit_clause: fd.get('audit_clause'),
    });
    e.target.reset();
    await renderEvidence();
    await renderDashboard();
  });
}

async function refreshAll() {
  await Promise.all([renderDashboard(), renderDocuments(), renderChecklist(), renderCars(), renderEvidence()]);
}

async function bootAuthed() {
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  const session = await getSession();
  $('#user-email').textContent = session?.user?.email || '';
  await refreshAll();
}

async function boot() {
  bindForms();
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.nav));
  });
  $('#logout-btn').addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await signIn(fd.get('email'), fd.get('password'));
      await bootAuthed();
    } catch (err) {
      $('#login-error').textContent = err.message || '로그인 실패';
    }
  });

  try {
    const session = await getSession();
    if (session) await bootAuthed();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }

  onAuthChange((session) => {
    if (!session) {
      $('#app-shell').classList.add('hidden');
      $('#login-screen').classList.remove('hidden');
    }
  });
}

boot();

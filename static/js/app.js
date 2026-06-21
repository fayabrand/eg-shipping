/* EG Shipping Receiver — Frontend JS */

let state = { boxes: [], nextId: 1 };
let searchHistory = JSON.parse(localStorage.getItem('eg-lookup-history') || '[]');

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const oc  = o => o === 'other' ? 'other-c' : o;

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cl-date').value = new Date().toISOString().split('T')[0];
  loadState().then(() => { renderBoxes(); updateNavStats(); });
});

async function loadState() {
  const res = await fetch('/api/boxes');
  state = await res.json();
}

function updateNavStats() {
  const boxes = state.boxes;
  const total = boxes.reduce((a, b) => a + b.items.length, 0);
  document.getElementById('nav-stats').innerHTML = `
    <div><div class="nav-stat-val">${boxes.length}</div><div>boxes</div></div>
    <div><div class="nav-stat-val">${total}</div><div>items</div></div>
    <div><div class="nav-stat-val">${boxes.filter(b => b.status==='open').length}</div><div>open</div></div>`;
}

/* ── TAB SWITCHING ── */
function switchTab(name) {
  const names = ['boxes','scan','lookup','export','backup','reports'];
  document.querySelectorAll('.nav-btn').forEach((b, i) => b.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'scan') populateBoxSelect();
  if (name === 'export') populateExportSelects();
  if (name === 'backup') loadBackups();
  if (name === 'reports') renderReports();
  if (name === 'lookup') { renderHistory(); setTimeout(() => document.getElementById('lookup-input').focus(), 80); }
}

/* ══════════════════════════════
   BOXES
══════════════════════════════ */
async function createBox() {
  const name = document.getElementById('cl-name').value.trim();
  if (!name) { alert('Please enter client name'); return; }
  const box = {
    client: name,
    phone: document.getElementById('cl-phone').value.trim(),
    type: document.getElementById('cl-type').value,
    origin: document.getElementById('cl-origin').value,
    category: document.getElementById('cl-cat').value,
    date: document.getElementById('cl-date').value,
  };
  const res = await fetch('/api/boxes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(box) });
  const created = await res.json();
  state.boxes.unshift(created);
  renderBoxes(); updateNavStats();
  document.getElementById('cl-name').value = '';
  document.getElementById('cl-phone').value = '';
}

function renderBoxes() {
  const q = (document.getElementById('search-boxes').value || '').toLowerCase();
  const boxes = state.boxes.filter(b => !q || b.client.toLowerCase().includes(q) || b.id.toLowerCase().includes(q));
  const el = document.getElementById('box-list');
  if (!boxes.length) { el.innerHTML = '<div class="empty">No boxes found.</div>'; return; }
  el.innerHTML = boxes.map(b => `
    <div class="box-card">
      <div class="box-card-header" onclick="toggleBox('${b.id}')">
        <span style="font-size:20px">${b.type === 'bag' ? '🛍' : '📦'}</span>
        <div>
          <div class="box-name">${b.id} — ${b.client}</div>
          <div class="box-meta">${b.date}${b.phone ? ' · ' + b.phone : ''}</div>
        </div>
        <span class="badge ${b.category}">${cap(b.category)}</span>
        <span class="badge ${oc(b.origin)}">${b.origin.toUpperCase()}</span>
        <span class="badge ${b.status}">${b.status}</span>
        <span class="muted" style="font-size:12px">${b.items.length} items</span>
        <span class="chevron" id="chev-${b.id}">▾</span>
      </div>
      <div class="box-actions">
        <button class="btn sm danger" onclick="closeBox('${b.id}')" ${b.status==='closed'?'disabled':''}>Close</button>
        <button class="btn sm" onclick="printBoxById('${b.id}')">🖨️ Print</button>
        <button class="btn sm success" onclick="exportBoxById('${b.id}')">📊 Excel</button>
        <button class="btn sm danger" onclick="deleteBox('${b.id}')" style="display:${b.status==='closed'?'none':'inline-flex'}">🗑 Delete</button>
      </div>
      <div class="box-body" id="body-${b.id}">
        ${b.items.length
          ? `<div class="items-list">${b.items.map(it => `
            <div class="item-row">
              <span class="item-barcode">${it.barcode}</span>
              <span class="item-name">${it.desc || '—'}</span>
              <span class="badge ${it.cat}">${cap(it.cat)}</span>
              <span class="badge ${oc(it.origin)}">${it.origin.toUpperCase()}</span>
              <span class="muted" style="font-size:11px">${it.time}</span>
              <button class="btn sm danger" onclick="removeItem('${b.id}','${it.barcode}')">🗑</button>
            </div>`).join('')}</div>`
          : '<div class="empty" style="padding:.8rem">No items scanned yet.</div>'}
      </div>
    </div>`).join('');
}

function toggleBox(id) {
  const body = document.getElementById('body-' + id);
  const chev = document.getElementById('chev-' + id);
  const open = body.style.display !== 'block';
  body.style.display = open ? 'block' : 'none';
  if (chev) chev.classList.toggle('open', open);
}

async function closeBox(id) {
  await fetch(`/api/boxes/${id}/close`, { method: 'POST' });
  const b = state.boxes.find(x => x.id === id);
  if (b) b.status = 'closed';
  renderBoxes();
}

async function deleteBox(id) {
  if (!confirm(`Delete ${id}? This cannot be undone.`)) return;
  await fetch(`/api/boxes/${id}`, { method: 'DELETE' });
  state.boxes = state.boxes.filter(x => x.id !== id);
  renderBoxes(); updateNavStats();
}

async function removeItem(boxId, barcode) {
  await fetch(`/api/boxes/${boxId}/items/${encodeURIComponent(barcode)}`, { method: 'DELETE' });
  const b = state.boxes.find(x => x.id === boxId);
  if (b) b.items = b.items.filter(i => i.barcode !== barcode);
  renderBoxes(); renderScannedItems(); updateNavStats();
}

/* ══════════════════════════════
   SCAN
══════════════════════════════ */
function populateBoxSelect() {
  const sel = document.getElementById('active-box');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select a box —</option>' +
    state.boxes.filter(b => b.status === 'open').map(b =>
      `<option value="${b.id}">${b.id} — ${b.client} (${b.items.length} items)</option>`).join('');
  if (cur) sel.value = cur;
  updateBoxInfo();
}

function updateBoxInfo() {
  const id = document.getElementById('active-box').value;
  const info = document.getElementById('active-box-info');
  const b = id ? state.boxes.find(x => x.id === id) : null;
  if (b) {
    info.style.display = 'block';
    info.innerHTML = `<b>${b.id}</b> · ${b.client}${b.phone ? ' · ' + b.phone : ''} · <span class="badge ${b.category}">${cap(b.category)}</span> · ${b.date}`;
    renderScannedItems();
  } else {
    info.style.display = 'none';
    document.getElementById('scanned-items-wrap').style.display = 'none';
  }
}

async function scanItem() {
  const bEl = document.getElementById('barcode-input');
  const barcode = bEl.value.trim();
  const fb = document.getElementById('scan-feedback');
  fb.style.display = 'none'; fb.className = 'feedback';

  if (!barcode) { showFb('err', 'Please scan or enter a barcode.'); return; }
  const boxId = document.getElementById('active-box').value;
  if (!boxId) { showFb('err', 'Please select a box first.'); return; }

  const item = {
    barcode,
    desc: document.getElementById('item-desc').value.trim(),
    cat: document.getElementById('item-cat').value,
    origin: document.getElementById('item-origin').value,
  };

  const res = await fetch(`/api/boxes/${boxId}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item)
  });
  const data = await res.json();

  if (data.error) { showFb('err', '⚠ ' + data.error); bEl.value = ''; return; }

  const b = state.boxes.find(x => x.id === boxId);
  if (b) b.items.push(data);
  showFb('ok', `✓ Added ${barcode}${item.desc ? ' — ' + item.desc : ''} to ${boxId}`);
  bEl.value = ''; document.getElementById('item-desc').value = '';
  bEl.focus();
  populateBoxSelect(); renderScannedItems(); updateNavStats();
}

function showFb(type, msg) {
  const fb = document.getElementById('scan-feedback');
  fb.className = 'feedback ' + type;
  fb.textContent = msg;
  fb.style.display = 'block';
}

function renderScannedItems() {
  const boxId = document.getElementById('active-box').value;
  const b = boxId ? state.boxes.find(x => x.id === boxId) : null;
  const wrap = document.getElementById('scanned-items-wrap');
  if (!b) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  document.getElementById('scanned-count').textContent = `${b.items.length} items`;
  document.getElementById('scanned-items-list').innerHTML = b.items.length
    ? [...b.items].reverse().map(it => `
      <div class="item-row">
        <span class="item-barcode">${it.barcode}</span>
        <span class="item-name">${it.desc || '—'}</span>
        <span class="badge ${it.cat}">${cap(it.cat)}</span>
        <span class="muted" style="font-size:11px">${it.time}</span>
        <button class="btn sm danger" onclick="removeItem('${boxId}','${it.barcode}')">🗑</button>
      </div>`).join('')
    : '<div class="empty" style="padding:.6rem">Scan first item above.</div>';
}

/* ══════════════════════════════
   LOOKUP
══════════════════════════════ */
function liveSearch() {
  const v = document.getElementById('lookup-input').value.trim();
  if (v.length >= 3) doLookup(true);
  else if (!v) document.getElementById('lookup-result').innerHTML = '';
}

async function doLookup(silent) {
  const val = document.getElementById('lookup-input').value.trim();
  if (!val) return;
  const res = await fetch(`/api/lookup/${encodeURIComponent(val)}`);
  const data = await res.json();
  const con = document.getElementById('lookup-result');

  if (data.found) {
    const { box, item } = data;
    const full = item.datetime
      ? new Date(item.datetime).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
      : item.date || box.date;
    con.innerHTML = `
      <div class="result-card result-found">
        <div class="result-header">
          <div class="result-icon">✓</div>
          <div><div class="result-title">Item found!</div><div class="result-sub">Barcode <code>${val}</code> is tracked</div></div>
        </div>
        <div class="result-body">
          <div class="info-grid">
            <div class="info-block"><div class="info-lbl">Client</div><div class="info-val">${box.client}</div>${box.phone ? `<div class="muted" style="font-size:12px">${box.phone}</div>` : ''}</div>
            <div class="info-block"><div class="info-lbl">Box ID</div><div class="info-val" style="font-family:monospace">${box.id}</div><span class="badge ${box.status}" style="margin-top:4px">${box.status}</span></div>
            <div class="info-block"><div class="info-lbl">Date received</div><div class="info-val" style="font-size:13px">${full}</div><div class="muted" style="font-size:12px">at ${item.time || '—'}</div></div>
            <div class="info-block"><div class="info-lbl">Item details</div><div class="info-val" style="font-size:13px">${item.desc || 'No description'}</div><div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap"><span class="badge ${item.cat}">${cap(item.cat)}</span><span class="badge ${oc(item.origin)}">${item.origin.toUpperCase()}</span></div></div>
            <div class="info-block" style="grid-column:1/-1"><div class="info-lbl">Barcode</div><div class="info-val" style="font-family:monospace;font-size:17px;letter-spacing:.06em">${item.barcode}</div></div>
          </div>
        </div>
      </div>`;
    if (!silent) addHistory(val, true, box.client, box.id);
  } else {
    con.innerHTML = `
      <div class="result-card result-not">
        <div class="result-header">
          <div class="result-icon">✗</div>
          <div><div class="result-title">Not found</div><div class="result-sub">Barcode <code>${val}</code> is not in any box</div></div>
        </div>
        <div class="result-body muted" style="font-size:13px">Check the barcode or scan it into a box first.</div>
      </div>`;
    if (!silent) addHistory(val, false, '', '');
  }
}

function clearLookup() {
  document.getElementById('lookup-input').value = '';
  document.getElementById('lookup-result').innerHTML = '';
}

function addHistory(barcode, found, client, boxId) {
  searchHistory = searchHistory.filter(h => h.barcode !== barcode);
  searchHistory.unshift({ barcode, found, client, boxId, time: new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) });
  localStorage.setItem('eg-lookup-history', JSON.stringify(searchHistory.slice(0, 10)));
  renderHistory();
}

function renderHistory() {
  const sec = document.getElementById('lookup-history-section');
  const el = document.getElementById('lookup-history');
  if (!searchHistory.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  el.innerHTML = searchHistory.map(h => `
    <div class="history-item" onclick="document.getElementById('lookup-input').value='${h.barcode}';doLookup()">
      <span style="color:${h.found ? '#0F6E56' : '#A32D2D'}">${h.found ? '✓' : '✗'}</span>
      <span style="font-family:monospace;font-size:12px;font-weight:600">${h.barcode}</span>
      ${h.found ? `<span class="muted">${h.client} · ${h.boxId}</span>` : '<span class="muted">not found</span>'}
      <span class="muted" style="font-size:11px;margin-left:auto">${h.time}</span>
    </div>`).join('');
}

/* ══════════════════════════════
   EXPORT SELECTS
══════════════════════════════ */
function populateExportSelects() {
  const allOpt = state.boxes.map(b => `<option value="${b.id}">${b.id} — ${b.client}</option>`).join('');
  document.getElementById('print-box-sel').innerHTML = '<option value="">— choose box —</option>' + allOpt;
  document.getElementById('export-one-sel').innerHTML = '<option value="">— choose —</option>' + allOpt;
  const clients = [...new Set(state.boxes.map(b => b.client))];
  document.getElementById('export-client-sel').innerHTML = '<option value="">— choose —</option>' +
    clients.map(c => `<option value="${c}">${c}</option>`).join('');
}

/* ══════════════════════════════
   PRINT
══════════════════════════════ */
function buildReceiptHTML(box) {
  const now = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const rows = box.items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-family:monospace;font-size:12px">${it.barcode}</td>
      <td>${it.desc || '—'}</td>
      <td>${cap(it.cat)}</td>
      <td>${it.origin.toUpperCase()}</td>
      <td>${it.date || '—'}</td>
      <td>${it.time || '—'}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${box.id}</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #534AB7;padding-bottom:12px;margin-bottom:16px}
    .logo{font-size:22px;font-weight:700;color:#534AB7}.logo-sub{font-size:11px;color:#888}
    .meta{text-align:right;font-size:12px;color:#555}
    .client-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:#f8f7fe;border-radius:8px;padding:14px;margin-bottom:16px}
    .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;font-weight:700}
    .val{font-size:13px;font-weight:700}
    table{width:100%;border-collapse:collapse}
    th{background:#534AB7;color:#fff;padding:8px;text-align:left;font-size:12px}
    td{padding:7px 8px;border-bottom:1px solid #eee;font-size:12px}
    tr:nth-child(even) td{background:#faf9ff}
    .total{background:#EEEDFE!important;font-weight:700;color:#3C3489}
    .total td{border-top:2px solid #534AB7;padding:9px 8px}
    .footer{text-align:center;font-size:11px;color:#aaa;margin-top:16px;border-top:1px solid #eee;padding-top:10px}
    @media print{body{padding:10px}}
  </style></head><body>
  <div class="header">
    <div><div class="logo">📦 EG Shipping</div><div class="logo-sub">USA · China · World → Egypt</div></div>
    <div class="meta">Printed: ${now}<br>Receipt: <b>${box.id}</b></div>
  </div>
  <div class="client-grid">
    <div><div class="lbl">Client</div><div class="val">${box.client}</div></div>
    ${box.phone ? `<div><div class="lbl">Phone</div><div class="val">${box.phone}</div></div>` : ''}
    <div><div class="lbl">Box ID</div><div class="val" style="font-family:monospace">${box.id}</div></div>
    <div><div class="lbl">Type</div><div class="val">${cap(box.type)}</div></div>
    <div><div class="lbl">Date received</div><div class="val">${box.date}</div></div>
    <div><div class="lbl">Origin</div><div class="val">${box.origin.toUpperCase()}</div></div>
    <div><div class="lbl">Category</div><div class="val">${cap(box.category)}</div></div>
    <div><div class="lbl">Status</div><div class="val">${cap(box.status)}</div></div>
    <div><div class="lbl">Total items</div><div class="val">${box.items.length}</div></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Barcode</th><th>Description</th><th>Category</th><th>Origin</th><th>Date</th><th>Time</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td colspan="6" style="text-align:right">Total items in ${box.id}</td><td><b>${box.items.length}</b></td></tr>
    </tbody>
  </table>
  <div class="footer">EG Shipping Receiver · ${box.id} · ${box.client} · ${now}</div>
  </body></html>`;
}

function printBoxById(id) {
  const b = state.boxes.find(x => x.id === id);
  if (!b) return;
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(buildReceiptHTML(b));
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

function printBox() {
  const id = document.getElementById('print-box-sel').value;
  if (!id) { alert('Please select a box'); return; }
  printBoxById(id);
}

/* ══════════════════════════════
   EXCEL EXPORTS
══════════════════════════════ */
function exportAllBoxes() {
  if (!state.boxes.length) { alert('No boxes to export'); return; }
  const rows = [['Box ID','Client Name','Phone','Type','Origin','Category','Date Received','Status','Item Count']];
  state.boxes.forEach(b => rows.push([b.id, b.client, b.phone, cap(b.type), b.origin.toUpperCase(), cap(b.category), b.date, cap(b.status), b.items.length]));
  const ws = XLSX.utils.aoa_to_sheet([['EG Shipping Receiver — All Boxes'], ['Exported: ' + new Date().toLocaleDateString('en-GB')], [], ...rows]);
  ws['!cols'] = [{wch:12},{wch:22},{wch:16},{wch:8},{wch:8},{wch:12},{wch:14},{wch:8},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'All Boxes');
  XLSX.writeFile(wb, `EG_Boxes_${today()}.xlsx`);
}

function exportAllItems() {
  const rows = [['Box ID','Client','Phone','Box Date','Origin','Category','Barcode','Description','Item Cat','Item Origin','Scanned Date','Scanned Time']];
  state.boxes.forEach(b => b.items.forEach(it => rows.push([b.id, b.client, b.phone, b.date, b.origin.toUpperCase(), cap(b.category), it.barcode, it.desc || '', cap(it.cat), it.origin.toUpperCase(), it.date || '', it.time || ''])));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:22},{wch:14},{wch:12},{wch:8},{wch:12},{wch:22},{wch:28},{wch:12},{wch:10},{wch:12},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'All Items');
  XLSX.writeFile(wb, `EG_Items_${today()}.xlsx`);
}

function exportBoxById(id) {
  const b = state.boxes.find(x => x.id === id);
  if (!b) return;
  const rows = [
    ['EG Shipping Receiver — Box Receipt'],
    ['Box ID:', b.id, 'Client:', b.client, 'Phone:', b.phone],
    ['Date:', b.date, 'Status:', cap(b.status), 'Items:', b.items.length],
    [],
    ['#','Barcode','Description','Category','Origin','Date Scanned','Time']
  ];
  b.items.forEach((it, i) => rows.push([i+1, it.barcode, it.desc || '', cap(it.cat), it.origin.toUpperCase(), it.date || '', it.time || '']));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:4},{wch:22},{wch:28},{wch:12},{wch:10},{wch:14},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, b.id);
  XLSX.writeFile(wb, `${b.id}_${b.client.replace(/\s+/g,'_')}.xlsx`);
}

function exportOneBox() {
  const id = document.getElementById('export-one-sel').value;
  if (!id) { alert('Please select a box'); return; }
  exportBoxById(id);
}

function exportByClient() {
  const client = document.getElementById('export-client-sel').value;
  if (!client) { alert('Please select a client'); return; }
  const clientBoxes = state.boxes.filter(b => b.client === client);
  const wb = XLSX.utils.book_new();
  const sumRows = [['Client:', client], ['Exported:', new Date().toLocaleDateString('en-GB')],
    ['Total Boxes:', clientBoxes.length], ['Total Items:', clientBoxes.reduce((a, b) => a + b.items.length, 0)], [],
    ['Box ID','Type','Origin','Category','Date','Status','Items']];
  clientBoxes.forEach(b => sumRows.push([b.id, cap(b.type), b.origin.toUpperCase(), cap(b.category), b.date, cap(b.status), b.items.length]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Summary');
  clientBoxes.forEach(b => {
    const rows = [['Box ID:', b.id], ['Date:', b.date], ['Status:', cap(b.status)], [], ['Barcode','Description','Category','Origin','Date','Time']];
    b.items.forEach(it => rows.push([it.barcode, it.desc || '', cap(it.cat), it.origin.toUpperCase(), it.date || '', it.time || '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), b.id);
  });
  XLSX.writeFile(wb, `${client.replace(/\s+/g,'_')}_Shipping.xlsx`);
}

const today = () => new Date().toISOString().split('T')[0];

/* ══════════════════════════════
   BACKUP
══════════════════════════════ */
async function loadBackups() {
  const res = await fetch('/api/backups');
  const files = await res.json();
  const el = document.getElementById('backup-list');
  if (!files.length) { el.innerHTML = '<div class="empty">No backups yet.</div>'; return; }
  el.innerHTML = `<table class="backup-table">
    <thead><tr><th>Filename</th><th>Date & Time</th><th>Size</th><th>Actions</th></tr></thead>
    <tbody>${files.map(f => `
      <tr>
        <td style="font-family:monospace;font-size:12px">${f.name}</td>
        <td>${f.modified}</td>
        <td>${(f.size / 1024).toFixed(1)} KB</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <a href="/api/backups/${f.name}/download" class="btn sm">⬇ Download</a>
          <button class="btn sm success" onclick="restoreBackup('${f.name}')">↩ Restore</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function manualBackup() {
  const res = await fetch('/api/backup', { method: 'POST' });
  const data = await res.json();
  showBackupFb('ok', `✓ Backup saved: ${data.file}`);
  loadBackups();
}

async function restoreBackup(filename) {
  if (!confirm(`Restore from ${filename}?\nCurrent data will be backed up first.`)) return;
  const res = await fetch(`/api/backups/${filename}/restore`, { method: 'POST' });
  const data = await res.json();
  if (data.ok) {
    showBackupFb('ok', '✓ Restored. Reloading...');
    setTimeout(() => { loadState().then(() => { renderBoxes(); updateNavStats(); loadBackups(); }); }, 800);
  }
}

function downloadAllBackups() { window.location.href = '/api/backups/download-all'; }

async function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/import', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) {
    showBackupFb('ok', `✓ Imported ${data.boxes} boxes. Reloading...`);
    setTimeout(() => { loadState().then(() => { renderBoxes(); updateNavStats(); loadBackups(); }); }, 800);
  } else {
    showBackupFb('err', '✗ ' + data.error);
  }
  input.value = '';
}

function showBackupFb(type, msg) {
  const fb = document.getElementById('backup-feedback');
  fb.className = 'feedback ' + type;
  fb.textContent = msg;
  fb.style.display = 'block';
  setTimeout(() => { fb.style.display = 'none'; }, 4000);
}

/* ══════════════════════════════
   REPORTS
══════════════════════════════ */
async function renderReports() {
  const res = await fetch('/api/stats');
  const s = await res.json();
  document.getElementById('metrics-row').innerHTML = `
    <div class="metric"><div class="metric-val">${s.total_boxes}</div><div class="metric-lbl">Total boxes</div></div>
    <div class="metric"><div class="metric-val">${s.total_items}</div><div class="metric-lbl">Total items</div></div>
    <div class="metric"><div class="metric-val">${s.open_boxes}</div><div class="metric-lbl">Open</div></div>
    <div class="metric"><div class="metric-val">${s.total_clients}</div><div class="metric-lbl">Clients</div></div>`;
  const boxes = state.boxes;
  document.getElementById('report-list').innerHTML = !boxes.length
    ? '<div class="empty">No data yet.</div>'
    : `<table class="data-table">
      <thead><tr><th>Box ID</th><th>Client</th><th>Date</th><th>Category</th><th>Origin</th><th style="text-align:center">Items</th><th style="text-align:center">Status</th></tr></thead>
      <tbody>${boxes.map(b => `
        <tr>
          <td style="font-family:monospace;font-size:12px">${b.id}</td>
          <td><b>${b.client}</b><br><span class="muted" style="font-size:11px">${b.phone || ''}</span></td>
          <td class="muted" style="font-size:12px">${b.date}</td>
          <td><span class="badge ${b.category}">${cap(b.category)}</span></td>
          <td><span class="badge ${oc(b.origin)}">${b.origin.toUpperCase()}</span></td>
          <td style="text-align:center;font-weight:600">${b.items.length}</td>
          <td style="text-align:center"><span class="badge ${b.status}">${b.status}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

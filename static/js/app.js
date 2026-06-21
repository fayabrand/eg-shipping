/* EG Shipping Receiver — Frontend JS */

let state = { boxes: [], nextId: 1 };
let searchHistory = JSON.parse(localStorage.getItem('eg-lookup-history') || '[]');
let activeScanBoxId = null;

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const oc  = o => o === 'other' ? 'other-c' : o;

/* — INIT — */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cl-date').value = new Date().toISOString().split('T')[0];
  loadState().then(() => { renderBoxes(); updateNavStats(); });
});

async function loadState() {
  const res = await fetch('/api/boxes');
  state = await res.json();
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.currentTarget.classList.add('active');
  if (name === 'scan') updateBoxSelect();
  if (name === 'export') { fillExportSelects(); }
  if (name === 'backup') loadBackups();
  if (name === 'reports') renderReports();
}

/* — CREATE BOX + INLINE SCAN — */
async function createBox() {
  const name = document.getElementById('cl-name').value.trim();
  if (!name) { alert('Enter client name'); return; }
  const box = {
    client: name,
    phone: document.getElementById('cl-phone').value.trim(),
    type: document.getElementById('cl-type').value,
    origin: document.getElementById('cl-origin').value,
    category: document.getElementById('cl-cat').value,
    date: document.getElementById('cl-date').value,
  };
  const res = await fetch('/api/boxes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(box) });
  const created = await res.json();
  await loadState();
  renderBoxes();
  updateNavStats();
  // Clear form
  document.getElementById('cl-name').value = '';
  document.getElementById('cl-phone').value = '';
  // Open inline scan for this box
  openInlineScan(created.id);
}

function openInlineScan(boxId) {
  activeScanBoxId = boxId;
  const box = state.boxes.find(b => b.id === boxId);
  if (!box) return;
  // Show inline scan panel
  const panel = document.getElementById('inline-scan-panel');
  panel.style.display = 'block';
  document.getElementById('inline-box-label').textContent = box.id + ' — ' + box.client + ' (' + box.items.length + ' items)';
  document.getElementById('inline-barcode').value = '';
  document.getElementById('inline-barcode').focus();
  renderInlineItems();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeInlineScan() {
  document.getElementById('inline-scan-panel').style.display = 'none';
  activeScanBoxId = null;
  document.getElementById('inline-feedback').style.display = 'none';
}

async function inlineScanItem() {
  if (!activeScanBoxId) return;
  const barcode = document.getElementById('inline-barcode').value.trim();
  if (!barcode) return;
  const desc = document.getElementById('inline-desc').value.trim();
  const cat  = document.getElementById('inline-item-cat').value;
  const orig = document.getElementById('inline-item-origin').value;
  const fb = document.getElementById('inline-feedback');

  const res = await fetch('/api/boxes/' + activeScanBoxId + '/items', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ barcode, description: desc, category: cat, origin: orig })
  });

  if (res.status === 409) {
    const err = await res.json();
    fb.className = 'feedback err'; fb.textContent = '⚠️ ' + err.error; fb.style.display = 'block';
    document.getElementById('inline-barcode').select();
    return;
  }

  await loadState();
  const box = state.boxes.find(b => b.id === activeScanBoxId);
  document.getElementById('inline-box-label').textContent = box.id + ' — ' + box.client + ' (' + box.items.length + ' items)';
  fb.className = 'feedback ok'; fb.textContent = '✅ Added: ' + barcode; fb.style.display = 'block';
  document.getElementById('inline-barcode').value = '';
  document.getElementById('inline-desc').value = '';
  document.getElementById('inline-barcode').focus();
  renderInlineItems();
  updateNavStats();
  setTimeout(() => { fb.style.display = 'none'; }, 2000);
}

function renderInlineItems() {
  if (!activeScanBoxId) return;
  const box = state.boxes.find(b => b.id === activeScanBoxId);
  if (!box) return;
  const list = document.getElementById('inline-items-list');
  if (!box.items.length) { list.innerHTML = '<div class="empty">No items yet — scan your first barcode</div>'; return; }
  list.innerHTML = [...box.items].reverse().map(it => `
    <div class="item-row">
      <div class="item-bc">${it.barcode}</div>
      <div class="item-meta">${it.description || ''} · ${cap(it.category)} · ${it.time || ''}</div>
      <button class="btn sm danger" onclick="inlineDeleteItem('${it.barcode}')">✕</button>
    </div>
  `).join('');
}

async function inlineDeleteItem(barcode) {
  if (!activeScanBoxId) return;
  await fetch('/api/boxes/' + activeScanBoxId + '/items/' + encodeURIComponent(barcode), { method: 'DELETE' });
  await loadState();
  const box = state.boxes.find(b => b.id === activeScanBoxId);
  document.getElementById('inline-box-label').textContent = box.id + ' — ' + box.client + ' (' + box.items.length + ' items)';
  renderInlineItems();
  updateNavStats();
}

async function inlineCloseBox() {
  if (!activeScanBoxId) return;
  if (!confirm('Close this box? No more items can be added after closing.')) return;
  await fetch('/api/boxes/' + activeScanBoxId + '/close', { method: 'POST' });
  await loadState();
  renderBoxes();
  updateNavStats();
  closeInlineScan();
}

/* — BOX LIST — */
function renderBoxes() {
  const q = (document.getElementById('search-boxes')?.value || '').toLowerCase();
  const boxes = state.boxes.filter(b =>
    b.client.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)
  );
  const el = document.getElementById('box-list');
  if (!boxes.length) { el.innerHTML = '<div class="empty">No boxes found</div>'; return; }
  el.innerHTML = boxes.map(b => `
    <div class="box-card ${b.status}">
      <div class="box-header" onclick="toggleBox('${b.id}')">
        <div class="box-icon">${b.type==='bag'?'🛍':'📦'}</div>
        <div class="box-info">
          <div class="box-id">${b.id}</div>
          <div class="box-client">${b.client} ${b.phone?'· '+b.phone:''}</div>
          <div class="box-meta">${b.date||''} · ${cap(b.category)} · ${b.origin?.toUpperCase()} · <span class="badge ${b.status}">${b.status}</span> · ${b.items.length} items</div>
        </div>
        <div class="box-chevron">▾</div>
      </div>
      <div class="box-actions">
        ${b.status==='open'?'<button class="btn sm" onclick="closeBoxById(''+b.id+'')">🔒 Close</button>':''}
        ${b.status==='open'?'<button class="btn sm primary" onclick="openInlineScan(''+b.id+'');switchToBoxesTab()">📷 Scan More</button>':''}
        <button class="btn sm" onclick="printBoxById('${b.id}')">🖨️ Print</button>
        <button class="btn sm success" onclick="exportBoxById('${b.id}')">📊 Excel</button>
        ${b.status==='open'?'<button class="btn sm danger" onclick="deleteBox(''+b.id+'')">🗑 Delete</button>':''}
      </div>
      <div class="box-body" id="body-${b.id}" style="display:none">
        ${b.items.length
          ? '<div class="items-list">' + b.items.map(it => `<div class="item-row"><div class="item-bc">${it.barcode}</div><div class="item-meta">${it.description||''} · ${cap(it.category)} · ${it.time||''}</div><button class="btn sm danger" onclick="deleteItem('${b.id}','${it.barcode}')">✕</button></div>`).join('') + '</div>'
          : '<div class="empty">No items in this box</div>'
        }
      </div>
    </div>
  `).join('');
  fillExportSelects();
}

function switchToBoxesTab() {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-boxes').classList.add('active');
  document.querySelectorAll('.nav-btn')[0].classList.add('active');
}

function toggleBox(id) {
  const body = document.getElementById('body-' + id);
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
}

async function closeBoxById(id) {
  await fetch('/api/boxes/' + id + '/close', { method: 'POST' });
  await loadState(); renderBoxes(); updateNavStats();
}

async function deleteBox(id) {
  if (!confirm('Delete this box and all its items?')) return;
  await fetch('/api/boxes/' + id, { method: 'DELETE' });
  await loadState(); renderBoxes(); updateNavStats();
}

async function deleteItem(boxId, barcode) {
  await fetch('/api/boxes/' + boxId + '/items/' + encodeURIComponent(barcode), { method: 'DELETE' });
  await loadState(); renderBoxes(); updateNavStats();
}

/* — SCAN TAB (legacy) — */
function updateBoxSelect() {
  const sel = document.getElementById('active-box');
  if (!sel) return;
  const open = state.boxes.filter(b => b.status === 'open');
  sel.innerHTML = '<option value="">— select a box —</option>' + open.map(b => `<option value="${b.id}">${b.id} — ${b.client}</option>`).join('');
}

function updateBoxInfo() {
  const id = document.getElementById('active-box')?.value;
  const info = document.getElementById('active-box-info');
  if (!info) return;
  if (!id) { info.style.display='none'; return; }
  const b = state.boxes.find(x => x.id === id);
  if (!b) return;
  info.style.display = 'block';
  info.innerHTML = `<strong>${b.id}</strong> — ${b.client} · ${b.items.length} items`;
}

async function scanItem() {
  const boxId = document.getElementById('active-box')?.value;
  if (!boxId) { alert('Select a box first'); return; }
  const barcode = document.getElementById('barcode-input')?.value.trim();
  if (!barcode) return;
  const desc = document.getElementById('item-desc')?.value.trim();
  const cat  = document.getElementById('item-cat')?.value;
  const orig = document.getElementById('item-origin')?.value;
  const fb   = document.getElementById('scan-feedback');
  const res = await fetch('/api/boxes/' + boxId + '/items', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ barcode, description: desc, category: cat, origin: orig })
  });
  if (res.status === 409) {
    const err = await res.json();
    fb.className = 'feedback err'; fb.textContent = '⚠️ ' + err.error; fb.style.display = 'block';
    return;
  }
  fb.className = 'feedback ok'; fb.textContent = '✅ Added: ' + barcode; fb.style.display = 'block';
  document.getElementById('barcode-input').value = '';
  document.getElementById('item-desc').value = '';
  await loadState(); updateBoxInfo(); renderScannedItems(); updateNavStats();
  setTimeout(() => { fb.style.display = 'none'; }, 2000);
}

function renderScannedItems() {
  const id = document.getElementById('active-box')?.value;
  const wrap = document.getElementById('scanned-items-wrap');
  const list = document.getElementById('scanned-items-list');
  if (!id || !wrap || !list) return;
  const box = state.boxes.find(b => b.id === id);
  if (!box) return;
  wrap.style.display = 'block';
  document.getElementById('scanned-count').textContent = box.items.length + ' items';
  list.innerHTML = [...box.items].reverse().map(it => `
    <div class="item-row">
      <div class="item-bc">${it.barcode}</div>
      <div class="item-meta">${it.description||''} · ${cap(it.category)} · ${it.time||''}</div>
      <button class="btn sm danger" onclick="deleteItem('${box.id}','${it.barcode}')">✕</button>
    </div>
  `).join('');
}

/* — LOOKUP — */
async function doLookup() {
  const barcode = document.getElementById('lookup-input')?.value.trim();
  if (!barcode) return;
  const res = await fetch('/api/lookup/' + encodeURIComponent(barcode));
  const data = await res.json();
  const el = document.getElementById('lookup-result');
  if (data.found) {
    el.innerHTML = `<div class="result-card result-found">
      <div class="result-header result-found">
        <div class="result-icon">✅</div>
        <div><div class="result-title">${barcode}</div><div class="result-sub">Found</div></div>
      </div>
      <div style="padding:14px 18px">
        <div><strong>Box:</strong> ${data.box.id} — ${data.box.client}</div>
        <div><strong>Date:</strong> ${data.box.date}</div>
        <div><strong>Status:</strong> ${data.box.status}</div>
        <div><strong>Category:</strong> ${cap(data.item.category)}</div>
        ${data.item.description ? '<div><strong>Desc:</strong> '+data.item.description+'</div>' : ''}
      </div>
    </div>`;
    if (!searchHistory.includes(barcode)) {
      searchHistory.unshift(barcode); if (searchHistory.length > 20) searchHistory.pop();
      localStorage.setItem('eg-lookup-history', JSON.stringify(searchHistory));
    }
  } else {
    el.innerHTML = `<div class="result-card result-not"><div class="result-header result-not"><div class="result-icon">❌</div><div><div class="result-title">${barcode}</div><div class="result-sub">Not found in any box</div></div></div></div>`;
  }
}

function liveSearch() {
  const v = document.getElementById('lookup-input')?.value.trim();
  if (!v) { document.getElementById('lookup-result').innerHTML = ''; }
}

function clearLookup() {
  if (document.getElementById('lookup-input')) document.getElementById('lookup-input').value = '';
  document.getElementById('lookup-result').innerHTML = '';
}

/* — NAV STATS — */
function updateNavStats() {
  const el = document.getElementById('nav-stats');
  if (!el) return;
  const s = { total: state.boxes.length, open: state.boxes.filter(b=>b.status==='open').length, items: state.boxes.reduce((a,b)=>a+b.items.length,0) };
  el.innerHTML = `<span>${s.total} boxes</span><span>${s.items} items</span><span>${s.open} open</span>`;
}

/* — PRINT — */
function printBoxById(id) {
  const box = state.boxes.find(b => b.id === id);
  if (!box) return;
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Receipt ${box.id}</title><style>body{font-family:Arial,sans-serif;padding:20px;max-width:600px}h2{margin-bottom:4px}.meta{color:#666;font-size:13px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{padding:8px;text-align:left;border-bottom:1px solid #eee}th{background:#f5f5f5;font-size:12px;color:#666}.footer{margin-top:20px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:10px}</style></head><body>
  <h2>${box.id} — ${box.client}</h2>
  <div class="meta">Phone: ${box.phone||'—'} | Date: ${box.date||'—'} | Origin: ${box.origin?.toUpperCase()} | ${cap(box.category)} | Status: ${box.status}</div>
  <table><thead><tr><th>#</th><th>Barcode</th><th>Description</th><th>Category</th><th>Time</th></tr></thead>
  <tbody>${box.items.map((it,i)=>`<tr><td>${i+1}</td><td>${it.barcode}</td><td>${it.description||'—'}</td><td>${cap(it.category)}</td><td>${it.time||'—'}</td></tr>`).join('')}</tbody></table>
  <div class="footer">Total items: ${box.items.length} | EG Shipping Receiver</div>
  </body></html>`);
  w.document.close(); w.print();
}

function printBox() {
  const id = document.getElementById('print-box-sel')?.value;
  if (!id) { alert('Select a box'); return; }
  printBoxById(id);
}

/* — EXCEL EXPORTS — */
function fillExportSelects() {
  const one = document.getElementById('export-one-sel');
  const cli = document.getElementById('export-client-sel');
  const prt = document.getElementById('print-box-sel');
  if (one) one.innerHTML = '<option value="">— choose —</option>' + state.boxes.map(b=>`<option value="${b.id}">${b.id} — ${b.client}</option>`).join('');
  if (prt) prt.innerHTML = '<option value="">— choose box —</option>' + state.boxes.map(b=>`<option value="${b.id}">${b.id} — ${b.client}</option>`).join('');
  if (cli) {
    const clients = [...new Set(state.boxes.map(b=>b.client))];
    cli.innerHTML = '<option value="">— choose —</option>' + clients.map(c=>`<option value="${c}">${c}</option>`).join('');
  }
}

function exportAllBoxes() {
  const rows = state.boxes.map(b => ({ 'Box ID':b.id,'Client':b.client,'Phone':b.phone||'','Date':b.date||'','Origin':(b.origin||'').toUpperCase(),'Category':cap(b.category),'Type':cap(b.type),'Status':b.status,'Items':b.items.length }));
  downloadXlsx([{ name:'All Boxes', data:rows }], 'eg_shipping_all_boxes.xlsx');
}

function exportAllItems() {
  const rows = [];
  state.boxes.forEach(b => b.items.forEach(it => rows.push({ 'Box ID':b.id,'Client':b.client,'Date':b.date||'','Barcode':it.barcode,'Description':it.description||'','Category':cap(it.category),'Origin':(it.origin||b.origin||'').toUpperCase(),'Time':it.time||'' })));
  downloadXlsx([{ name:'All Items', data:rows }], 'eg_shipping_all_items.xlsx');
}

function exportOneBox() {
  const id = document.getElementById('export-one-sel')?.value;
  if (!id) { alert('Select a box'); return; }
  exportBoxById(id);
}

function exportBoxById(id) {
  const box = state.boxes.find(b => b.id === id);
  if (!box) return;
  const rows = box.items.map((it,i) => ({ '#':i+1,'Barcode':it.barcode,'Description':it.description||'','Category':cap(it.category),'Origin':(it.origin||box.origin||'').toUpperCase(),'Time':it.time||'' }));
  downloadXlsx([{ name:box.id, data:rows }], `${box.id}_${box.client}.xlsx`);
}

function exportByClient() {
  const client = document.getElementById('export-client-sel')?.value;
  if (!client) { alert('Select a client'); return; }
  const boxes = state.boxes.filter(b => b.client === client);
  const sheets = boxes.map(b => ({ name:b.id, data:b.items.map((it,i)=>({ '#':i+1,'Barcode':it.barcode,'Description':it.description||'','Category':cap(it.category),'Time':it.time||'' })) }));
  downloadXlsx(sheets, `${client}_all_boxes.xlsx`);
}

function downloadXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => { const ws = XLSX.utils.json_to_sheet(s.data); XLSX.utils.book_append_sheet(wb, ws, s.name.substring(0,31)); });
  XLSX.writeFile(wb, filename);
}

/* — BACKUP — */
async function manualBackup() {
  const res = await fetch('/api/backup', { method:'POST' });
  const d = await res.json();
  const fb = document.getElementById('backup-feedback');
  fb.className = 'feedback ok'; fb.textContent = '✅ Backup saved: ' + d.file; fb.style.display = 'block';
  setTimeout(() => { fb.style.display='none'; }, 3000);
  loadBackups();
}

async function loadBackups() {
  const res = await fetch('/api/backups');
  const files = await res.json();
  const el = document.getElementById('backup-list');
  if (!files.length) { el.innerHTML = '<div class="muted" style="padding:1rem;font-size:13px">No backups yet</div>'; return; }
  el.innerHTML = '<table class="data-table"><thead><tr><th>File</th><th>Size</th><th>Date</th><th></th></tr></thead><tbody>' +
    files.map(f => `<tr><td style="font-size:12px;font-family:monospace">${f.name}</td><td>${(f.size/1024).toFixed(1)}KB</td><td>${f.modified}</td><td><button class="btn sm" onclick="downloadBackup('${f.name}')">⬇</button> <button class="btn sm success" onclick="restoreBackup('${f.name}')">↺ Restore</button></td></tr>`).join('') +
    '</tbody></table>';
}

function downloadBackup(name) { window.open('/api/backups/' + encodeURIComponent(name) + '/download'); }
function downloadAllBackups() { window.open('/api/backups/download-all'); }

async function restoreBackup(name) {
  if (!confirm('Restore from ' + name + '? Current data will be replaced.')) return;
  const res = await fetch('/api/backups/' + encodeURIComponent(name) + '/restore', { method:'POST' });
  if (res.ok) { await loadState(); renderBoxes(); updateNavStats(); alert('Restored!'); }
}

async function importData(input) {
  const file = input.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('/api/import', { method:'POST', body:fd });
  const d = await res.json();
  if (d.ok) { await loadState(); renderBoxes(); updateNavStats(); const fb=document.getElementById('backup-feedback'); fb.className='feedback ok'; fb.textContent='✅ Imported '+d.boxes+' boxes'; fb.style.display='block'; setTimeout(()=>{fb.style.display='none'},3000); }
  else alert('Import failed: ' + d.error);
}

/* — REPORTS — */
async function renderReports() {
  await loadState();
  const s = { total:state.boxes.length, open:state.boxes.filter(b=>b.status==='open').length, closed:state.boxes.filter(b=>b.status==='closed').length, items:state.boxes.reduce((a,b)=>a+b.items.length,0), clients:new Set(state.boxes.map(b=>b.client)).size };
  document.getElementById('metrics-row').innerHTML = `
    <div class="metric"><div class="metric-val">${s.total}</div><div class="metric-lbl">Boxes</div></div>
    <div class="metric"><div class="metric-val">${s.open}</div><div class="metric-lbl">Open</div></div>
    <div class="metric"><div class="metric-val">${s.closed}</div><div class="metric-lbl">Closed</div></div>
    <div class="metric"><div class="metric-val">${s.items}</div><div class="metric-lbl">Items</div></div>
    <div class="metric"><div class="metric-val">${s.clients}</div><div class="metric-lbl">Clients</div></div>
  `;
  const boxes = state.boxes;
  document.getElementById('report-list').innerHTML = !boxes.length ? '<div class="empty">No data yet</div>' :
    '<table class="data-table"><thead><tr><th>Box ID</th><th>Client</th><th>Date</th><th>Category</th><th>Origin</th><th style="text-align:center">Items</th><th style="text-align:center">Status</th></tr></thead><tbody>' +
    boxes.map(b=>`<tr><td style="font-family:monospace;font-size:12px">${b.id}</td><td><b>${b.client}</b><br><span class="muted" style="font-size:11px">${b.phone||''}</span></td><td class="muted" style="font-size:12px">${b.date}</td><td><span class="badge ${b.category}">${cap(b.category)}</span></td><td><span class="badge ${oc(b.origin)}">${(b.origin||'').toUpperCase()}</span></td><td style="text-align:center;font-weight:600">${b.items.length}</td><td style="text-align:center"><span class="badge ${b.status}">${b.status}</span></td></tr>`).join('') +
    '</tbody></table>';
}

import os, json, shutil, datetime, zipfile, io, secrets
from flask import Flask, render_template, request, jsonify, send_file, redirect, session
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'EGship2024!')
BASE_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.dirname(__file__), 'data'))
DATA_FILE = os.path.join(BASE_DIR, 'shipping.json')
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')
os.makedirs(BASE_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)

def load_data():
    if not os.path.exists(DATA_FILE):
        return {'boxes': [], 'nextId': 1}
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_data(data):
    tmp = DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)

def make_backup(label='auto'):
    if not os.path.exists(DATA_FILE):
        return None
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    name = f'backup_{label}_{ts}.json'
    shutil.copy2(DATA_FILE, os.path.join(BACKUP_DIR, name))
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith('.json'))
    for old in files[:-50]:
        os.remove(os.path.join(BACKUP_DIR, old))
    return name

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == ADMIN_PASSWORD:
            session.permanent = True
            session['logged_in'] = True
            return redirect('/')
        error = 'Wrong password.'
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

@app.route('/api/boxes', methods=['GET'])
@login_required
def get_boxes():
    return jsonify(load_data())

@app.route('/api/boxes', methods=['POST'])
@login_required
def create_box():
    data = load_data()
    box = request.json
    box['id'] = 'BOX-' + str(data['nextId']).zfill(4)
    box['status'] = 'open'
    box['items'] = []
    box['created_at'] = datetime.datetime.now().isoformat()
    data['boxes'].insert(0, box)
    data['nextId'] += 1
    save_data(data)
    make_backup('auto')
    return jsonify(box)

@app.route('/api/boxes/<box_id>/close', methods=['POST'])
@login_required
def close_box(box_id):
    data = load_data()
    for b in data['boxes']:
        if b['id'] == box_id:
            b['status'] = 'closed'
            b['closed_at'] = datetime.datetime.now().isoformat()
            break
    save_data(data)
    return jsonify({'ok': True})

@app.route('/api/boxes/<box_id>', methods=['DELETE'])
@login_required
def delete_box(box_id):
    data = load_data()
    data['boxes'] = [b for b in data['boxes'] if b['id'] != box_id]
    save_data(data)
    make_backup('delete')
    return jsonify({'ok': True})

@app.route('/api/boxes/<box_id>/items', methods=['POST'])
@login_required
def add_item(box_id):
    data = load_data()
    item = request.json
    for b in data['boxes']:
        for it in b['items']:
            if it['barcode'] == item['barcode']:
                return jsonify({'error': f"Barcode already in {b['id']} ({b['client']})"}), 409
    now = datetime.datetime.now()
    item['time'] = now.strftime('%H:%M')
    item['date'] = now.strftime('%Y-%m-%d')
    item['datetime'] = now.isoformat()
    for b in data['boxes']:
        if b['id'] == box_id:
            b['items'].append(item)
            break
    save_data(data)
    return jsonify(item)

@app.route('/api/boxes/<box_id>/items/<barcode>', methods=['DELETE'])
@login_required
def delete_item(box_id, barcode):
    data = load_data()
    for b in data['boxes']:
        if b['id'] == box_id:
            b['items'] = [i for i in b['items'] if i['barcode'] != barcode]
            break
    save_data(data)
    return jsonify({'ok': True})

@app.route('/api/lookup/<barcode>')
@login_required
def lookup_barcode(barcode):
    data = load_data()
    bc = barcode.strip().lower()
    for box in data['boxes']:
        for item in box['items']:
            if item['barcode'].lower() == bc:
                return jsonify({'found': True, 'box': box, 'item': item})
    return jsonify({'found': False})

@app.route('/api/stats')
@login_required
def stats():
    data = load_data()
    boxes = data['boxes']
    total_items = sum(len(b['items']) for b in boxes)
    def _count(key):
        d = {}
        for b in boxes:
            d[b.get(key,'other')] = d.get(b.get(key,'other'),0)+1
        return d
    return jsonify({'total_boxes': len(boxes), 'open_boxes': sum(1 for b in boxes if b['status']=='open'), 'closed_boxes': sum(1 for b in boxes if b['status']=='closed'), 'total_items': total_items, 'total_clients': len(set(b['client'] for b in boxes)), 'by_origin': _count('origin'), 'by_category': _count('category')})

@app.route('/api/backup', methods=['POST'])
@login_required
def manual_backup():
    return jsonify({'ok': True, 'file': make_backup('manual')})

@app.route('/api/backups')
@login_required
def list_backups():
    files = sorted((f for f in os.listdir(BACKUP_DIR) if f.endswith('.json')), reverse=True)
    result = []
    for f in files:
        path = os.path.join(BACKUP_DIR, f)
        result.append({'name': f, 'size': os.path.getsize(path), 'modified': datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d %H:%M:%S')})
    return jsonify(result)

@app.route('/api/backups/<filename>/download')
@login_required
def download_backup(filename):
    path = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(path): return jsonify({'error': 'Not found'}), 404
    return send_file(path, as_attachment=True, download_name=filename)

@app.route('/api/backups/<filename>/restore', methods=['POST'])
@login_required
def restore_backup(filename):
    path = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(path): return jsonify({'error': 'Not found'}), 404
    make_backup('pre-restore')
    shutil.copy2(path, DATA_FILE)
    return jsonify({'ok': True})

@app.route('/api/backups/download-all')
@login_required
def download_all_backups():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        if os.path.exists(DATA_FILE): zf.write(DATA_FILE, 'current_data.json')
        for f in os.listdir(BACKUP_DIR):
            if f.endswith('.json'): zf.write(os.path.join(BACKUP_DIR, f), f'backups/{f}')
    buf.seek(0)
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    return send_file(buf, as_attachment=True, download_name=f'eg_shipping_backup_{ts}.zip', mimetype='application/zip')

@app.route('/api/import', methods=['POST'])
@login_required
def import_data():
    f = request.files.get('file')
    if not f: return jsonify({'error': 'No file'}), 400
    try:
        raw = json.loads(f.read().decode('utf-8'))
        if 'boxes' not in raw: return jsonify({'error': 'Invalid backup file'}), 400
        make_backup('pre-import')
        save_data(raw)
        return jsonify({'ok': True, 'boxes': len(raw['boxes'])})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

"""DeltaX Round 3 — small standalone, server-authoritative finale site.

Run `python app.py init-admin`, then `uvicorn app:app --host 127.0.0.1 --port 8303`.
Keep one application instance and use a reverse proxy for HTTPS in production.
"""
from __future__ import annotations

import getpass
import hashlib
import hmac
import os
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from seed import QUESTIONS, SHARED

BASE = Path(__file__).resolve().parent
STATIC = BASE / 'static'
DATA = Path(os.environ.get('R3_DATA_DIR', str(BASE / 'data'))).resolve()
UPLOADS = DATA / 'uploads'
DB = DATA / 'r3.sqlite3'
SECURE_COOKIES = os.getenv('R3_SECURE_COOKIES', '0') == '1'
SESSION_SECONDS = 8 * 60 * 60
LOCK = threading.RLock()
LOGIN_ATTEMPTS: dict[str, list[float]] = {}

DATA.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)


def connect():
    db = sqlite3.connect(DB, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    db.execute('PRAGMA busy_timeout = 5000')
    return db


@contextmanager
def transaction():
    with LOCK:
        db = connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


def read_one(sql: str, params=()):
    db = connect()
    try:
        row = db.execute(sql, params).fetchone()
        return dict(row) if row else None
    finally:
        db.close()


def read_all(sql: str, params=()):
    db = connect()
    try:
        return [dict(x) for x in db.execute(sql, params).fetchall()]
    finally:
        db.close()


def init_db():
    # WAL allows lightweight audience reads while the admin edits content.
    db0 = connect()
    try:
        db0.execute('PRAGMA journal_mode=WAL')
    finally:
        db0.close()
    with transaction() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          phase TEXT NOT NULL DEFAULT 'preview', selected TEXT,
          duration INTEGER NOT NULL DEFAULT 7200,
          remaining REAL NOT NULL DEFAULT 7200,
          ends_at REAL, updated_at REAL NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          shared TEXT NOT NULL,
          audience_revealed INTEGER NOT NULL DEFAULT 0 CHECK(audience_revealed IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS questions (
          track TEXT PRIMARY KEY CHECK(track IN ('A','B')),
          title TEXT NOT NULL, subtitle TEXT NOT NULL, blurb TEXT NOT NULL,
          content TEXT NOT NULL, modified_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin (
          username TEXT PRIMARY KEY, password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL,
          expires_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS resources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          url TEXT, filename TEXT, diskname TEXT,
          kind TEXT NOT NULL CHECK(kind IN ('link','file')),
          visible INTEGER NOT NULL DEFAULT 0,
          created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL, details TEXT NOT NULL, created_at REAL NOT NULL
        );
        ''')
        # Safe upgrade for databases created by the previous (unmasked) release.
        # A migrated installation defaults to CLOSED, even if it was previously public.
        columns = {col[1] for col in db.execute('PRAGMA table_info(settings)')}
        if 'audience_revealed' not in columns:
            db.execute('ALTER TABLE settings ADD COLUMN audience_revealed INTEGER NOT NULL DEFAULT 0 CHECK(audience_revealed IN (0, 1))')
        now = time.time()
        db.execute('INSERT OR IGNORE INTO settings(id, updated_at, shared) VALUES(1, ?, ?)', (now, SHARED))
        for track, q in QUESTIONS.items():
            db.execute('''INSERT OR IGNORE INTO questions(track, title, subtitle, blurb, content, modified_at)
              VALUES(?,?,?,?,?,?)''', (track, q['title'], q['subtitle'], q['blurb'], q['content'], now))


def hash_password(password: str):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2**14, r=8, p=1)
    return f'{salt.hex()}:{digest.hex()}'


def verify_password(password: str, encoded: str):
    try:
        salt, expected = encoded.split(':', 1)
        digest = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(digest, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def create_admin():
    init_db()
    username = input('Admin username [admin]: ').strip() or 'admin'
    password = getpass.getpass('New admin password (12+ characters): ')
    confirmation = getpass.getpass('Confirm password: ')
    if len(password) < 12 or password != confirmation:
        raise SystemExit('Password must be at least 12 characters and match confirmation.')
    with transaction() as db:
        db.execute('DELETE FROM sessions')
        db.execute('DELETE FROM admin')
        db.execute('INSERT INTO admin(username,password_hash) VALUES(?,?)', (username, hash_password(password)))
    print('Admin credentials set. Previous admin sessions revoked.')


def audit(db, action, details):
    db.execute('INSERT INTO audit(action, details, created_at) VALUES(?,?,?)', (action, str(details)[:300], time.time()))


def bump(db):
    db.execute('UPDATE settings SET updated_at=?, revision=revision+1 WHERE id=1', (time.time(),))


def computed_state(row):
    row = dict(row)
    now = time.time()
    if row['phase'] == 'running' and row['ends_at'] is not None:
        row['remaining'] = max(0, row['ends_at'] - now)
        if row['remaining'] <= 0:
            row['phase'] = 'finished'
    row['server_now'] = now
    return row


def auth_session(request: Request):
    token = request.cookies.get('r3_session', '')
    if not token:
        raise HTTPException(401, 'Admin login required')
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    session = read_one('SELECT csrf, expires_at FROM sessions WHERE token_hash=?', (token_hash,))
    if not session or session['expires_at'] < time.time():
        raise HTTPException(401, 'Session expired; log in again')
    return session


def auth_write(request: Request, x_csrf_token: str | None = Header(default=None)):
    session = auth_session(request)
    if not x_csrf_token or not hmac.compare_digest(session['csrf'], x_csrf_token):
        raise HTTPException(403, 'Invalid action token')
    return session


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=512)


class QuestionPatch(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    subtitle: str = Field(min_length=2, max_length=180)
    blurb: str = Field(max_length=300)
    content: str = Field(min_length=5, max_length=30000)


class SharedPatch(BaseModel):
    shared: str = Field(min_length=2, max_length=12000)


class AudienceVisibility(BaseModel):
    revealed: bool


class Selection(BaseModel):
    track: Literal['A', 'B']


class TimerAction(BaseModel):
    action: Literal['start', 'pause', 'resume', 'finish', 'reset_timer', 'reset_round']
    duration_minutes: int = Field(default=120, ge=1, le=240)


class ResourceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    description: str = Field(default='', max_length=400)
    url: str = Field(min_length=1, max_length=2000)
    visible: bool = False

    @field_validator('url')
    @classmethod
    def valid_url(cls, val):
        parts = urlsplit(val.strip())
        if parts.scheme not in ('https', 'http') or not parts.netloc or parts.username or parts.password:
            raise ValueError('Use a valid http(s) URL')
        return val.strip()


class ResourceVisibility(BaseModel):
    visible: bool


init_db()
app = FastAPI(title='DeltaX R3 — Project Helios', docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def no_cache(request, call_next):
    # Public markup and its mathematical illustrations must never be served while
    # sealed, including by visiting their /static/ paths directly.
    if request.url.path in ('/static/index.html', '/static/public.js'):
        state = read_one('SELECT audience_revealed FROM settings WHERE id=1')
        if not state or not state['audience_revealed']:
            response = Response(status_code=404)
        else:
            response = await call_next(request)
    else:
        response = await call_next(request)
    # A reverse proxy or browser must never retain an old unsealed copy.
    response.headers['Cache-Control'] = 'no-store, private, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    return response


@app.get('/api/health')
def health():
    return {'ok': True, 'service': 'r3'}


@app.get('/api/visibility')
def public_visibility():
    # Safe for the closed landing page to poll. No track details or state.
    state = read_one('SELECT audience_revealed FROM settings WHERE id=1')
    return {'revealed': bool(state and state['audience_revealed'])}


@app.get('/api/public')
def public():
    state = read_one('SELECT * FROM settings WHERE id=1')
    if not state or not state['audience_revealed']:
        # Crucial: masking is enforced on the server, not with CSS/JS.
        return {'masked': True}
    state = computed_state(state)
    state.pop('audience_revealed', None)
    tracks = ('A', 'B') if state['phase'] == 'preview' else (state['selected'],)
    questions = read_all('SELECT * FROM questions')
    qs = {q['track']: q for q in questions if q['track'] in tracks}
    resources = read_all('SELECT id,title,description,url,kind,visible FROM resources WHERE visible=1 ORDER BY id DESC')
    return {'masked': False, 'state': state, 'questions': qs, 'resources': resources}


@app.post('/api/admin/login')
def login(body: Login, request: Request, response: Response):
    ip = request.client.host if request.client else 'unknown'
    now = time.time()
    # Small standalone app; the reverse proxy should add its own rate limit in production.
    with LOCK:
        LOGIN_ATTEMPTS[ip] = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < 300]
        if len(LOGIN_ATTEMPTS[ip]) >= 10:
            raise HTTPException(429, 'Too many login attempts. Try later.')
    admin = read_one('SELECT * FROM admin WHERE username=?', (body.username,))
    valid = verify_password(body.password, admin['password_hash']) if admin else verify_password(body.password, hash_password('placeholder-for-timing'))
    if not valid:
        with LOCK:
            LOGIN_ATTEMPTS[ip].append(now)
        raise HTTPException(401, 'Invalid username or password')
    with LOCK:
        LOGIN_ATTEMPTS.pop(ip, None)
    token = secrets.token_urlsafe(40)
    csrf = secrets.token_urlsafe(32)
    with transaction() as db:
        db.execute('DELETE FROM sessions WHERE expires_at < ?', (now,))
        db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), csrf, now + SESSION_SECONDS))
        audit(db, 'login', body.username)
    response.set_cookie('r3_session', token, secure=SECURE_COOKIES, httponly=True, samesite='strict', max_age=SESSION_SECONDS, path='/')
    return {'ok': True, 'csrf': csrf, 'username': body.username}


@app.get('/api/admin/session')
def session(user=Depends(auth_session)):
    return {'authenticated': True, 'csrf': user['csrf']}


@app.post('/api/admin/logout')
def logout(request: Request, response: Response, user=Depends(auth_write)):
    token = request.cookies.get('r3_session', '')
    with transaction() as db:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie('r3_session', path='/')
    return {'ok': True}


@app.get('/api/admin/state')
def admin_state(user=Depends(auth_session)):
    return {
        'state': computed_state(read_one('SELECT * FROM settings WHERE id=1')),
        'questions': {q['track']: q for q in read_all('SELECT * FROM questions')},
        'resources': read_all('SELECT id,title,description,url,kind,visible,filename,created_at FROM resources ORDER BY id DESC'),
        'audit': read_all('SELECT action,details,created_at FROM audit ORDER BY id DESC LIMIT 12'),
    }


@app.put('/api/admin/questions/{track}')
def edit_question(track: Literal['A', 'B'], body: QuestionPatch, user=Depends(auth_write)):
    with transaction() as db:
        db.execute('UPDATE questions SET title=?, subtitle=?, blurb=?, content=?, modified_at=? WHERE track=?',
                   (body.title.strip(), body.subtitle.strip(), body.blurb.strip(), body.content.strip(), time.time(), track))
        bump(db)
        audit(db, 'edit_question', track)
    return {'ok': True}


@app.put('/api/admin/shared')
def edit_shared(body: SharedPatch, user=Depends(auth_write)):
    with transaction() as db:
        db.execute('UPDATE settings SET shared=? WHERE id=1', (body.shared.strip(),))
        bump(db)
        audit(db, 'edit_shared', 'shared physical scenario')
    return {'ok': True}


@app.post('/api/admin/visibility')
def set_visibility(body: AudienceVisibility, user=Depends(auth_write)):
    with transaction() as db:
        state = db.execute('SELECT audience_revealed FROM settings WHERE id=1').fetchone()
        current = bool(state['audience_revealed'])
        if current != body.revealed:
            db.execute('UPDATE settings SET audience_revealed=? WHERE id=1', (int(body.revealed),))
            bump(db)
            audit(db, 'audience_reveal' if body.revealed else 'audience_seal',
                  'PUBLIC questions and resources are now available' if body.revealed else 'PUBLIC access blocked')
    return {'ok': True, 'revealed': body.revealed}


@app.post('/api/admin/select')
def select_question(body: Selection, user=Depends(auth_write)):
    with transaction() as db:
        state = db.execute('SELECT * FROM settings WHERE id=1').fetchone()
        if state['phase'] not in ('preview', 'locked'):
            raise HTTPException(409, 'End/reset the current timer before changing tracks')
        db.execute('UPDATE settings SET phase=?, selected=?, remaining=duration, ends_at=NULL WHERE id=1', ('locked', body.track))
        bump(db)
        audit(db, 'select_track', body.track)
    return {'ok': True}


@app.post('/api/admin/timer')
def timer(body: TimerAction, user=Depends(auth_write)):
    now = time.time()
    with transaction() as db:
        row = db.execute('SELECT * FROM settings WHERE id=1').fetchone()
        phase = computed_state(row)['phase']
        dur = body.duration_minutes * 60
        action = body.action
        if action == 'start':
            if phase != 'locked' or not row['selected']:
                raise HTTPException(409, 'Select a track before starting the clock')
            db.execute('UPDATE settings SET phase=?, duration=?, remaining=?, ends_at=? WHERE id=1', ('running', dur, dur, now+dur))
        elif action == 'pause':
            if phase != 'running':
                raise HTTPException(409, 'Clock is not running')
            remaining = max(0, (row['ends_at'] or now)-now)
            if remaining <= 0:
                raise HTTPException(409, 'Clock already finished')
            db.execute('UPDATE settings SET phase=?, remaining=?, ends_at=NULL WHERE id=1', ('paused', remaining))
        elif action == 'resume':
            if phase != 'paused':
                raise HTTPException(409, 'Clock is not paused')
            db.execute('UPDATE settings SET phase=?, ends_at=? WHERE id=1', ('running', now+row['remaining']))
        elif action == 'finish':
            if phase not in ('running', 'paused', 'locked'):
                raise HTTPException(409, 'Nothing to finish')
            db.execute('UPDATE settings SET phase=?, remaining=0, ends_at=NULL WHERE id=1', ('finished',))
        elif action == 'reset_timer':
            if not row['selected']:
                raise HTTPException(409, 'No selected track')
            db.execute('UPDATE settings SET phase=?, remaining=duration, ends_at=NULL WHERE id=1', ('locked',))
        elif action == 'reset_round':
            db.execute('UPDATE settings SET phase=?, selected=NULL, remaining=duration, ends_at=NULL WHERE id=1', ('preview',))
        bump(db)
        audit(db, 'timer_'+action, f'{body.duration_minutes} minutes' if action == 'start' else '-')
    return {'ok': True}


@app.post('/api/admin/resources')
def add_link(body: ResourceCreate, user=Depends(auth_write)):
    with transaction() as db:
        db.execute('INSERT INTO resources(title,description,url,kind,visible,created_at) VALUES(?,?,?,?,?,?)',
                   (body.title.strip(), body.description.strip(), body.url, 'link', int(body.visible), time.time()))
        bump(db)
        audit(db, 'add_resource', body.title)
    return {'ok': True}


# For offline rehearsal / event day, keep uploads to basic viewable documents only.
ALLOWED = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain'}
MAX_FILE = 12 * 1024 * 1024


@app.post('/api/admin/resources/upload')
async def upload_resource(request: Request, title: str, description: str = '', visible: bool = False,
                          file: UploadFile = File(...), user=Depends(auth_write)):
    filename = Path(file.filename or 'attachment').name
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, 'Allowed: PDF, PNG, JPG, WebP or TXT')
    if not 1 <= len(title.strip()) <= 140 or len(description) > 400:
        raise HTTPException(422, 'Invalid resource title or description')
    data = await file.read(MAX_FILE + 1)
    if not data or len(data) > MAX_FILE:
        raise HTTPException(400, 'File must be between 1 byte and 12 MB')
    if ext == '.pdf' and not data.startswith(b'%PDF-'):
        raise HTTPException(400, 'Invalid PDF file')
    if ext == '.png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise HTTPException(400, 'Invalid PNG file')
    if ext in ('.jpg', '.jpeg') and not data.startswith(b'\xff\xd8\xff'):
        raise HTTPException(400, 'Invalid JPEG file')
    if ext == '.webp' and not (data.startswith(b'RIFF') and data[8:12] == b'WEBP'):
        raise HTTPException(400, 'Invalid WebP file')
    diskname = uuid.uuid4().hex + ext
    (UPLOADS / diskname).write_bytes(data)
    try:
        with transaction() as db:
            db.execute('INSERT INTO resources(title,description,filename,diskname,kind,visible,created_at) VALUES(?,?,?,?,?,?,?)',
                       (title.strip(), description.strip(), filename, diskname, 'file', int(visible), time.time()))
            bump(db)
            audit(db, 'upload_resource', title)
    except Exception:
        (UPLOADS / diskname).unlink(missing_ok=True)
        raise
    return {'ok': True}


@app.patch('/api/admin/resources/{resource_id}')
def resource_visibility(resource_id: int, body: ResourceVisibility, user=Depends(auth_write)):
    with transaction() as db:
        cursor = db.execute('UPDATE resources SET visible=? WHERE id=?', (int(body.visible), resource_id))
        if not cursor.rowcount:
            raise HTTPException(404, 'Resource not found')
        bump(db)
        audit(db, 'resource_visibility', f'{resource_id}: {body.visible}')
    return {'ok': True}


@app.delete('/api/admin/resources/{resource_id}')
def delete_resource(resource_id: int, user=Depends(auth_write)):
    with transaction() as db:
        row = db.execute('SELECT * FROM resources WHERE id=?', (resource_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Resource not found')
        db.execute('DELETE FROM resources WHERE id=?', (resource_id,))
        bump(db)
        audit(db, 'delete_resource', row['title'])
    if row['diskname']:
        (UPLOADS / row['diskname']).unlink(missing_ok=True)
    return {'ok': True}


@app.get('/api/resources/{resource_id}/download')
def download(resource_id: int, request: Request):
    row = read_one('SELECT * FROM resources WHERE id=?', (resource_id,))
    if not row or row['kind'] != 'file':
        raise HTTPException(404, 'File not found')
    gate = read_one('SELECT audience_revealed FROM settings WHERE id=1')
    if not row['visible'] or not gate or not gate['audience_revealed']:
        auth_session(request)
    path = UPLOADS / row['diskname']
    if not path.is_file() or path.parent != UPLOADS:
        raise HTTPException(404, 'File missing')
    return FileResponse(path, media_type=ALLOWED[Path(path).suffix.lower()], filename=row['filename'])


@app.get('/')
def index():
    gate = read_one('SELECT audience_revealed FROM settings WHERE id=1')
    if not gate or not gate['audience_revealed']:
        return FileResponse(STATIC / 'mask.html')
    return FileResponse(STATIC / 'index.html')


@app.get('/admin')
def admin_page():
    return FileResponse(STATIC / 'admin.html')


class GuardedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        # StaticFiles normalizes paths internally, so protect by filename here
        # too. Otherwise /static//public.js or /static/%2e/public.js would
        # bypass a literal HTTP middleware path check.
        normalized = os.path.normpath(path.replace('\\', '/'))
        if os.path.basename(normalized) in ('index.html', 'public.js'):
            gate = read_one('SELECT audience_revealed FROM settings WHERE id=1')
            if not gate or not gate['audience_revealed']:
                return Response(status_code=404)
        return await super().get_response(path, scope)


app.mount('/static', GuardedStaticFiles(directory=STATIC), name='static')


if __name__ == '__main__':
    if sys.argv[1:] == ['init-admin']:
        create_admin()
    else:
        print('Usage: python app.py init-admin')
        print('Then: python -m uvicorn app:app --host 127.0.0.1 --port 8303')

"""Security regression tests for R3's server-side publication gate."""
import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.setenv('R3_DATA_DIR', str(tmp_path / 'data'))
    monkeypatch.setenv('R3_SECURE_COOKIES', '0')
    sys.modules.pop('app', None)
    sys.modules.pop('seed', None)
    import app
    app = importlib.reload(app)
    with app.transaction() as db:
        db.execute('INSERT INTO admin(username,password_hash) VALUES(?,?)',
                   ('operator', app.hash_password('secure-test-password')))
    with TestClient(app.app) as client:
        yield app, client
    sys.modules.pop('app', None)


def authorize(client):
    res = client.post('/api/admin/login', json={'username':'operator','password':'secure-test-password'})
    res.raise_for_status()
    return {'X-CSRF-Token':res.json()['csrf']}


def visibility(client, headers, revealed):
    response=client.post('/api/admin/visibility', json={'revealed':revealed}, headers=headers)
    response.raise_for_status()


def test_sealed_by_default_even_if_admin_selects_a_question(rig):
    _, client=rig
    assert client.get('/api/public').json()=={'masked':True}
    assert client.get('/api/visibility').json()=={'revealed':False}
    assert 'Everything will be revealed soon' in client.get('/').text
    assert 'Helios' not in client.get('/').text
    assert client.get('/static/index.html').status_code==404
    assert client.get('/static/public.js').status_code==404
    assert client.post('/api/admin/visibility', json={'revealed':True}).status_code==401
    headers=authorize(client)
    assert client.post('/api/admin/visibility', json={'revealed':True}).status_code==403
    client.post('/api/admin/select', json={'track':'B'}, headers=headers).raise_for_status()
    assert client.get('/api/public').json()=={'masked':True}
    assert client.get('/api/admin/state').json()['state']['audience_revealed']==0
    visibility(client, headers, True)
    payload=client.get('/api/public').json()
    assert payload['masked'] is False
    assert set(payload['questions'])=={'B'}
    assert client.get('/static/index.html').status_code==200
    assert client.get('/static/public.js').status_code==200


def test_mask_also_blocks_publicly_marked_resource_and_preserves_timer(rig):
    app,client=rig
    headers=authorize(client)
    visibility(client, headers, True)
    client.post('/api/admin/select', json={'track':'A'}, headers=headers).raise_for_status()
    client.post('/api/admin/timer', json={'action':'start','duration_minutes':2}, headers=headers).raise_for_status()
    client.post('/api/admin/resources/upload?title=Question%20paper&visible=true',headers=headers,
                files={'file':('paper.pdf',b'%PDF-1.4\nsecret','application/pdf')}).raise_for_status()
    rid=client.get('/api/admin/state').json()['resources'][0]['id']
    assert client.get(f'/api/resources/{rid}/download').status_code==200
    visibility(client, headers, False)
    assert client.get('/api/public').json()=={'masked':True}
    assert client.get('/static/public.js').status_code==404
    client.post('/api/admin/logout',headers=headers).raise_for_status()
    assert client.get(f'/api/resources/{rid}/download').status_code==401
    headers=authorize(client)
    assert client.get('/api/admin/state').json()['state']['phase']=='running'
    # Operators still have access to the private materials while hidden.
    assert client.get(f'/api/resources/{rid}/download').status_code==200
    app.init_db()
    assert client.get('/api/public').json()=={'masked':True}
    assert client.get('/api/admin/state').json()['state']['phase']=='running'
    visibility(client, headers, True)
    assert client.get('/api/public').json()['state']['phase']=='running'


def test_migration_of_original_database_seals_without_wiping_papers(rig):
    app,client=rig
    with app.transaction() as db:
        db.execute('DROP TABLE settings')
        db.execute('''CREATE TABLE settings (
          id INTEGER PRIMARY KEY CHECK(id = 1), phase TEXT NOT NULL DEFAULT 'preview',
          selected TEXT, duration INTEGER NOT NULL DEFAULT 7200,
          remaining REAL NOT NULL DEFAULT 7200, ends_at REAL, updated_at REAL NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, shared TEXT NOT NULL)''')
        db.execute('INSERT INTO settings(id,phase,selected,updated_at,shared) VALUES(1,?,?,?,?)',
                   ('locked','A',12345,'sensitive private scenario'))
    app.init_db()
    state=app.read_one('SELECT * FROM settings WHERE id=1')
    assert state['audience_revealed']==0
    assert state['selected']=='A'
    assert client.get('/api/public').json()=={'masked':True}
    assert 'sensitive private scenario' not in client.get('/api/public').text


def test_no_browser_or_proxy_cache_for_revealed_and_sealed(rig):
    _,client=rig
    for route in ('/','/api/public','/api/visibility','/static/index.html'):
        res=client.get(route)
        assert 'no-store' in res.headers['cache-control']
        assert 'noindex' in res.headers['x-robots-tag']
    headers=authorize(client)
    visibility(client,headers,True)
    for route in ('/','/api/public','/static/public.js'):
        assert 'no-store' in client.get(route).headers['cache-control']
    visibility(client,headers,False)
    assert client.get('/api/public').json()=={'masked':True}


def test_alternate_static_paths_cannot_bypass_seal(rig):
    _,client=rig
    # These paths were previously served due to path normalization in Starlette.
    for path in ('/static//public.js','/static/%2e/public.js',
                 '/static/%2e%2e/static/public.js',
                 '/static//index.html','/static/%2e/index.html',
                 '/static/%2e%2e/static/index.html'):
        res=client.get(path,follow_redirects=False)
        assert res.status_code!=200, (path,res.status_code)
        assert b'const diagram' not in res.content

"""API rehearsal tests. All state lives in a temporary directory."""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def rig(tmp_path, monkeypatch):
    monkeypatch.setenv('R3_DATA_DIR', str(tmp_path / 'data'))
    monkeypatch.setenv('R3_SECURE_COOKIES', '0')
    sys.modules.pop('app', None)
    sys.modules.pop('seed', None)
    import app
    app = importlib.reload(app)
    with app.transaction() as db:
        db.execute('INSERT INTO admin(username, password_hash) VALUES(?, ?)', ('operator', app.hash_password('test-secret-123456')))
    with TestClient(app.app) as client:
        yield app, client
    sys.modules.pop('app', None)


def authorize(client):
    response = client.post('/api/admin/login', json={'username': 'operator', 'password': 'test-secret-123456'})
    assert response.status_code == 200, response.text
    return {'X-CSRF-Token': response.json()['csrf']}


def test_public_initial_and_protected_actions(rig):
    _, client = rig
    result = client.get('/api/public')
    assert result.status_code == 200
    data = result.json()
    assert data == {'masked': True}
    assert 'Everything will be revealed soon' in client.get('/').text
    assert client.get('/static/public.js').status_code == 404
    assert client.post('/api/admin/select', json={'track': 'A'}).status_code == 401
    assert client.post('/api/admin/login', json={'username': 'operator', 'password': 'wrong'}).status_code == 401
    headers = authorize(client)
    assert client.post('/api/admin/select', json={'track': 'A'}).status_code == 403
    assert client.post('/api/admin/select', json={'track': 'A'}, headers=headers).status_code == 200
    assert client.get('/api/public').json() == {'masked': True}
    client.post('/api/admin/visibility', json={'revealed': True}, headers=headers).raise_for_status()
    data = client.get('/api/public').json()
    assert data['state']['phase'] == 'locked'
    assert set(data['questions']) == {'A'}  # unchosen question not disclosed after locking


def test_timer_lifecycle_survives_refresh(rig):
    _, client = rig
    headers = authorize(client)
    client.post('/api/admin/visibility', json={'revealed': True}, headers=headers).raise_for_status()
    assert client.post('/api/admin/timer', json={'action': 'start'}, headers=headers).status_code == 409
    client.post('/api/admin/select', json={'track': 'B'}, headers=headers).raise_for_status()
    client.post('/api/admin/timer', json={'action': 'start', 'duration_minutes': 2}, headers=headers).raise_for_status()
    first = client.get('/api/public').json()['state']
    assert first['phase'] == 'running'
    assert 115 < first['remaining'] <= 120
    assert client.post('/api/admin/select', json={'track': 'A'}, headers=headers).status_code == 409
    client.post('/api/admin/timer', json={'action': 'pause'}, headers=headers).raise_for_status()
    frozen = client.get('/api/public').json()['state']
    assert frozen['phase'] == 'paused'
    assert frozen['ends_at'] is None
    client.post('/api/admin/timer', json={'action': 'resume'}, headers=headers).raise_for_status()
    assert client.get('/api/public').json()['state']['phase'] == 'running'
    client.post('/api/admin/timer', json={'action': 'finish'}, headers=headers).raise_for_status()
    assert client.get('/api/public').json()['state']['phase'] == 'finished'
    client.post('/api/admin/timer', json={'action': 'reset_timer'}, headers=headers).raise_for_status()
    assert client.get('/api/public').json()['state']['phase'] == 'locked'
    client.post('/api/admin/timer', json={'action': 'reset_round'}, headers=headers).raise_for_status()
    assert client.get('/api/public').json()['state']['selected'] is None


def test_question_edit_and_resources(rig):
    _, client = rig
    headers = authorize(client)
    client.post('/api/admin/visibility', json={'revealed': True}, headers=headers).raise_for_status()
    patch = {'title': 'Changed Helios I', 'subtitle': 'Geometry', 'blurb': 'A different problem', 'content': '## A1\n\n:: x² + y² = 1'}
    client.put('/api/admin/questions/A', headers=headers, json=patch).raise_for_status()
    public = client.get('/api/public').json()
    assert public['questions']['A']['title'] == 'Changed Helios I'
    assert 'x²' in public['questions']['A']['content']
    assert client.post('/api/admin/resources', headers=headers, json={'title': 'Useful page', 'url': 'javascript:alert(1)'}).status_code == 422
    client.post('/api/admin/resources', headers=headers, json={'title': 'Useful page', 'url': 'https://example.com/docs'}).raise_for_status()
    assert client.get('/api/public').json()['resources'] == []
    all_resources = client.get('/api/admin/state').json()['resources']
    rid = all_resources[0]['id']
    client.patch(f'/api/admin/resources/{rid}', json={'visible': True}, headers=headers).raise_for_status()
    assert len(client.get('/api/public').json()['resources']) == 1
    client.delete(f'/api/admin/resources/{rid}', headers=headers).raise_for_status()
    assert len(client.get('/api/public').json()['resources']) == 0


def test_upload_and_private_access(rig):
    _, client = rig
    headers = authorize(client)
    client.post('/api/admin/visibility', json={'revealed': True}, headers=headers).raise_for_status()
    resp = client.post('/api/admin/resources/upload?title=Question%20paper&visible=false', headers=headers,
                       files={'file': ('paper.pdf', b'%PDF-1.4\nhello', 'application/pdf')})
    assert resp.status_code == 200, resp.text
    rid = client.get('/api/admin/state').json()['resources'][0]['id']
    client.post('/api/admin/logout', headers=headers).raise_for_status()
    assert client.get(f'/api/resources/{rid}/download').status_code == 401
    headers = authorize(client)
    client.patch(f'/api/admin/resources/{rid}', json={'visible': True}, headers=headers).raise_for_status()
    result = client.get(f'/api/resources/{rid}/download')
    assert result.status_code == 200
    assert result.content.startswith(b'%PDF')


def test_auth_cookie_and_question_after_selection(rig):
    _, client = rig
    headers = authorize(client)
    client.post('/api/admin/visibility', json={'revealed': True}, headers=headers).raise_for_status()
    client.post('/api/admin/select', json={'track': 'B'}, headers=headers).raise_for_status()
    res=client.get('/api/public').json()
    assert res['questions']['B']['title']=='Project Helios II'
    assert 'A' not in res['questions']
    session=client.get('/api/admin/session')
    assert session.status_code == 200
    assert session.json()['csrf'] == headers['X-CSRF-Token']
    assert client.cookies.get('r3_session')


def test_clock_expires_and_database_state_persists(rig):
    app, client = rig
    headers = authorize(client)
    client.post('/api/admin/visibility', json={'revealed': True}, headers=headers).raise_for_status()
    client.post('/api/admin/select', json={'track': 'A'}, headers=headers).raise_for_status()
    client.post('/api/admin/timer', json={'action': 'start', 'duration_minutes': 1}, headers=headers).raise_for_status()
    with app.transaction() as db:
        db.execute('UPDATE settings SET ends_at=? WHERE id=1', (app.time.time() - 2,))
    result=client.get('/api/public').json()
    assert result['state']['phase'] == 'finished'
    assert result['state']['remaining'] == 0
    app.init_db()  # Simulates restarting the application without deleting persistent data
    restored=client.get('/api/public').json()
    assert restored['state']['phase'] == 'finished'
    assert restored['state']['selected'] == 'A'

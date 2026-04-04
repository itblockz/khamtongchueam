from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_healthcheck_exposes_supported_engines() -> None:
  response = client.get('/api/health')

  assert response.status_code == 200
  payload = response.json()

  assert payload['status'] == 'ok'
  assert payload['defaultEngine'] == 'han_solo'
  assert {'han_solo', 'ssg', 'tltk'}.issubset(set(payload['engines']))


def test_healthcheck_supports_head_requests() -> None:
  response = client.head('/api/health')

  assert response.status_code == 200


def test_syllable_api_returns_written_syllables() -> None:
  response = client.post(
    '/api/syllables',
    json={
      'text': 'กาแฟ',
      'engine': 'han_solo',
    },
  )

  assert response.status_code == 200
  payload = response.json()

  assert payload['syllables'] == ['กา', 'แฟ']
  assert payload['engine'] == 'han_solo'
  assert payload['mode'] == 'written'
  assert 'pythainlp=' in payload['modelVersion']

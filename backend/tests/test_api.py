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


def test_syllable_api_points_out_hints_for_the_judge() -> None:
  plain = client.post('/api/syllables', json={'text': 'บ้าน'}).json()
  assert plain['hints'] == []

  verb = client.post('/api/syllables', json={'text': 'กิน'}).json()
  assert verb['hints'] == [{'kind': 'not-noun', 'of': None, 'english': None, 'by': 'dictionary'}]
  assert verb['checked'] is None

  translated = client.post('/api/syllables', json={'text': 'หมา', 'previous': 'ด็อก'}).json()
  assert translated['hints'] == [{'kind': 'translation', 'of': 'ด็อก', 'english': 'dog', 'by': 'dictionary'}]

  # sent: says how it was checked (no key in tests: the dictionaries only)
  sent = client.post('/api/syllables', json={'text': 'หมา', 'previous': 'ด็อก', 'check': True}).json()
  assert sent['checked'] == {'by': 'dictionary', 'reason': 'off', 'model': None, 'until': None}


def test_judge_game_accepts_hints() -> None:
  from backend.app.main import JudgeGameData
  data = JudgeGameData(
    version=1, mode='normal', playerCount=2, startedAt=1,
    events=[{'type': 'word', 'playerId': 'p1', 'word': 'หมา', 'syllables': ['หมา'], 'hints': ['translation'],
             'hintInfo': [{'kind': 'translation', 'by': 'model', 'english': 'dog', 'passed': True}],
             'checked': {'by': 'model', 'model': 'gemma-4-26b-a4b-it'}}],
  )
  assert data.events[0].hints == ['translation']
  assert data.events[0].hintInfo[0].passed is True

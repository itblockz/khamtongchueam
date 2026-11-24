import pytest
from fastapi.testclient import TestClient

from backend.app import feedback
from backend.app.main import app

client = TestClient(app)


class FakeResponse:
  status_code = 201
  text = ''


@pytest.fixture
def posted(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict, dict]]:
  calls: list[tuple[str, dict, dict]] = []

  def fake_post(url: str, json: dict, headers: dict, timeout: int) -> FakeResponse:
    calls.append((url, json, headers))
    return FakeResponse()

  monkeypatch.setenv('SUPABASE_URL', 'https://example.supabase.co/')
  monkeypatch.setenv('SUPABASE_SECRET_KEY', 'sb_secret_test')
  monkeypatch.setattr(feedback.requests, 'post', fake_post)
  return calls


def test_feedback_is_off_without_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.delenv('SUPABASE_URL', raising=False)
  monkeypatch.delenv('SUPABASE_SECRET_KEY', raising=False)

  response = client.post('/api/feedback/words', json={'text': 'กาแฟ', 'event': 'submit'})

  assert response.status_code == 202
  assert response.json() == {'recorded': False}
  assert client.get('/api/health').json()['feedbackEnabled'] is False


def test_word_event_is_sent_with_server_side_syllables(posted: list) -> None:
  response = client.post('/api/feedback/words', json={'text': ' มหาวิทยาลัย ', 'event': 'submit'})

  assert response.json() == {'recorded': True}
  url, body, headers = posted[0]
  assert url == 'https://example.supabase.co/rest/v1/rpc/record_word_event'
  assert body['p_text'] == 'มหาวิทยาลัย'
  assert body['p_syllables'] == ['ม', 'หา', 'วิท', 'ยา', 'ลัย']
  assert body['p_event'] == 'submit'
  assert headers['apikey'] == 'sb_secret_test'
  assert 'Authorization' not in headers


def test_symbols_only_text_is_not_recorded(posted: list) -> None:
  response = client.post('/api/feedback/words', json={'text': '!!!', 'event': 'submit'})

  assert response.json() == {'recorded': False}
  assert posted == []


def test_unknown_event_is_rejected(posted: list) -> None:
  response = client.post('/api/feedback/words', json={'text': 'กาแฟ', 'event': 'delete_all'})

  assert response.status_code == 422
  assert posted == []


def test_report_stores_correction_and_counts_word(posted: list) -> None:
  response = client.post(
    '/api/feedback/reports',
    json={'text': 'สมาน', 'syllables': ['สมาน']},
  )

  assert response.json() == {'recorded': True}
  report_url, report_body, _ = posted[0]
  assert report_url.endswith('/rest/v1/syllable_reports')
  assert report_body['reported_syllables'] == ['สมาน']
  assert report_body['segmenter_syllables'] == ['ส', 'มาน']
  assert posted[1][1]['p_event'] == 'report'


def test_report_rejects_too_long_syllables(posted: list) -> None:
  response = client.post(
    '/api/feedback/reports',
    json={'text': 'กาแฟ', 'syllables': ['ก' * 21]},
  )

  assert response.status_code == 422
  assert posted == []

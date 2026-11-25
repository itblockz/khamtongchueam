import pytest


@pytest.fixture(autouse=True)
def _no_word_checks():
  """Tests never reach Supabase for the answer bank."""
  from backend.app.word_checks import reset_for_tests

  reset_for_tests({})
  yield
  reset_for_tests({})

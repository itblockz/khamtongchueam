import pytest

from backend.app.syllables import (
  DEFAULT_ENGINE,
  get_model_version,
  segment_syllables,
)


@pytest.mark.parametrize(
  ('text', 'expected'),
  [
    ('กาแฟ', ['กา', 'แฟ']),
    ('ต้นไม้', ['ต้น', 'ไม้']),
    ('กรุงเทพ', ['กรุง', 'เทพ']),
    ('ประเทศไทย', ['ประ', 'เทศ', 'ไทย']),
    ('กล้วย', ['กล้วย']),
    ('สับปะรด', ['สับ', 'ปะ', 'รด']),
    ('คำตอบ', ['คำ', 'ตอบ']),
    ('อร่อย', ['อร่อย']),
    ('มะม่วง', ['มะ', 'ม่วง']),
    ('กาแฟ กล้วย', ['กา', 'แฟ', 'กล้วย']),
    ('ประเทศไทย!', ['ประ', 'เทศ', 'ไทย', '!']),
  ],
)
def test_default_engine_matches_curated_written_syllables(
  text: str,
  expected: list[str],
) -> None:
  assert segment_syllables(text, DEFAULT_ENGINE) == expected


@pytest.mark.parametrize('engine', ['han_solo', 'ssg', 'tltk'])
def test_supported_engines_segment_common_words(engine: str) -> None:
  assert segment_syllables('คำตอบ', engine) == ['คำ', 'ตอบ']


def test_model_version_contains_engine_metadata() -> None:
  version = get_model_version('han_solo')

  assert 'pythainlp=' in version
  assert 'python-crfsuite=' in version

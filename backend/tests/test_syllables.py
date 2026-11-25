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
    ('ประเทศไทย!', ['ประ', 'เทศ', 'ไทย']),
    ('เด็กๆ', ['เด็ก']),
    ('สบาย', ['ส', 'บาย']),
    ('มหาวิทยาลัย', ['ม', 'หา', 'วิท', 'ยา', 'ลัย']),
    ('ขนม', ['ขนม']),
    ('จมูก', ['จมูก']),
    ('หมา', ['หมา']),
    ('กล้วย', ['กล้วย']),
    ('ธรรมชาติ', ['ธรรม', 'ชาติ']),
    ('ราชการ', ['ราช', 'การ']),
    ('คน', ['คน']),
    ('อุบัติเหตุ', ['อุ', 'บัติ', 'ติ', 'เหตุ']),
    ('อุบัติเหตุทางถนน', ['อุ', 'บัติ', 'ติ', 'เหตุ', 'ทาง', 'ถนน']),
    ('วงศ์', ['วงศ์']),
    ('สมาคม', ['ส', 'มา', 'คม']),
    ('อนาคต', ['อ', 'นา', 'คต']),
    ('ขมิ้น', ['ข', 'มิ้น']),
    ('สมุด', ['สมุด']),
    ('อยู่', ['อยู่']),
    ('ทนต์', ['ทนต์']),
    ('พระราชวงศ์', ['พระ', 'ราช', 'วงศ์']),
    ('หิตพจน์', ['หิต', 'พจน์']),
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


@pytest.mark.parametrize(
  ('text', 'expected'),
  [
    ('กทม.', ['กอ', 'ทอ', 'มอ']),
    ('ก.ท.ม.', ['กอ', 'ทอ', 'มอ']),
    ('ร.ร.', ['รอ', 'รอ']),
    ('พ.ศ.', ['พอ', 'ศอ']),
    ('จ.', ['จอ']),
    ('อบต.', ['ออ', 'บอ', 'ตอ']),
  ],
)
def test_abbreviations_are_read_letter_by_letter(text: str, expected: list[str]) -> None:
  assert segment_syllables(text) == expected


def test_an_abbreviation_part_with_a_vowel_is_split_like_a_word() -> None:
  assert segment_syllables('เม.ย.') == ['เม', 'ยอ']


def test_a_word_without_a_dot_is_not_an_abbreviation() -> None:
  assert segment_syllables('คน') == ['คน']


@pytest.mark.parametrize(
  ('text', 'expected'),
  [
    ('อวกาศ', ['อ', 'ว', 'กาศ']),
    ('อวตาร', ['อ', 'ว', 'ตาร']),
    ('อวยพร', ['อวย', 'พร']),
  ],
)
def test_a_bare_wo_wan_after_a_consonant_is_its_own_syllable(text: str, expected: list[str]) -> None:
  assert segment_syllables(text) == expected


def test_a_silent_letter_with_a_vowel_joins_the_syllable_before() -> None:
  assert segment_syllables('สิตางศุ์') == ['สิ', 'ตางศุ์']
  assert segment_syllables('ศักดิ์ศรี') == ['ศักดิ์', 'ศรี']

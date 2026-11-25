from backend.app.hints import hints_for, may_not_be_noun, translation_between


def test_not_a_noun_only_when_no_sense_is_a_noun() -> None:
  assert may_not_be_noun('กิน')
  assert may_not_be_noun('สวย')
  assert not may_not_be_noun('บ้าน')
  assert not may_not_be_noun('ดี')  # น้ำดี: has a noun sense
  assert not may_not_be_noun('เรสซิเดนท์อีวิล')  # unknown words stay quiet


def test_translation_either_way() -> None:
  assert translation_between('ด็อก', 'หมา') == 'dog'
  assert translation_between('หมา', 'ด็อก') == 'dog'
  assert translation_between('น้ำ', 'วอเตอร์') == 'water'
  assert translation_between('ปลา', 'ฟิช') == 'fish'


def test_no_translation_for_words_that_only_sound_alike_or_are_related() -> None:
  assert translation_between('วง', 'เวที') is None  # venue ~ วง by sound only
  assert translation_between('ถุงมือ', 'ครัว') is None  # glove ~ ครัว
  assert translation_between('แมว', 'หมา') is None
  assert translation_between('หมา', 'หมา') is None


def test_hints_for_combines_both() -> None:
  assert hints_for('กิน') == [{'kind': 'not-noun'}]
  assert hints_for('หมา', 'ด็อก') == [{'kind': 'translation', 'of': 'ด็อก', 'english': 'dog'}]
  assert hints_for('บ้าน', None) == []


def test_checked_answers_override_the_dictionaries() -> None:
  from backend.app.word_checks import WordCheck, reset_for_tests

  try:
    reset_for_tests({
      'ตก': WordCheck(noun=True, english=()),  # confirmed: can be a noun
      'บ้าน': WordCheck(noun=False, english=()),
      'แมวน้ำ': WordCheck(noun=None, english=('seal',)),
    })
    assert not may_not_be_noun('ตก')
    assert may_not_be_noun('บ้าน')
    assert may_not_be_noun('กิน')  # no row: the dictionaries decide
    assert translation_between('แมวน้ำ', 'ซีล') == 'seal'
  finally:
    reset_for_tests()


def test_gemini_answers_are_used_when_the_word_is_sent(monkeypatch) -> None:
  from backend.app import llm

  monkeypatch.setattr(llm, 'check', lambda previous, word: llm.Verdict(
    noun={'กิน': False, 'หญิงสาว': False, 'ตก': True}.get(word),
    translation='dog' if (previous, word) == ('ด็อก', 'หมาน้อย') else None,
    answered=True,
  ))
  # Gemini: not a noun → hint (no dictionary gives กิน a noun sense)
  assert hints_for('กิน', 'ข้าว', ask_model=True) == [{'kind': 'not-noun'}]
  # a dictionary noun sense overrules Gemini
  assert hints_for('หญิงสาว', 'คาน', ask_model=True) == []
  # Gemini says ตก is a noun here (ทิศตะวันตก): no hint, though the dictionaries would give one
  assert hints_for('ตก', 'ออก', ask_model=True) == []
  assert hints_for('ตก', 'ออก') == [{'kind': 'not-noun'}]
  # a translation only Gemini finds
  assert hints_for('หมาน้อย', 'ด็อก', ask_model=True) == [{'kind': 'translation', 'of': 'ด็อก', 'english': 'dog'}]


def test_without_a_key_gemini_is_not_asked(monkeypatch) -> None:
  from backend.app import llm

  monkeypatch.delenv('GEMINI_API_KEY', raising=False)
  assert llm.check('ด็อก', 'หมา') == {'noun': None, 'translation': None, 'answered': False}
  assert hints_for('หมา', 'ด็อก', ask_model=True) == [{'kind': 'translation', 'of': 'ด็อก', 'english': 'dog'}]

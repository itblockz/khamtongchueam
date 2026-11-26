"""Hints for the judge: a word that may not be a noun, or may be a translation of
the word before it. Hints only point things out; the judge always decides.

The data comes from free dictionaries, built by backend/benchmarks/build_word_hints.py.
Measured on game words (see the PR notes): about 1 in 100 accepted words gets a
not-a-noun hint, and translations are caught when both words are in the data.
"""
from __future__ import annotations

import csv
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypedDict

from . import llm
from .word_checks import checks

DATA = Path(__file__).resolve().parent / 'data' / 'word_hints.json'


class Hint(TypedDict, total=False):
  kind: Literal['not-noun', 'translation']
  of: str
  english: str
  # who pointed it out: a checked answer, Gemini, the dictionaries, or both of the last two
  by: Literal['confirmed', 'model', 'dictionary', 'both']


class Checked(TypedDict, total=False):
  """How a sent word was checked: by Gemini, or only by the dictionaries (and why)."""
  by: Literal['model', 'dictionary']
  reason: Literal['off', 'quota', 'timeout', 'error']
  model: str
  # with reason 'quota': when Gemini will be asked again (epoch milliseconds)
  until: int


@lru_cache(maxsize=1)
def _data() -> tuple[frozenset[str], dict[str, list[str]], dict[str, set[str]], frozenset[str]]:
  raw = json.loads(DATA.read_text(encoding='utf-8'))
  return frozenset(raw['notNoun']), raw['gloss'], _transliterations(), frozenset(raw.get('noun', []))


def _transliterations() -> dict[str, set[str]]:
  """Thai transliteration → English word, from the table PyThaiNLP ships with."""
  import pythainlp.corpus as corpus

  out: dict[str, set[str]] = {}
  table = Path(corpus.__file__).resolve().parent / 'th_en_transliteration_v1.4.tsv'
  try:
    with open(table, encoding='utf-8') as f:
      for row in csv.DictReader(f, delimiter='\t'):
        out.setdefault(row['th'], set()).add(row['en'].lower())
  except OSError:
    pass  # hints still work from the sound match alone
  return out


def may_not_be_noun(word: str) -> bool:
  word = word.strip()
  checked = checks().get(word)
  if checked is not None and checked.noun is not None:
    return not checked.noun  # a checked answer beats the dictionaries
  return word in _data()[0]


def _meanings(word: str) -> list[str]:
  """English meanings: checked ones first, then the dictionary's."""
  checked = checks().get(word)
  extra = list(checked.english) if checked else []
  return extra + [e for e in _data()[1].get(word, []) if e not in extra]


# Thai consonants and English letters reduced to the same sound skeleton, so that
# ด็อก and dog both read D-K. Vowels and tone marks are dropped.
_TH_SOUNDS = {}
for _chars, _key in [
  ('กขฃคฅฆ', 'K'), ('ง', 'N'), ('จฉชฌ', 'C'), ('ซศษส', 'S'), ('ดฎ', 'D'),
  ('ตฏทธถฐฑฒ', 'T'), ('นณ', 'N'), ('บ', 'B'), ('ปพผภ', 'P'), ('ฟฝ', 'F'),
  ('ม', 'M'), ('ยญ', 'Y'), ('รลฬ', 'L'), ('ว', 'W'), ('หฮ', 'H'), ('อ', ''),
]:
  for _ch in _chars:
    _TH_SOUNDS[_ch] = _key
_EN_SOUNDS = {
  'c': 'K', 'k': 'K', 'q': 'K', 'g': 'K', 'j': 'C', 's': 'S', 'z': 'S', 'd': 'D',
  't': 'T', 'n': 'N', 'b': 'B', 'p': 'P', 'f': 'F', 'v': 'W', 'm': 'M', 'y': 'Y',
  'r': 'L', 'l': 'L', 'w': 'W', 'h': 'H',
}


def _collapse(text: str) -> str:
  return re.sub(r'(.)\1+', r'\1', text)


def _thai_skeletons(word: str) -> set[str]:
  """With and without letters marked silent (เฮาส์ is H or H-S)."""
  word = word.replace(' ', '')
  spoken = re.sub(r'[ก-ฮ][ิุ]?์', '', word)
  keys = {_collapse(''.join(_TH_SOUNDS.get(ch, '') for ch in form)) for form in (word.replace('์', ''), spoken)}
  return {key for key in keys if len(key) >= 2}


def _english_skeleton(word: str) -> str:
  word = word.lower().replace(' ', '').replace('-', '')
  for spelling, sound in [
    ('sch', 'SK'), ('ch', 'C'), ('sh', 'C'), ('ph', 'F'), ('th', 'T'), ('ck', 'K'),
    ('ng', 'N'), ('qu', 'KW'), ('x', 'KS'), ('wh', 'W'),
  ]:
    word = word.replace(spelling, sound)
  word = re.sub(r'c(?=[eiy])', 'S', word)
  return _collapse(''.join(ch if ch.isupper() else _EN_SOUNDS.get(ch, '') for ch in word))


def _sounds_like(thai: str, english: str) -> bool:
  key = _english_skeleton(english)
  return len(key) >= 2 and key in _thai_skeletons(thai)


def translation_between(previous: str, word: str) -> str | None:
  """The English word if one of the two is Thai for it and the other is that
  English word written in Thai (หมา → ด็อก, ด็อก → หมา); otherwise None."""
  translit = _data()[2]
  previous, word = previous.strip(), word.strip()
  if not previous or not word or previous == word:
    return None
  for thai, loan in ((previous, word), (word, previous)):
    loan_meanings = _meanings(loan)
    for english in _meanings(thai):
      if _sounds_like(thai, english):
        continue  # the "Thai" word is itself the loan
      if loan_meanings and english not in loan_meanings:
        continue  # a Thai word of its own that only sounds alike (วง, venue)
      if english in translit.get(loan, []) or _sounds_like(loan, english):
        return english
  return None


def hints_for(word: str, previous: str | None = None, ask_model: bool = False) -> list[Hint]:
  """Dictionaries always; with ask_model (when the word is sent) Gemini too, if set up."""
  return check_word(word, previous, ask_model)[0]


def check_word(word: str, previous: str | None = None, ask_model: bool = False) -> tuple[list[Hint], Checked | None]:
  """The hints for a word, and (with ask_model) how it was checked.

  - not a noun: a checked answer decides; else Gemini (with the word before as
    context), unless a dictionary gives the word a noun sense; else the dictionaries.
  - translation: Gemini or the dictionaries, whichever finds one.
  """
  word = word.strip()
  previous = previous.strip() if previous else None
  verdict = llm.check(previous, word) if ask_model else llm.Verdict(noun=None, translation=None, answered=False, reason=None)
  hints: list[Hint] = []

  checked = checks().get(word)
  if checked is not None and checked.noun is not None:
    if not checked.noun:
      hints.append({'kind': 'not-noun', 'by': 'confirmed'})
  elif verdict['noun'] is not None:
    if verdict['noun'] is False and word not in _data()[3]:
      hints.append({'kind': 'not-noun', 'by': 'both' if may_not_be_noun(word) else 'model'})
  elif may_not_be_noun(word):
    hints.append({'kind': 'not-noun', 'by': 'dictionary'})

  if previous:
    from_dictionary = translation_between(previous, word)
    from_model = verdict['translation']
    english = from_model or from_dictionary
    if english:
      by = 'both' if from_model and from_dictionary else 'model' if from_model else 'dictionary'
      hints.append({'kind': 'translation', 'of': previous, 'english': english, 'by': by})

  if not ask_model:
    return hints, None
  if verdict['answered']:
    return hints, {'by': 'model', 'model': llm.model()}
  result: Checked = {'by': 'dictionary', 'reason': verdict['reason'] or 'error'}
  until = llm.resting_until()
  if verdict['reason'] == 'quota' and until:
    result['until'] = int(until * 1000)
  return hints, result

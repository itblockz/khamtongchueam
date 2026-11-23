from __future__ import annotations

import re
from functools import lru_cache
from importlib.metadata import version
from typing import Literal

from pythainlp.tokenize import syllable_tokenize

SyllableEngine = Literal['han_solo', 'ssg', 'tltk']

DEFAULT_ENGINE: SyllableEngine = 'han_solo'
SUPPORTED_ENGINES: tuple[SyllableEngine, ...] = ('han_solo', 'ssg', 'tltk')
SEGMENTATION_MODE = 'written'


class SegmentationEngineError(RuntimeError):
  """Raised when a configured segmentation engine is unavailable."""


def get_supported_engines() -> tuple[SyllableEngine, ...]:
  return SUPPORTED_ENGINES


@lru_cache(maxsize=1)
def get_pythainlp_version() -> str:
  return version('pythainlp')


@lru_cache(maxsize=None)
def get_model_version(engine: SyllableEngine) -> str:
  version_parts = [f'pythainlp={get_pythainlp_version()}']

  if engine == 'han_solo':
    version_parts.extend(
      [
        'engine=han_solo',
        f'python-crfsuite={version("python-crfsuite")}',
      ],
    )
  elif engine == 'ssg':
    version_parts.extend(
      [
        f'ssg={version("ssg")}',
        f'python-crfsuite={version("python-crfsuite")}',
      ],
    )
  else:
    version_parts.extend(
      [
        f'tltk={version("tltk")}',
        f'pandas={version("pandas")}',
        f'requests={version("requests")}',
      ],
    )

  return '; '.join(version_parts)


# Segmentation convention (written syllables, game rule):
# - split every syllable, including a consonant that carries an unwritten
#   vowel (ส|บาย, ม|หา, ท|หาร);
# - never split a leading-consonant pair (อักษรนำ: ขนม, ตลาด, หมา), because the
#   second part would read differently on its own (นม vs หนม);
# - a consonant pronounced twice (ราชการ) is not repeated, except for words
#   listed in SYLLABLE_EXCEPTIONS;
# - symbols, digits and non-Thai text (ๆ ฯ ! ...) are dropped.
HIGH_CLASS = frozenset('ขฃฉฐถผฝศษสห')
MID_CLASS = frozenset('กจฎฏดตบปอ')
LOW_SINGLE = frozenset('งญณนมยรลวฬ')
THAI_CONSONANTS = frozenset('กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ')
LEADING_VOWELS = frozenset('เแโใไ')
CONSONANT_CLUSTERS = frozenset(
  {
    'กร', 'กล', 'กว', 'ขร', 'ขล', 'ขว', 'คร', 'คล', 'คว', 'ตร', 'ปร', 'ปล',
    'พร', 'พล', 'บร', 'บล', 'ดร', 'ฟร', 'ฟล', 'ทร', 'จร', 'ซร', 'ศร', 'สร',
  },
)

# Words whose syllables cannot be derived from the rules above. The game uses
# exactly this segmentation; alternative readings live in the benchmark gold set.
SYLLABLE_EXCEPTIONS: dict[str, tuple[str, ...]] = {
  'อุบัติเหตุ': ('อุ', 'บัติ', 'ติ', 'เหตุ'),
  'จระเข้': ('จ', 'ระ', 'เข้'),
  'โทรทัศน์': ('โท', 'ร', 'ทัศน์'),
  'โทรศัพท์': ('โท', 'ร', 'ศัพท์'),
  'ไปรษณีย์': ('ไปร', 'ษ', 'ณีย์'),
  'วัฒนธรรม': ('วัฒ', 'น', 'ธรรม'),
  'เศรษฐกิจ': ('เศรษ', 'ฐ', 'กิจ'),
  'บริษัท': ('บ', 'ริ', 'ษัท'),
  'อุตสาหกรรม': ('อุต', 'สา', 'ห', 'กรรม'),
  'พฤหัสบดี': ('พ', 'ฤ', 'หัส', 'บ', 'ดี'),
  'ไอศกรีม': ('ไอ', 'ศ', 'กรีม'),
}

_EXCEPTION_PATTERN = re.compile(
  '(' + '|'.join(
    re.escape(word) for word in sorted(SYLLABLE_EXCEPTIONS, key=len, reverse=True)
  ) + ')',
)
_THAI_CONSONANT_PATTERN = re.compile('[ก-ฮ]')


def is_leading_consonant_pair(first: str, second: str) -> bool:
  return first in (HIGH_CLASS | MID_CLASS) and second in LOW_SINGLE


_SILENT_PATTERN = re.compile('[ก-ฮ][ิุ]?์')


def is_pronounceable(text: str) -> bool:
  """True if `text` can stand as a syllable: it has a vowel sign, or at least two
  sounding consonants (initial + final). Silent letters marked with ์ do not count,
  so the rest of วงศ์ (งศ์) or ทนต์ (นต์) is not a syllable on its own."""
  sounding = _SILENT_PATTERN.sub('', text)
  if any(char not in THAI_CONSONANTS for char in sounding):
    return True
  return len(sounding) >= 2


def split_unwritten_vowel(chunk: str) -> list[str]:
  if len(chunk) < 3 or chunk[0] not in THAI_CONSONANTS:
    return [chunk]

  first, second, rest = chunk[0], chunk[1], chunk[1:]

  if second in LEADING_VOWELS:
    return [first, rest]

  if (
    second not in THAI_CONSONANTS
    or is_leading_consonant_pair(first, second)
    or first + second in CONSONANT_CLUSTERS
    or rest.startswith('รร')
    or second == 'อ'
    or (second == 'ว' and all(char in THAI_CONSONANTS for char in rest[1:]))
    or not is_pronounceable(rest)
  ):
    return [chunk]

  return [first, *split_unwritten_vowel(rest)]


def apply_syllable_rules(chunks: list[str]) -> list[str]:
  syllables: list[str] = []

  for chunk in chunks:
    previous = syllables[-1] if syllables else ''

    if len(previous) == 1 and chunk and is_leading_consonant_pair(previous, chunk[0]):
      syllables[-1] = previous + chunk
      continue

    syllables.extend(split_unwritten_vowel(chunk))

  return syllables


def is_supported_syllable(syllable: str) -> bool:
  return bool(_THAI_CONSONANT_PATTERN.search(syllable))


def _tokenize(text: str, engine: SyllableEngine) -> list[str]:
  try:
    chunks = syllable_tokenize(text, engine=engine, keep_whitespace=False)
  except ImportError as error:
    raise SegmentationEngineError(
      f'ไม่สามารถใช้งาน engine {engine} ได้ใน environment ปัจจุบัน',
    ) from error

  cleaned = [chunk.replace('<s/>', '').strip() for chunk in chunks]
  return apply_syllable_rules([chunk for chunk in cleaned if chunk])


def segment_syllables(
  text: str,
  engine: SyllableEngine = DEFAULT_ENGINE,
) -> list[str]:
  normalized_text = text.strip()

  if not normalized_text:
    return []

  syllables: list[str] = []

  for piece in _EXCEPTION_PATTERN.split(normalized_text):
    if not piece.strip():
      continue

    if piece in SYLLABLE_EXCEPTIONS:
      syllables.extend(SYLLABLE_EXCEPTIONS[piece])
    else:
      syllables.extend(_tokenize(piece, engine))

  return [syllable for syllable in syllables if is_supported_syllable(syllable)]

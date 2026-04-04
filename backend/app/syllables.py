from __future__ import annotations

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


def segment_syllables(
  text: str,
  engine: SyllableEngine = DEFAULT_ENGINE,
) -> list[str]:
  normalized_text = text.strip()

  if not normalized_text:
    return []

  try:
    syllables = syllable_tokenize(
      normalized_text,
      engine=engine,
      keep_whitespace=False,
    )
  except ImportError as error:
    raise SegmentationEngineError(
      f'ไม่สามารถใช้งาน engine {engine} ได้ใน environment ปัจจุบัน',
    ) from error

  return [syllable.strip() for syllable in syllables if syllable.strip()]

"""The shared answer bank (Supabase table word_checks): checked answers per word
that override the bundled dictionaries. Read by every game, so each word only has
to be worked out once, whatever the number of players.

Kept in memory and refreshed every few minutes; if Supabase cannot be reached the
last copy (or nothing) is used, so hints never wait on it for long.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import requests

from . import feedback

logger = logging.getLogger(__name__)

REFRESH_SECONDS = 300
TIMEOUT_SECONDS = 2


@dataclass(frozen=True)
class WordCheck:
  noun: bool | None
  english: tuple[str, ...]


_cache: dict[str, WordCheck] = {}
_loaded_at = 0.0


def _fetch() -> dict[str, WordCheck] | None:
  config = feedback._config()
  if config is None:
    return {}
  url, key = config
  try:
    response = requests.get(
      f'{url}/rest/v1/word_checks',
      params={'select': 'word,noun,english'},
      headers=feedback._headers(key),
      timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 300:
      logger.warning('word_checks read failed: %s %s', response.status_code, response.text[:200])
      return None
    return {
      row['word']: WordCheck(row.get('noun'), tuple(e.lower() for e in row.get('english') or []))
      for row in response.json()
    }
  except (requests.RequestException, ValueError, KeyError, TypeError) as error:
    logger.warning('word_checks read failed: %s', error)
    return None


def checks() -> dict[str, WordCheck]:
  global _cache, _loaded_at
  now = time.monotonic()
  if now - _loaded_at >= REFRESH_SECONDS or not _loaded_at:
    fresh = _fetch()
    _loaded_at = now  # a failed read is retried after the next interval, not on every word
    if fresh is not None:
      _cache = fresh
  return _cache


def reset_for_tests(rows: dict[str, WordCheck] | None = None) -> None:
  global _cache, _loaded_at
  _cache = rows or {}
  _loaded_at = time.monotonic() if rows is not None else 0.0

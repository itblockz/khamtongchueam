"""Collect the words players submit, anonymously, to improve syllable segmentation.

Words go to the Supabase project's tables `syllable_words` (counts per word) and
`syllable_reports` (GM corrections). Only this backend writes, with the project's
secret key; browsers never talk to Supabase directly. Collection is off unless
both SUPABASE_URL and SUPABASE_SECRET_KEY are set.
"""
from __future__ import annotations

import logging
import os
from typing import Literal

import requests

logger = logging.getLogger(__name__)

WordEvent = Literal['submit', 'duplicate_elimination', 'undo_after_duplicate', 'host_duplicate', 'report']
MAX_TEXT_LENGTH = 60
REQUEST_TIMEOUT_SECONDS = 5


def _config() -> tuple[str, str] | None:
  url = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
  key = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
  if not url or not key:
    return None
  return url, key


def is_enabled() -> bool:
  return _config() is not None


def _headers(key: str) -> dict[str, str]:
  headers = {'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
  # Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys do not.
  if not key.startswith('sb_'):
    headers['Authorization'] = f'Bearer {key}'
  return headers


def _post(path: str, payload: dict[str, object]) -> None:
  config = _config()
  if config is None:
    return
  url, key = config
  try:
    response = requests.post(f'{url}{path}', json=payload, headers=_headers(key), timeout=REQUEST_TIMEOUT_SECONDS)
    if response.status_code >= 300:
      logger.warning('syllable feedback %s failed: %s %s', path, response.status_code, response.text[:200])
  except requests.RequestException as error:
    logger.warning('syllable feedback %s failed: %s', path, error)


def record_word_event(text: str, syllables: list[str], model_version: str, event: WordEvent) -> None:
  _post(
    '/rest/v1/rpc/record_word_event',
    {'p_text': text, 'p_syllables': syllables, 'p_model_version': model_version, 'p_event': event},
  )


def record_report(
  text: str,
  segmenter_syllables: list[str],
  reported_syllables: list[str],
  model_version: str,
) -> None:
  _post(
    '/rest/v1/syllable_reports',
    {
      'text': text,
      'segmenter_syllables': segmenter_syllables,
      'reported_syllables': reported_syllables,
      'model_version': model_version,
    },
  )
  record_word_event(text, segmenter_syllables, model_version, 'report')

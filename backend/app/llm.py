"""Gemini, for the judge's hints: is the word a noun here, and is it a translation of
the word before it. Asked when the word is sent; the answer is only a hint.
Without GEMINI_API_KEY, or if Gemini is slow or fails, the dictionaries are used.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

import requests

logger = logging.getLogger(__name__)

NOUN_PROMPT = """In a Thai word-chain game every word must be a noun. A word counts if it has at least one sense that can be a noun (proper nouns, names of people, places, brands, games and characters count). The previous word is given only as context: it may show which sense the player meant (e.g. after ซ้าย, the word ขวา can mean ด้านขวา, a noun).
Answer noun: true if the word can be a noun here, false only if it cannot be a noun.
Examples (not to be answered):
ซ้าย > ขวา: true (ด้านขวา)
แม่น้ำ > ไหล: false (a verb only)
ดอกไม้ > สวย: false (an adjective only)
เพื่อน > สมชาย: true (a name)
ร้านค้า > ซื้อ: false (a verb only)
อาหาร > ข้าว: true
ท้องฟ้า > สีฟ้า: true (the colour, a noun)
เสื้อ > ยูนิโคล่: true (a brand)
Now answer for:
{previous} > {word}"""

TRANSLATION_PROMPT = """In a Thai word-chain game, a player is not allowed to say a word that is a translation of the previous word between Thai and English (e.g. หมา after ด็อก, or ด็อก after หมา: ด็อก is "dog" written in Thai). Words that are only related in meaning, or Thai synonyms, are NOT translations.
For each pair "previous > word", answer translation: true only if one word is an English word written in Thai script and the other is the Thai word with that same meaning, and english: that English word in lowercase (null if not a translation).
Pairs:
{previous} > {word}"""

NOUN_SCHEMA = {'type': 'OBJECT', 'properties': {'noun': {'type': 'BOOLEAN'}}, 'required': ['noun']}
TRANSLATION_SCHEMA = {
  'type': 'OBJECT',
  'properties': {'translation': {'type': 'BOOLEAN'}, 'english': {'type': 'STRING', 'nullable': True}},
  'required': ['translation', 'english'],
}


# Measured best for this (see the PR): as accurate as Gemini 3.5 Flash Lite on nouns,
# faster, and with a far larger free daily quota. One model only, so answers stay
# consistent; if it fails, the dictionaries take over.
DEFAULT_MODEL = 'gemma-4-26b-a4b-it'
TIMEOUT_SECONDS = 3
MAX_CALLS_PER_MINUTE = 60  # per server instance, to cap the bill if the API is abused
CACHE_SIZE = 5000

_pool = ThreadPoolExecutor(max_workers=4)
_lock = threading.Lock()
_calls: list[float] = []
_cache: OrderedDict[tuple[str, str, str], dict] = OrderedDict()
# After a 429, Gemini is not asked again until this time (epoch seconds).
_resting_until = 0.0


def _quota_reset(body: str, now: float) -> float:
  """When to ask again after a 429: the daily quota resets at midnight Pacific time,
  the per-minute one within a minute."""
  if 'PerDay' not in body:
    return now + 60
  try:
    from zoneinfo import ZoneInfo
    pacific = ZoneInfo('America/Los_Angeles')
  except Exception:  # noqa: BLE001 - no time zone data: standard time is close enough
    pacific = timezone(timedelta(hours=-8))
  local = datetime.fromtimestamp(now, pacific)
  midnight = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
  return midnight.timestamp()


def resting_until() -> float | None:
  """While resting after a 429: when Gemini will be asked again (epoch seconds)."""
  return _resting_until if time.time() < _resting_until else None


def model() -> str:
  return os.environ.get('GEMINI_MODEL', '').strip() or DEFAULT_MODEL


def enabled() -> bool:
  return bool(os.environ.get('GEMINI_API_KEY', '').strip())


def _allow_call() -> bool:
  now = time.monotonic()
  with _lock:
    while _calls and now - _calls[0] > 60:
      _calls.pop(0)
    if len(_calls) >= MAX_CALLS_PER_MINUTE:
      return False
    _calls.append(now)
    return True


def _ask(prompt: str, schema: dict, previous: str, word: str) -> tuple[dict | None, str | None]:
  """The answer, or None and why not: 'quota' (resting after a 429, or our own cap) or 'error'."""
  global _resting_until
  key = (prompt[:20], previous, word)
  with _lock:
    if key in _cache:
      _cache.move_to_end(key)
      return _cache[key], None
  if resting_until() is not None or not _allow_call():
    return None, 'quota'
  try:
    response = requests.post(
      f'https://generativelanguage.googleapis.com/v1beta/models/{model()}:generateContent',
      headers={'Content-Type': 'application/json', 'x-goog-api-key': os.environ['GEMINI_API_KEY'].strip()},
      json={
        'contents': [{'parts': [{'text': prompt.format(previous=previous or '(none)', word=word)}]}],
        'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': schema, 'temperature': 0},
      },
      timeout=TIMEOUT_SECONDS,
    )
    if response.status_code == 429:
      with _lock:
        _resting_until = max(_resting_until, _quota_reset(response.text, time.time()))
      logger.warning('gemini quota used up, resting until %s', _resting_until)
      return None, 'quota'
    if response.status_code >= 300:
      logger.warning('gemini %s: %s', response.status_code, response.text[:200])
      return None, 'error'
    answer = json.loads(response.json()['candidates'][0]['content']['parts'][0]['text'])
  except requests.Timeout:
    return None, 'timeout'
  except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
    logger.warning('gemini failed: %s', error)
    return None, 'error'
  with _lock:
    _cache[key] = answer
    if len(_cache) > CACHE_SIZE:
      _cache.popitem(last=False)
  return answer, None


def reset_for_tests() -> None:
  global _resting_until
  with _lock:
    _resting_until = 0.0
    _calls.clear()
    _cache.clear()


class Verdict(dict):
  """noun: bool | None; translation: str | None (the English word); None = no answer.
  answered: Gemini gave at least one answer. reason: why it did not ('off', 'quota',
  'timeout', 'error'), else None."""


def check(previous: str | None, word: str) -> Verdict:
  """Ask both questions at once, waiting at most TIMEOUT_SECONDS. Missing answers are None."""
  verdict = Verdict(noun=None, translation=None, answered=False, reason=None)
  if not enabled():
    verdict['reason'] = 'off'
    return verdict
  if resting_until() is not None:
    verdict['reason'] = 'quota'
    return verdict
  noun_job = _pool.submit(_ask, NOUN_PROMPT, NOUN_SCHEMA, previous or '', word)
  translation_job = _pool.submit(_ask, TRANSLATION_PROMPT, TRANSLATION_SCHEMA, previous, word) if previous else None
  deadline = time.monotonic() + TIMEOUT_SECONDS + 0.5
  reasons: list[str] = []
  try:
    noun, reason = noun_job.result(timeout=max(0.1, deadline - time.monotonic()))
    if noun is not None:
      verdict['noun'] = bool(noun.get('noun'))
      verdict['answered'] = True
    elif reason:
      reasons.append(reason)
  except FutureTimeout:
    reasons.append('timeout')
  if translation_job is not None:
    try:
      found, reason = translation_job.result(timeout=max(0.1, deadline - time.monotonic()))
      if found is not None:
        verdict['answered'] = True
        english = (found.get('english') or '').strip().lower()
        if found.get('translation') and english:
          verdict['translation'] = english
      elif reason:
        reasons.append(reason)
    except FutureTimeout:
      reasons.append('timeout')
  if not verdict['answered']:
    # the most telling reason first: a used-up quota explains a timeout too
    verdict['reason'] = next((r for r in ('quota', 'timeout', 'error') if r in reasons), 'error')
  return verdict

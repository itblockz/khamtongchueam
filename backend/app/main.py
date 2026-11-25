from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated, Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.staticfiles import StaticFiles

from . import feedback, hints
from .syllables import (
  DEFAULT_ENGINE,
  SEGMENTATION_MODE,
  SegmentationEngineError,
  SyllableEngine,
  get_model_version,
  get_supported_engines,
  segment_syllables,
)


class SyllableRequest(BaseModel):
  text: str = Field(min_length=1)
  engine: SyllableEngine = DEFAULT_ENGINE
  # the word said before, to point out a translation of it (judge app)
  previous: str | None = Field(default=None, max_length=feedback.MAX_TEXT_LENGTH)
  # set when the judge sends the word: worth a slower, better check (Gemini)
  check: bool = False


class WordHint(BaseModel):
  """Something the judge may want to check. Never a ruling."""

  kind: Literal['not-noun', 'translation']
  of: str | None = None
  english: str | None = None


class SyllableResponse(BaseModel):
  syllables: list[str]
  engine: SyllableEngine
  mode: Literal['written']
  modelVersion: str
  hints: list[WordHint] = []


app = FastAPI(
  title='Thai Syllable Segmentation API',
  version='1.0.0',
)

app.add_middleware(
  CORSMiddleware,
  allow_origins=['*'],
  allow_credentials=True,
  allow_methods=['*'],
  allow_headers=['*'],
)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DIST_DIR = BASE_DIR / 'dist'


@app.api_route('/api/health', methods=['GET', 'HEAD'])
def healthcheck() -> dict[str, object]:
  return {
    'status': 'ok',
    'engines': list(get_supported_engines()),
    'defaultEngine': DEFAULT_ENGINE,
    'mode': SEGMENTATION_MODE,
    'feedbackEnabled': feedback.is_enabled(),
  }


@app.post('/api/syllables', response_model=SyllableResponse)
def tokenize_syllables(payload: SyllableRequest) -> SyllableResponse:
  try:
    syllables = segment_syllables(payload.text, payload.engine)
  except SegmentationEngineError as error:
    raise HTTPException(status_code=503, detail=str(error)) from error

  try:
    word_hints = [WordHint(**hint) for hint in hints.hints_for(payload.text, payload.previous, ask_model=payload.check)]
  except Exception:  # noqa: BLE001 - hints are extra; segmentation must not fail on them
    word_hints = []

  return SyllableResponse(
    syllables=syllables,
    engine=payload.engine,
    mode=SEGMENTATION_MODE,
    modelVersion=get_model_version(payload.engine),
    hints=word_hints,
  )


class WordEventRequest(BaseModel):
  text: str = Field(min_length=1, max_length=feedback.MAX_TEXT_LENGTH)
  event: Literal['submit', 'duplicate_elimination', 'undo_after_duplicate', 'host_duplicate']


class SyllableReportRequest(BaseModel):
  text: str = Field(min_length=1, max_length=feedback.MAX_TEXT_LENGTH)
  syllables: list[str] = Field(min_length=1, max_length=20)


class FeedbackResponse(BaseModel):
  recorded: bool


def _segment_for_feedback(text: str) -> tuple[str, list[str]] | None:
  normalized = text.strip()
  syllables = segment_syllables(normalized) if normalized else []
  if not syllables:
    return None
  return normalized, syllables


@app.post('/api/feedback/words', response_model=FeedbackResponse, status_code=202)
def record_word_event(payload: WordEventRequest, background_tasks: BackgroundTasks) -> FeedbackResponse:
  segmented = _segment_for_feedback(payload.text)
  if not feedback.is_enabled() or segmented is None:
    return FeedbackResponse(recorded=False)

  text, syllables = segmented
  background_tasks.add_task(
    feedback.record_word_event, text, syllables, get_model_version(DEFAULT_ENGINE), payload.event,
  )
  return FeedbackResponse(recorded=True)


@app.post('/api/feedback/reports', response_model=FeedbackResponse, status_code=202)
def record_syllable_report(payload: SyllableReportRequest, background_tasks: BackgroundTasks) -> FeedbackResponse:
  segmented = _segment_for_feedback(payload.text)
  reported = [syllable.strip() for syllable in payload.syllables if syllable.strip()]
  if any(len(syllable) > 20 for syllable in reported):
    raise HTTPException(status_code=422, detail='พยางค์ยาวเกินไป')
  if not feedback.is_enabled() or segmented is None or not reported:
    return FeedbackResponse(recorded=False)

  text, syllables = segmented
  background_tasks.add_task(
    feedback.record_report, text, syllables, reported, get_model_version(DEFAULT_ENGINE),
  )
  return FeedbackResponse(recorded=True)


# a seat (p1, p2, ...) or 'gm' for the judge's opening word in competition mode
PlayerId = Field(pattern=r'^(p[0-9]{1,3}|gm)$')
ShortText = Field(max_length=feedback.MAX_TEXT_LENGTH)


class JudgeGameEvent(BaseModel):
  """One entry of a judge-app game log. Players are seat ids only, never names."""

  model_config = {'extra': 'forbid'}

  type: Literal['word', 'judge', 'challenge-lost', 'opening']
  playerId: str = PlayerId
  word: str = ShortText
  syllables: list[Annotated[str, Field(max_length=20)]] | None = Field(default=None, max_length=30)
  segmented: list[Annotated[str, Field(max_length=20)]] | None = Field(default=None, max_length=30)
  manual: bool | None = None
  hints: list[Literal['not-noun', 'translation']] | None = Field(default=None, max_length=4)
  reason: Literal['not-connected', 'not-noun', 'forbidden', 'too-slow'] | None = None
  challengerId: str | None = Field(default=None, pattern=r'^p[0-9]{1,3}$')
  targetIndex: int | None = Field(default=None, ge=0)


class JudgeGameData(BaseModel):
  model_config = {'extra': 'forbid'}

  version: Literal[1]
  mode: Literal['normal', 'competition']
  playerCount: int = Field(ge=2, le=100)
  startedAt: int
  events: list[JudgeGameEvent] = Field(max_length=2000)


class JudgeGameRequest(BaseModel):
  id: str = Field(pattern=r'^[a-z0-9]{6,40}$')
  data: JudgeGameData


@app.post('/api/judge/games', response_model=FeedbackResponse, status_code=202)
def record_judge_game(payload: JudgeGameRequest, background_tasks: BackgroundTasks) -> FeedbackResponse:
  """Keep the latest state of a judge-app game, anonymously (see feedback.py)."""
  if not feedback.is_enabled():
    return FeedbackResponse(recorded=False)
  background_tasks.add_task(
    feedback.record_judge_game,
    payload.id,
    payload.data.model_dump(exclude_none=True),
    get_model_version(DEFAULT_ENGINE),
  )
  return FeedbackResponse(recorded=True)


@app.get('/')
def serve_index():
  return FileResponse(str(DIST_DIR / 'index.html'))


if DIST_DIR.exists():
  app.mount('/', StaticFiles(directory=str(DIST_DIR), html=True), name='static')

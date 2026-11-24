from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.staticfiles import StaticFiles

from . import feedback
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


class SyllableResponse(BaseModel):
  syllables: list[str]
  engine: SyllableEngine
  mode: Literal['written']
  modelVersion: str


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

  return SyllableResponse(
    syllables=syllables,
    engine=payload.engine,
    mode=SEGMENTATION_MODE,
    modelVersion=get_model_version(payload.engine),
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


@app.get('/')
def serve_index():
  return FileResponse(str(DIST_DIR / 'index.html'))


if DIST_DIR.exists():
  app.mount('/', StaticFiles(directory=str(DIST_DIR), html=True), name='static')

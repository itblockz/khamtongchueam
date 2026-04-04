from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

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


@app.api_route('/api/health', methods=['GET', 'HEAD'])
def healthcheck() -> dict[str, object]:
  return {
    'status': 'ok',
    'engines': list(get_supported_engines()),
    'defaultEngine': DEFAULT_ENGINE,
    'mode': SEGMENTATION_MODE,
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

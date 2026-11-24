"""Vercel entry point: the game's FastAPI backend as a Python function.

vercel.json sends every /api/* request here; FastAPI routes on the original
path (/api/syllables, /api/feedback/words, ...). The built frontend is served by
Vercel's CDN, not by this function.
"""
import os
import sys
from pathlib import Path

# The function's file system is read-only except /tmp. han_solo's model ships
# with pythainlp, so nothing is downloaded; this only gives pythainlp a
# writable place if it needs one.
os.environ.setdefault('PYTHAINLP_DATA', '/tmp/pythainlp-data')
os.environ.setdefault('PYTHAINLP_READ_ONLY', '1')

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

from backend.app.main import app  # noqa: E402

__all__ = ['app']

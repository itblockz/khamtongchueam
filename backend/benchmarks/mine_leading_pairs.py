"""Mine which word beginnings that look like a leading-consonant pair (อักษรนำ)
are usually read with a separate first syllable instead.

For every word in the PyThaiNLP word list that starts with a high or mid class
consonant followed by a low single consonant, read it with tltk's
grapheme-to-phoneme converter and label it:

- leading pair: the second syllable is marked with หฺ (ขนม -> ขะ-หฺนม)
- split: the first syllable is the bare consonant + ะ and the next is not
  marked with หฺ (สมาคม -> สะ-มา-คม)
- other: cluster, closed syllable or an unusual reading

It prints the three-letter prefixes where split words outnumber leading-pair
words at least 3 to 1 (and at least 5 words are split). Check examples before
adding a prefix to SPLIT_PREFIXES: tltk readings have errors, and some readings
are mislabelled (สระน้ำ -> สะ-น้าม looks split but สร is a single sound).

Takes about 7 minutes:

  python backend/benchmarks/mine_leading_pairs.py
"""
from __future__ import annotations

import sys
import warnings
from collections import defaultdict
from pathlib import Path

warnings.filterwarnings('ignore')

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

import tltk  # noqa: E402
from pythainlp.corpus import thai_words  # noqa: E402

from backend.app.syllables import (  # noqa: E402
  HIGH_CLASS,
  LOW_SINGLE,
  MID_CLASS,
  SPLIT_PREFIXES,
  THAI_CONSONANTS,
)

LEADING = 0
SPLIT = 1
OTHER = 2
VOWEL_MARKS = set('ะาำิีึืุูเแโใไัๅ็่้๊๋์')


def label(reading: list[str]) -> int:
  if len(reading) >= 2 and reading[1].startswith('หฺ'):
    return LEADING
  if reading and reading[0].startswith('หฺ'):
    return LEADING
  if len(reading) >= 2 and len(reading[0]) == 2 and reading[0].endswith('ะ'):
    return SPLIT
  return OTHER


def main() -> None:
  words = sorted(
    word for word in thai_words()
    if len(word) >= 3
    and word[0] in HIGH_CLASS | MID_CLASS
    and word[1] in LOW_SINGLE
    and word[2] != '์'
    and all(char in THAI_CONSONANTS or char in VOWEL_MARKS for char in word)
  )
  counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])

  for word in words:
    try:
      reading = [syllable for syllable in tltk.nlp.th2read(word).split('-') if syllable]
    except Exception:  # noqa: BLE001
      continue
    counts[word[:3]][label(reading)] += 1

  print(f'words: {len(words)}')
  print('prefix  leading  split  other  in SPLIT_PREFIXES')
  for prefix, (leading, split, other) in sorted(counts.items(), key=lambda item: -sum(item[1])):
    if split >= 5 and split >= 3 * max(leading, 1) and split >= other:
      print(f'{prefix}  {leading:7}  {split:5}  {other:5}  {prefix in SPLIT_PREFIXES}')


if __name__ == '__main__':
  main()

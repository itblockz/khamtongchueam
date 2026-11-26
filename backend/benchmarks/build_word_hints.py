"""Build backend/app/data/word_hints.json, the data behind the judge's hints.

Two hints, both only shown to the judge (never a ruling):
- not a noun: the word is known to the dictionaries and none of its senses is a
  noun (the rule: a word counts if it can be a noun).
- a translation of the word before it: one word is Thai for X, the other is X in
  English written in Thai (หมา → ด็อก).

Sources (free; see the licence notes in backend/app/data/README.md):
- PyThaiNLP: thai_dict (Thai Wiktionary), Thai WordNet, and the ORCHID / UD /
  TDTB part-of-speech tables (the Thai-English transliteration table is read from
  the installed package at run time, not copied here)
- kaikki.org's extract of English Wiktionary's Thai entries (English glosses):
  download https://kaikki.org/dictionary/Thai/kaikki.org-dictionary-Thai.jsonl
  and pass its path.

Usage: python backend/benchmarks/build_word_hints.py path/to/kaikki-Thai.jsonl
"""
from __future__ import annotations

import ast
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

import pythainlp.corpus as corpus
from pythainlp.corpus import thai_dict

OUT = Path(__file__).resolve().parent.parent / 'app' / 'data' / 'word_hints.json'
CORPUS_DIR = Path(os.path.dirname(corpus.__file__))

NOUN_SENSES = {'คำนาม', 'คำวิสามานยนาม', 'คำนามวิสามานยนาม', 'คำลักษณนาม', 'คำอาการนาม'}
NOUN_TAGS = {'NCMN', 'NPRP', 'NONM', 'NLBL', 'NCNM', 'NTTL', 'CNIT', 'CLTV', 'CMTR', 'CFQC', 'CVBL', 'NOUN', 'PROPN'}
THAI = re.compile(r'^[฀-๿]+$')


def not_nouns() -> list[str]:
  """Words the dictionaries know with no noun sense, and that no tagged corpus uses
  as a noun either (if they disagree, the hint stays quiet)."""
  senses: dict[str, bool] = {}
  td = thai_dict()
  for word, meaning in zip(td['word'], td['meaning']):
    try:
      kinds = set(ast.literal_eval(meaning).keys())
    except (ValueError, SyntaxError):
      continue
    senses[word] = senses.get(word, False) or bool(kinds & NOUN_SENSES)
  db = sqlite3.connect(CORPUS_DIR / 'wordnet_th.db')
  for synset, word in db.execute('select synsetid, li from word_synset'):
    senses[word] = senses.get(word, False) or synset.endswith('-n')
  tagged: dict[str, bool] = {}
  for name in ('pos_orchid_unigram.json', 'pos_ud_unigram-v0.2.json', 'tdtb-unigram_tagger.json'):
    for word, tag in json.load(open(CORPUS_DIR / name, encoding='utf-8-sig')).items():
      tagged[word] = tagged.get(word, False) or tag in NOUN_TAGS
  words = {w for w, noun in senses.items() if not noun and not tagged.get(w, False)}
  words |= {w for w, noun in tagged.items() if w not in senses and not noun}
  return sorted(w for w in words if THAI.match(w))


def nouns() -> list[str]:
  """Words a dictionary gives a noun sense (short ones: what players say). Used to
  overrule a model that calls such a word not a noun."""
  words: set[str] = set()
  td = thai_dict()
  for word, meaning in zip(td['word'], td['meaning']):
    try:
      if set(ast.literal_eval(meaning).keys()) & NOUN_SENSES:
        words.add(word)
    except (ValueError, SyntaxError):
      continue
  db = sqlite3.connect(CORPUS_DIR / 'wordnet_th.db')
  words |= {w for sid, w in db.execute('select synsetid, li from word_synset') if sid.endswith('-n')}
  return sorted(w for w in words if THAI.match(w) and len(w) <= 12)


def clean_gloss(gloss: str) -> set[str]:
  gloss = re.sub(r'\([^)]*\)', '', gloss.lower())
  out: set[str] = set()
  for part in re.split(r'[,;:/]', gloss):
    part = re.sub(r'^(a|an|the|to|as|such as)\s+', '', part.strip()).strip(' .')
    if not re.fullmatch(r'[a-z][a-z -]*', part) or len(part.split()) > 3:
      continue
    if re.fullmatch(r'etc|classifier.*|used .*|.*\bof\b.*|.* or .*', part):
      continue
    out.add(part)
    if ' ' in part:
      out.add(part.split()[-1])
  return out


def glosses(kaikki: str) -> dict[str, list[str]]:
  out: dict[str, set[str]] = {}
  for line in open(kaikki, encoding='utf-8'):
    entry = json.loads(line)
    word = entry.get('word', '')
    if not THAI.match(word):
      continue
    bag = out.setdefault(word, set())
    for sense in entry.get('senses', []):
      for gloss in sense.get('glosses', [])[:1]:
        bag |= clean_gloss(gloss)
  return {w: sorted(g) for w, g in sorted(out.items()) if g}


def main() -> None:
  data = {
    'notNoun': not_nouns(),
    'noun': nouns(),
    'gloss': glosses(sys.argv[1]),
  }
  OUT.parent.mkdir(parents=True, exist_ok=True)
  OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
  print(OUT, {k: len(v) for k, v in data.items()}, f'{OUT.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
  main()

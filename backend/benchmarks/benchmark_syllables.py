from __future__ import annotations

import json
import sys
from pathlib import Path
from time import perf_counter

ROOT_DIR = Path(__file__).resolve().parents[2]

if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

from backend.app.syllables import DEFAULT_ENGINE, get_supported_engines, segment_syllables


def load_gold_entries() -> list[dict[str, object]]:
  gold_path = Path(__file__).with_name('gold_written_syllables.json')
  return json.loads(gold_path.read_text(encoding='utf-8'))


def to_boundaries(syllables: list[str]) -> set[int]:
  boundaries: set[int] = set()
  offset = 0

  for syllable in syllables[:-1]:
    offset += len(syllable)
    boundaries.add(offset)

  return boundaries


def best_reference(actual: list[str], references: list[list[str]]) -> list[str]:
  actual_boundaries = to_boundaries(actual)
  return max(
    references,
    key=lambda reference: (
      reference == actual,
      len(to_boundaries(reference) & actual_boundaries)
      - len(to_boundaries(reference) ^ actual_boundaries),
    ),
  )


def benchmark_engine(engine: str, entries: list[dict[str, object]]) -> dict[str, object]:
  exact_matches = 0
  true_positives = 0
  false_positives = 0
  false_negatives = 0
  spoken_total = 0
  spoken_matches = 0
  total_duration_ms = 0.0
  failures: list[tuple[str, str]] = []
  mismatches: list[tuple[str, list[str], list[str]]] = []
  per_category: dict[str, list[int]] = {}

  for entry in entries:
    text = str(entry['text'])
    references = [[str(syllable) for syllable in entry['syllables']]]
    references.extend(
      [str(syllable) for syllable in alternative]
      for alternative in entry.get('accept', [])  # type: ignore[union-attr]
    )
    category = str(entry.get('category', 'uncategorized'))
    spoken_syllables = entry.get('spoken_syllables')

    started_at = perf_counter()

    try:
      actual = segment_syllables(text, engine)  # type: ignore[arg-type]
    except Exception as error:  # noqa: BLE001
      failures.append((text, f'{type(error).__name__}: {error}'))
      continue

    total_duration_ms += (perf_counter() - started_at) * 1000

    expected = best_reference(actual, references)
    category_counts = per_category.setdefault(category, [0, 0])
    category_counts[1] += 1

    if actual == expected:
      exact_matches += 1
      category_counts[0] += 1
    else:
      mismatches.append((text, expected, actual))

    if isinstance(spoken_syllables, int):
      spoken_total += 1
      spoken_matches += int(len(actual) == spoken_syllables)

    expected_boundaries = to_boundaries(expected)
    actual_boundaries = to_boundaries(actual)

    true_positives += len(expected_boundaries & actual_boundaries)
    false_positives += len(actual_boundaries - expected_boundaries)
    false_negatives += len(expected_boundaries - actual_boundaries)

  precision = (
    true_positives / (true_positives + false_positives)
    if true_positives + false_positives > 0
    else 1.0
  )
  recall = (
    true_positives / (true_positives + false_negatives)
    if true_positives + false_negatives > 0
    else 1.0
  )
  boundary_f1 = (
    2 * precision * recall / (precision + recall)
    if precision + recall > 0
    else 0.0
  )
  completed_runs = len(entries) - len(failures)

  return {
    'engine': engine,
    'exact_match_accuracy': exact_matches / len(entries),
    'boundary_f1': boundary_f1,
    'spoken_count_accuracy': spoken_matches / spoken_total if spoken_total > 0 else None,
    'per_category': per_category,
    'mismatches': mismatches,
    'avg_latency_ms': total_duration_ms / completed_runs if completed_runs > 0 else None,
    'failures': failures,
  }


def recommend_engine(results: list[dict[str, object]]) -> dict[str, object] | None:
  successful_results = [
    result for result in results if not result['failures']
  ]

  if not successful_results:
    return None

  best_result = max(
    successful_results,
    key=lambda result: (
      float(result['boundary_f1']),
      float(result['exact_match_accuracy']),
      -(float(result['avg_latency_ms']) if result['avg_latency_ms'] is not None else float('inf')),
    ),
  )
  default_result = next(
    (result for result in successful_results if result['engine'] == DEFAULT_ENGINE),
    None,
  )

  if (
    default_result is not None
    and float(best_result['boundary_f1']) - float(default_result['boundary_f1']) <= 0.5
  ):
    return default_result

  return best_result


def main() -> None:
  entries = load_gold_entries()
  engines = list(dict.fromkeys((DEFAULT_ENGINE, *get_supported_engines())))
  results: list[dict[str, object]] = []

  print('Thai syllable segmentation benchmark')
  print(f'Gold entries: {len(entries)}')
  print()

  for engine in engines:
    result = benchmark_engine(engine, entries)
    results.append(result)
    print(
      f"{result['engine']}: "
      f"boundary_f1={result['boundary_f1']:.4f}, "
      f"exact_match={result['exact_match_accuracy']:.4f}, "
      f"avg_latency_ms={result['avg_latency_ms']:.2f}" if result['avg_latency_ms'] is not None else
      f"{result['engine']}: failed",
    )

    if result['spoken_count_accuracy'] is not None:
      print(f"  spoken_syllable_count_match={result['spoken_count_accuracy']:.4f}")

    category_summary = ', '.join(
      f'{category}={correct}/{total}'
      for category, (correct, total) in result['per_category'].items()  # type: ignore[union-attr]
    )
    print(f'  per_category: {category_summary}')

    if result['mismatches']:
      print('  mismatches (expected -> actual):')
      for text, expected, actual in result['mismatches']:  # type: ignore[union-attr]
        print(f"    - {text}: {'|'.join(expected)} -> {'|'.join(actual)}")

    if result['failures']:
      print('  failures:')
      for text, error_message in result['failures']:
        print(f'    - {text}: {error_message}')

  recommended_result = recommend_engine(results)

  if recommended_result is None:
    print()
    print('Recommended engine: unavailable')
    return

  print()
  print(
    'Recommended engine: '
    f"{recommended_result['engine']} "
    f"(boundary_f1={recommended_result['boundary_f1']:.4f}, "
    f"exact_match={recommended_result['exact_match_accuracy']:.4f}, "
    f"avg_latency_ms={recommended_result['avg_latency_ms']:.2f})"
    if recommended_result['avg_latency_ms'] is not None
    else f"Recommended engine: {recommended_result['engine']}"
  )


if __name__ == '__main__':
  main()

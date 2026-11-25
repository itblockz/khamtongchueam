export class SegmentError extends Error {}

/** Something the judge may want to check about a word. Never a ruling. */
export type WordHint =
  | { kind: 'not-noun' }
  | { kind: 'translation'; of: string; english: string }

/** Ask the backend to split a word into written syllables (game rules applied server-side). */
export async function segment(text: string, signal?: AbortSignal): Promise<string[]> {
  return (await segmentWithHints(text, null, signal)).syllables
}

/** The split, plus hints for the judge (not a noun; a translation of `previous`). */
export async function segmentWithHints(
  text: string,
  previous: string | null,
  signal?: AbortSignal,
  /** The word is being sent: worth a slower, better check (Gemini, if set up). */
  check = false,
): Promise<{ syllables: string[]; hints: WordHint[] }> {
  const response = await fetch('/api/syllables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(previous ? { previous } : {}), ...(check ? { check: true } : {}) }),
    signal,
  })

  if (!response.ok) {
    throw new SegmentError('แยกพยางค์ไม่ได้ ลองใหม่อีกครั้ง')
  }

  const payload = (await response.json()) as { syllables?: unknown; hints?: unknown }
  if (!Array.isArray(payload.syllables)) {
    throw new SegmentError('ระบบแยกพยางค์ตอบกลับผิดรูปแบบ')
  }

  return { syllables: payload.syllables.map(String), hints: readHints(payload.hints) }
}

function readHints(value: unknown): WordHint[] {
  if (!Array.isArray(value)) return []
  const hints: WordHint[] = []
  for (const item of value as Record<string, unknown>[]) {
    if (item?.kind === 'not-noun') hints.push({ kind: 'not-noun' })
    if (item?.kind === 'translation' && typeof item.of === 'string' && typeof item.english === 'string') {
      hints.push({ kind: 'translation', of: item.of, english: item.english })
    }
  }
  return hints
}

/**
 * Send a game's log for collection (see backend feedback.py). The server only stores
 * it in production; elsewhere it answers without storing. Returns whether the server
 * took it, so a failed send can be retried later. The game never depends on this.
 */
export async function uploadGame(id: string, data: unknown): Promise<boolean> {
  const body = JSON.stringify({ id, data })
  try {
    const response = await fetch('/api/judge/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // lets a send finish while the tab closes; browsers cap such bodies at 64 KB
      keepalive: body.length < 60_000,
    })
    return response.ok
  } catch {
    return false // offline or blocked: retried on the next change or next open
  }
}

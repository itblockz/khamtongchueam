export class SegmentError extends Error {}

/** Ask the backend to split a word into written syllables (game rules applied server-side). */
export async function segment(text: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/syllables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })

  if (!response.ok) {
    throw new SegmentError('แยกพยางค์ไม่ได้ ลองใหม่อีกครั้ง')
  }

  const payload = (await response.json()) as { syllables?: unknown }
  if (!Array.isArray(payload.syllables)) {
    throw new SegmentError('ระบบแยกพยางค์ตอบกลับผิดรูปแบบ')
  }

  return payload.syllables.map(String)
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

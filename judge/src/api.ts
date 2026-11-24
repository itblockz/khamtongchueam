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

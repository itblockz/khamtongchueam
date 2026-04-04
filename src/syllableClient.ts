export type SyllableEngine = 'han_solo' | 'ssg' | 'tltk'

export interface SyllableSegmentationResponse {
  syllables: string[]
  engine: SyllableEngine
  mode: 'written'
  modelVersion: string
}

interface SegmentTextOptions {
  engine?: SyllableEngine
  signal?: AbortSignal
}

export const DEFAULT_SYLLABLE_ENGINE: SyllableEngine = 'han_solo'

export class SyllableSegmentationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyllableSegmentationError'
  }
}

export async function segmentThaiText(
  text: string,
  options: SegmentTextOptions = {},
): Promise<SyllableSegmentationResponse> {
  const normalizedText = text.trim()
  const engine = options.engine ?? DEFAULT_SYLLABLE_ENGINE

  if (!normalizedText) {
    return {
      syllables: [],
      engine,
      mode: 'written',
      modelVersion: 'empty-input',
    }
  }

  const response = await fetch('/api/syllables', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: normalizedText,
      engine,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    let message = 'ไม่สามารถเชื่อมต่อระบบแยกพยางค์ได้'

    try {
      const payload = (await response.json()) as { detail?: string }
      if (typeof payload.detail === 'string' && payload.detail.trim().length > 0) {
        message = payload.detail
      }
    } catch {
      // Keep the default message when the backend response is not JSON.
    }

    throw new SyllableSegmentationError(message)
  }

  const payload =
    (await response.json()) as Partial<SyllableSegmentationResponse>

  if (!Array.isArray(payload.syllables)) {
    throw new SyllableSegmentationError('ระบบแยกพยางค์ส่งข้อมูลกลับมาไม่ถูกต้อง')
  }

  return {
    syllables: payload.syllables
      .map((syllable) => `${syllable}`.trim())
      .filter((syllable) => syllable.length > 0),
    engine: (payload.engine as SyllableEngine | undefined) ?? engine,
    mode: 'written',
    modelVersion:
      typeof payload.modelVersion === 'string' && payload.modelVersion.trim().length > 0
        ? payload.modelVersion
        : 'unknown',
  }
}

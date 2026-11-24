export type WordFeedbackEvent =
  | 'submit'
  | 'duplicate_elimination'
  | 'undo_after_duplicate'
  | 'host_duplicate'

export const SYLLABLE_FEEDBACK_STORAGE_KEY =
  'khamtongchueam:syllable-feedback-enabled'

export function getInitialSyllableFeedbackEnabled() {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    return (
      window.localStorage.getItem(SYLLABLE_FEEDBACK_STORAGE_KEY) !== 'false'
    )
  } catch {
    return true
  }
}

export function storeSyllableFeedbackEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(SYLLABLE_FEEDBACK_STORAGE_KEY, String(enabled))
  } catch {
    // Storage can be unavailable (private mode); the setting then lasts for this visit only.
  }
}

async function postFeedback(path: string, body: object): Promise<boolean> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    })

    if (!response.ok) {
      return false
    }

    const payload = (await response.json()) as { recorded?: boolean }
    return payload.recorded === true
  } catch {
    return false
  }
}

/** Fire-and-forget: never blocks or breaks the game. */
export function sendWordFeedback(text: string, event: WordFeedbackEvent) {
  const normalizedText = text.trim()

  if (!normalizedText) {
    return
  }

  void postFeedback('/api/feedback/words', { text: normalizedText, event })
}

/** Split what the GM typed into syllables: spaces, | or / separate them. */
export function parseReportedSyllables(input: string) {
  return input
    .split(/[\s|/]+/)
    .map((syllable) => syllable.trim())
    .filter((syllable) => syllable.length > 0)
}

export function sendSyllableReport(text: string, syllables: string[]) {
  return postFeedback('/api/feedback/reports', {
    text: text.trim(),
    syllables,
  })
}

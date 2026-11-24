import type { Round } from './game'

/** Everything needed to pick a game back up after a reload, a closed tab or a phone
 * that put the browser to sleep. Kept only in this browser. */
export interface Saved {
  namesText: string
  seconds: number
  round: Round | null
}

const KEY = 'khamtongchueam.judge.v1'

function isRound(value: unknown): value is Round {
  if (!value || typeof value !== 'object') return false
  const round = value as Round
  return (
    Array.isArray(round.players) &&
    round.players.every((p) => typeof p?.id === 'string' && typeof p?.name === 'string') &&
    Array.isArray(round.events) &&
    round.events.every(
      (e) =>
        typeof e?.playerId === 'string' &&
        typeof e?.word === 'string' &&
        (e.type === 'judge' ? typeof e.reason === 'string' : e.type === 'word' && Array.isArray(e.syllables)),
    )
  )
}

export function load(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const data = JSON.parse(raw) as Record<string, unknown>
    const saved: Partial<Saved> = {}
    if (typeof data.namesText === 'string') saved.namesText = data.namesText
    if (typeof data.seconds === 'number' && data.seconds > 0) saved.seconds = data.seconds
    if (data.round === null || isRound(data.round)) saved.round = data.round
    return saved
  } catch {
    return {} // storage blocked (private mode) or unreadable: start fresh
  }
}

export function save(saved: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    /* storage full or blocked: the game still works, it just will not survive a reload */
  }
}

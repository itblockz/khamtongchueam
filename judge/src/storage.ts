import type { Round } from './game'

/** One game kept in this browser, finished or not. */
export interface SavedGame {
  id: string
  createdAt: number
  updatedAt: number
  round: Round
}

/** Everything kept in this browser so games survive a reload, a closed tab or a
 * phone that put the browser to sleep. Nothing here leaves the device. */
export interface Saved {
  namesText: string
  seconds: number
  games: SavedGame[]
  /** The game on screen, or null on the first page. */
  currentId: string | null
}

const KEY = 'khamtongchueam.judge.v2'
const OLD_KEY = 'khamtongchueam.judge.v1'
/** Oldest games are dropped past this, so storage cannot fill up. */
export const MAX_GAMES = 50

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
        (e.type === 'word'
          ? Array.isArray(e.syllables)
          : (e.type === 'judge' || (e.type === 'challenge-lost' && typeof e.targetIndex === 'number')) &&
            typeof e.reason === 'string'),
    )
  )
}

function isGame(value: unknown): value is SavedGame {
  if (!value || typeof value !== 'object') return false
  const game = value as SavedGame
  return (
    typeof game.id === 'string' &&
    typeof game.createdAt === 'number' &&
    typeof game.updatedAt === 'number' &&
    isRound(game.round)
  )
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function load(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as Record<string, unknown>
      const saved: Partial<Saved> = {}
      if (typeof data.namesText === 'string') saved.namesText = data.namesText
      if (typeof data.seconds === 'number' && data.seconds > 0) saved.seconds = data.seconds
      if (Array.isArray(data.games)) saved.games = data.games.filter(isGame)
      if (typeof data.currentId === 'string' && saved.games?.some((g) => g.id === data.currentId)) {
        saved.currentId = data.currentId
      }
      return saved
    }
    return loadOld()
  } catch {
    return {} // storage blocked (private mode) or unreadable: start fresh
  }
}

/** The previous version kept a single round; carry it over as the only game. */
function loadOld(): Partial<Saved> {
  const raw = localStorage.getItem(OLD_KEY)
  if (!raw) return {}
  const data = JSON.parse(raw) as Record<string, unknown>
  const saved: Partial<Saved> = {}
  if (typeof data.namesText === 'string') saved.namesText = data.namesText
  if (typeof data.seconds === 'number' && data.seconds > 0) saved.seconds = data.seconds
  if (isRound(data.round)) {
    const now = Date.now()
    const game = { id: newId(), createdAt: now, updatedAt: now, round: data.round }
    saved.games = [game]
    saved.currentId = game.id
  }
  return saved
}

export function save(saved: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
    localStorage.removeItem(OLD_KEY)
  } catch {
    /* storage full or blocked: the game still works, it just will not survive a reload */
  }
}

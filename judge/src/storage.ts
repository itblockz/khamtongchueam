import { replay, type Round } from './game'

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

export function isGame(value: unknown): value is SavedGame {
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

/**
 * Save everything. When the browser's storage is full, the oldest finished games are
 * dropped one at a time until it fits; the game on screen and unfinished games are
 * never dropped. Returns the games actually kept and how many were dropped.
 */
export function save(saved: Saved): { games: SavedGame[]; dropped: number } {
  let games = saved.games
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...saved, games }))
      localStorage.removeItem(OLD_KEY)
      return { games, dropped: saved.games.length - games.length }
    } catch (error) {
      const oldestFinished = [...games]
        .filter((g) => g.id !== saved.currentId && replay(g.round).winnerId)
        .sort((a, b) => a.updatedAt - b.updatedAt)[0]
      if (!isQuotaError(error) || !oldestFinished) {
        // blocked storage, or nothing left to drop: play on without saving
        return { games: saved.games, dropped: 0 }
      }
      games = games.filter((g) => g !== oldestFinished)
    }
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}

/** A file the player keeps: every game on this device, names included. */
export interface ExportFile {
  app: 'khamtongchueam-judge'
  version: 1
  exportedAt: number
  games: SavedGame[]
}

export function exportGames(games: SavedGame[]): ExportFile {
  return { app: 'khamtongchueam-judge', version: 1, exportedAt: Date.now(), games }
}

/** Read an exported file. Returns the games in it, or null if it is not one. */
export function parseExport(text: string): SavedGame[] | null {
  try {
    const data = JSON.parse(text) as Partial<ExportFile>
    if (data.app !== 'khamtongchueam-judge' || !Array.isArray(data.games)) return null
    return data.games.filter(isGame)
  } catch {
    return null
  }
}

/** Add imported games; a game already here is replaced only by a newer copy. */
export function mergeGames(
  current: SavedGame[],
  incoming: SavedGame[],
): { games: SavedGame[]; added: number; updated: number } {
  const byId = new Map(current.map((g) => [g.id, g]))
  let added = 0
  let updated = 0
  for (const game of incoming) {
    const existing = byId.get(game.id)
    if (!existing) added += 1
    else if (game.updatedAt > existing.updatedAt) updated += 1
    else continue
    byId.set(game.id, game)
  }
  return { games: [...byId.values()], added, updated }
}

/**
 * What is sent for collection: the game log without player names. Players are seat
 * ids (p1, p2, ...) only, and only the fields the server accepts are kept.
 */
export function anonymize(game: SavedGame) {
  return {
    version: 1 as const,
    mode: 'normal' as const,
    playerCount: game.round.players.length,
    startedAt: game.createdAt,
    events: game.round.events.map((event) => {
      if (event.type === 'word') {
        return {
          type: event.type,
          playerId: event.playerId,
          word: event.word,
          syllables: event.syllables,
          ...(event.manual ? { manual: true } : {}),
          ...(event.segmented ? { segmented: event.segmented } : {}),
        }
      }
      if (event.type === 'judge') {
        return {
          type: event.type,
          playerId: event.playerId,
          word: event.word,
          reason: event.reason,
          ...(event.challengerId ? { challengerId: event.challengerId } : {}),
        }
      }
      return {
        type: event.type,
        playerId: event.playerId,
        word: event.word,
        reason: event.reason,
        targetIndex: event.targetIndex,
      }
    }),
  }
}

const SENT_KEY = 'khamtongchueam.judge.sent.v1'

/** Short fingerprint of what was last sent for a game, to tell when it changed. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`
}

/** Which version of each game the server already has (game id → fingerprint). */
export function loadSent(): Map<string, string> {
  try {
    const data = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, unknown>
    return new Map(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return new Map()
  }
}

/** Remember what the server has, only for games still kept here. */
export function saveSent(sent: Map<string, string>, games: SavedGame[]) {
  try {
    const kept = new Set(games.map((g) => g.id))
    localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries([...sent].filter(([id]) => kept.has(id)))))
  } catch {
    /* blocked or full: games are just sent again next time */
  }
}

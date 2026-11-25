import type { Round } from './game'

/** One game kept in this browser, finished or not. */
export interface SavedGame {
  id: string
  createdAt: number
  updatedAt: number
  round: Round
}

/** Small settings kept in localStorage (read synchronously at start). */
export interface Settings {
  namesText: string
  seconds: number
  /** The game on screen, or null on the first page. */
  currentId: string | null
}

const KEY = 'khamtongchueam.judge.v2'
const OLD_KEY = 'khamtongchueam.judge.v1'
const DB_NAME = 'khamtongchueam-judge'
const STORE = 'games'

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

function readLocal(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function loadSettings(): Partial<Settings> {
  const data = readLocal(KEY) ?? readLocal(OLD_KEY) ?? {}
  const settings: Partial<Settings> = {}
  if (typeof data.namesText === 'string') settings.namesText = data.namesText
  if (typeof data.seconds === 'number' && data.seconds > 0) settings.seconds = data.seconds
  if (typeof data.currentId === 'string') settings.currentId = data.currentId
  return settings
}

export function saveSettings(settings: Settings) {
  try {
    const old = readLocal(KEY) ?? {}
    // keep any games of the previous version until they have been moved
    localStorage.setItem(KEY, JSON.stringify({ ...old, ...settings }))
  } catch {
    /* blocked: settings just will not survive a reload */
  }
}

/**
 * Games live in IndexedDB, which browsers give far more room than localStorage
 * (hundreds of MB rather than about 5 MB), so a judge never has to worry about it
 * filling up. Earlier versions kept games in localStorage; they are moved over.
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbPromise ??= openDb()
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Games saved by earlier versions in localStorage. */
function legacyGames(): SavedGame[] {
  const current = readLocal(KEY)
  if (current && Array.isArray(current.games)) return current.games.filter(isGame)
  const old = readLocal(OLD_KEY)
  if (old && isRound(old.round)) {
    // the one-slot version always had its game open: keep it open
    const now = Date.now()
    const game = { id: newId(), createdAt: now, updatedAt: now, round: old.round }
    saveSettings({ ...loadSettings(), currentId: game.id } as Settings)
    return [game]
  }
  return []
}

/** Every game on this device. Throws if the browser will not open IndexedDB. */
export async function loadGames(): Promise<SavedGame[]> {
  const database = await db()
  const legacy = legacyGames()
  if (legacy.length > 0) {
    const tx = database.transaction(STORE, 'readwrite')
    for (const game of legacy) tx.objectStore(STORE).put(game)
    await done(tx)
    try {
      const current = readLocal(KEY) ?? {}
      delete current.games
      localStorage.setItem(KEY, JSON.stringify(current))
      localStorage.removeItem(OLD_KEY)
    } catch {
      /* moved already; the copy left behind is ignored next time */
    }
  }
  const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll()
  const all = await new Promise<unknown[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return all.filter(isGame)
}

/** Tests only: forget the open database so the next call opens a fresh one. */
export function resetDbForTests() {
  void dbPromise?.then((database) => database.close()).catch(() => undefined)
  dbPromise = null
}

/** Write the given games and remove the given ids, in one go. */
export async function storeGames(put: SavedGame[], remove: string[] = []): Promise<void> {
  if (put.length === 0 && remove.length === 0) return
  const tx = (await db()).transaction(STORE, 'readwrite')
  for (const game of put) tx.objectStore(STORE).put(game)
  for (const id of remove) tx.objectStore(STORE).delete(id)
  await done(tx)
}

/** Ask the browser not to clear this site's storage when the device runs low. */
export function askToKeepStorage() {
  void navigator.storage?.persist?.().catch(() => false)
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

const TOMBSTONES_KEY = 'khamtongchueam.judge.deleted.v1'

/** Games deleted on this device (id → when), so a signed-in backup drops them too. */
export function loadTombstones(): Record<string, number> {
  const data = readLocal(TOMBSTONES_KEY) ?? {}
  return Object.fromEntries(Object.entries(data).filter((e): e is [string, number] => typeof e[1] === 'number'))
}

export function saveTombstones(tombstones: Record<string, number>) {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones))
  } catch {
    /* blocked: a deleted game may come back from the backup once */
  }
}

// How a device's games and a signed-in account's backup are brought together.
//
// Each game carries `updatedAt`; whichever side has the newer copy wins. Deleting a
// game leaves a tombstone (its id and when it was deleted) so the deletion reaches
// the account and other devices instead of the game coming back from the backup.

import type { RemoteGame } from './cloud'
import type { SavedGame } from './storage'

/** Game id → when it was deleted on this device. */
export type Tombstones = Record<string, number>

export interface Reconciled {
  /** Games from the account that are newer than this device's copy (or new here). */
  take: SavedGame[]
  /** Ids to remove here because the account deleted them after this device's copy. */
  remove: string[]
  /** What the account is missing or has older. */
  push: RemoteGame[]
  /** Tombstones still worth keeping (the account does not have them yet). */
  tombstones: Tombstones
}

export function reconcile(local: SavedGame[], tombstones: Tombstones, remote: RemoteGame[]): Reconciled {
  const localById = new Map(local.map((g) => [g.id, g]))
  const remoteById = new Map(remote.map((r) => [r.id, r]))
  const take: SavedGame[] = []
  const remove: string[] = []
  const push: RemoteGame[] = []
  const kept: Tombstones = { ...tombstones }

  for (const r of remote) {
    const mine = localById.get(r.id)
    const deletedHere = tombstones[r.id]
    if (r.deleted) {
      if (mine && mine.updatedAt <= r.updatedAt) remove.push(r.id)
      continue
    }
    if (deletedHere !== undefined && deletedHere >= r.updatedAt) continue
    if (r.game && (!mine || mine.updatedAt < r.updatedAt)) take.push(r.game)
  }

  for (const g of local) {
    const r = remoteById.get(g.id)
    if (!r || r.updatedAt < g.updatedAt) push.push({ id: g.id, updatedAt: g.updatedAt, deleted: false, game: g })
  }

  for (const [id, deletedAt] of Object.entries(tombstones)) {
    const r = remoteById.get(id)
    if (r && r.updatedAt >= deletedAt) {
      // the account already has this deletion, or a newer copy of the game
      delete kept[id]
      continue
    }
    if (!localById.has(id)) push.push({ id, updatedAt: deletedAt, deleted: true, game: null })
  }

  return { take, remove, push, tombstones: kept }
}

/** Apply what came from the account onto the latest local games (newer copy wins). */
export function applyRemote(games: SavedGame[], take: SavedGame[], remove: string[]): SavedGame[] {
  const byId = new Map(games.map((g) => [g.id, g]))
  for (const g of take) {
    const mine = byId.get(g.id)
    if (!mine || mine.updatedAt < g.updatedAt) byId.set(g.id, g)
  }
  for (const id of remove) byId.delete(id)
  return [...byId.values()]
}

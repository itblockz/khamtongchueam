import { describe, expect, it } from 'vitest'
import { addWord, startRound } from './game'
import type { SavedGame } from './storage'
import { applyRemote, reconcile } from './sync'

function game(id: string, updatedAt: number): SavedGame {
  const round = addWord(startRound(['ออย', 'บีม']), 'กาแฟ', ['กา', 'แฟ'])
  return { id, createdAt: 1, updatedAt, round }
}
const remote = (g: SavedGame) => ({ id: g.id, updatedAt: g.updatedAt, deleted: false, game: g })

describe('reconcile', () => {
  it('pushes games the account lacks or has older, and takes newer ones', () => {
    const local = [game('aaa111', 5), game('bbb222', 5), game('ccc333', 5)]
    const result = reconcile(local, {}, [remote(game('bbb222', 3)), remote(game('ccc333', 9)), remote(game('ddd444', 1))])
    expect(result.push.map((p) => p.id)).toEqual(['aaa111', 'bbb222'])
    expect(result.take.map((g) => [g.id, g.updatedAt])).toEqual([
      ['ccc333', 9],
      ['ddd444', 1],
    ])
    expect(result.remove).toEqual([])
  })

  it('removes a game the account deleted after this copy, but keeps one edited later', () => {
    const local = [game('aaa111', 5), game('bbb222', 8)]
    const result = reconcile(local, {}, [
      { id: 'aaa111', updatedAt: 6, deleted: true, game: null },
      { id: 'bbb222', updatedAt: 6, deleted: true, game: null },
    ])
    expect(result.remove).toEqual(['aaa111'])
    expect(result.push.map((p) => p.id)).toEqual(['bbb222'])
  })

  it('sends a deletion made here and does not take the game back', () => {
    const result = reconcile([], { aaa111: 7 }, [remote(game('aaa111', 5))])
    expect(result.take).toEqual([])
    expect(result.push).toEqual([{ id: 'aaa111', updatedAt: 7, deleted: true, game: null }])
    expect(result.tombstones).toEqual({ aaa111: 7 })
  })

  it('forgets a tombstone once the account has it', () => {
    const result = reconcile([], { aaa111: 7 }, [{ id: 'aaa111', updatedAt: 7, deleted: true, game: null }])
    expect(result.push).toEqual([])
    expect(result.tombstones).toEqual({})
  })
})

describe('applyRemote', () => {
  it('never replaces a copy edited here in the meantime', () => {
    const now = [game('aaa111', 9), game('bbb222', 1)]
    const merged = applyRemote(now, [game('aaa111', 5), game('bbb222', 4)], [])
    expect(merged.map((g) => [g.id, g.updatedAt])).toEqual([
      ['aaa111', 9],
      ['bbb222', 4],
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { judgeOut, startRound } from './game'
import { groupMatches, matchOf } from './match'
import type { SavedGame } from './storage'

function won(id: string, names: string[], match?: SavedGame['match'], updatedAt = 1): SavedGame {
  let round = startRound(names)
  for (let i = 1; i < names.length; i += 1) round = judgeOut(round, 'too-slow', '') // last name wins
  return { id, createdAt: 1, updatedAt, round, ...(match ? { match } : {}) }
}

describe('matches in the saved list', () => {
  it('treats a round saved before matches as round 1 of a 4-round match', () => {
    const old = won('oldgame1', ['ก', 'ข'])
    expect(matchOf(old)).toEqual({ id: 'oldgame1', round: 1, rounds: 4 })
    const [view] = groupMatches([old])
    expect(view.over).toBe(false)
    expect(view.table.map((r) => [r.name, r.total])).toEqual([
      ['ข', 3],
      ['ก', 1],
    ])
  })

  it('carries an old round on: the next round joins its match', () => {
    const old = won('oldgame1', ['ก', 'ข'], undefined, 1)
    const next = won('newround', ['ข', 'ก'], { id: 'oldgame1', round: 2, rounds: 4 }, 2)
    const views = groupMatches([old, next])
    expect(views).toHaveLength(1)
    expect(views[0].latest.id).toBe('newround')
    // 4 points each: equal totals keep the roster order
    expect(views[0].table.map((r) => [r.name, r.rounds.map((c) => c.placing)])).toEqual([
      ['ก', [1, 3, null, null]],
      ['ข', [3, 1, null, null]],
    ])
  })

  it('is over once its last round has a winner, newest match first', () => {
    const a = won('aaa111', ['ก', 'ข'], { id: 'm1', round: 1, rounds: 1 }, 5)
    const b = won('bbb222', ['ค', 'ง'], { id: 'm2', round: 1, rounds: 2 }, 9)
    const [first, second] = groupMatches([a, b])
    expect(first.id).toBe('m2')
    expect(first.over).toBe(false)
    expect(second.over).toBe(true)
    expect(second.winners).toEqual(['ข'])
  })
})

describe('suggestNames', () => {
  it('lists earlier names most recent first, and recent line-ups without repeats', async () => {
    const { startRound } = await import('./game')
    const { suggestNames } = await import('./match')
    const saved = (id: string, updatedAt: number, names: string[]) => ({
      id,
      createdAt: updatedAt,
      updatedAt,
      round: startRound(names),
    })
    const result = suggestNames([
      saved('a', 1, ['ออย', 'บีม']),
      saved('b', 3, ['เจ', ' ต้น ']),
      saved('c', 2, ['ออย', 'บีม']),
      saved('d', 4, ['เดี่ยว']),
    ])
    expect(result.names).toEqual(['เดี่ยว', 'เจ', 'ต้น', 'ออย', 'บีม'])
    expect(result.groups).toEqual([
      ['เจ', 'ต้น'],
      ['ออย', 'บีม'],
    ])
  })
})

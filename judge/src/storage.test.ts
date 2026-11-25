import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addWord, editWord, judgeOut, startRound } from './game'
import {
  anonymize,
  exportGames,
  loadGames,
  loadSettings,
  mergeGames,
  parseExport,
  resetDbForTests,
  storeGames,
  type SavedGame,
} from './storage'

function game(id: string, updatedAt: number, finished: boolean): SavedGame {
  let round = startRound(['ออย', 'บีม'])
  round = addWord(round, 'กาแฟ', ['กา', 'แฟ'])
  if (finished) round = judgeOut(round, 'too-slow', '')
  return { id, createdAt: updatedAt, updatedAt, round }
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('anonymize', () => {
  it('sends seat ids and words but never names', () => {
    let round = startRound(['ออย', 'บีม'])
    round = addWord(round, 'ไปรษณีย์', ['ไปร', 'ษณีย์'], true, ['ไป', 'รษ', 'ณีย์'])
    const data = anonymize({ id: 'abc123', createdAt: 5, updatedAt: 6, round })
    expect(JSON.stringify(data)).not.toMatch(/ออย|บีม/)
    expect(data).toEqual({
      version: 1,
      mode: 'normal',
      playerCount: 2,
      startedAt: 5,
      events: [
        {
          type: 'word',
          playerId: 'p1',
          word: 'ไปรษณีย์',
          syllables: ['ไปร', 'ษณีย์'],
          manual: true,
          segmented: ['ไป', 'รษ', 'ณีย์'],
        },
      ],
    })
  })

  it('keeps the segmenter split from before a later correction', () => {
    let round = addWord(startRound(['ออย', 'บีม']), 'มหา', ['ม', 'หา'])
    round = editWord(round, 0, ['มหา'])
    round = editWord(round, 0, ['มะ', 'หา'])
    expect(round.events[0]).toMatchObject({ syllables: ['มะ', 'หา'], segmented: ['ม', 'หา'] })
  })
})

describe('games in IndexedDB', () => {
  beforeEach(async () => {
    resetDbForTests()
    globalThis.indexedDB = new IDBFactory()
  })

  it('stores, updates and removes games', async () => {
    await storeGames([game('aaa111', 1, false), game('bbb222', 2, true)])
    await storeGames([{ ...game('aaa111', 5, true) }], ['bbb222'])
    const all = await loadGames()
    expect(all.map((g) => [g.id, g.updatedAt])).toEqual([['aaa111', 5]])
  })

  it('moves games saved by the localStorage versions, keeping the settings', async () => {
    localStorage.setItem(
      'khamtongchueam.judge.v2',
      JSON.stringify({ namesText: 'ออย', seconds: 4, currentId: 'ccc333', games: [game('ccc333', 3, false)] }),
    )
    expect((await loadGames()).map((g) => g.id)).toEqual(['ccc333'])
    expect(JSON.parse(localStorage.getItem('khamtongchueam.judge.v2')!)).toEqual({
      namesText: 'ออย',
      seconds: 4,
      currentId: 'ccc333',
    })
    expect(loadSettings()).toEqual({ namesText: 'ออย', seconds: 4, currentId: 'ccc333' })
    // a second load does not duplicate anything
    expect(await loadGames()).toHaveLength(1)
  })
})

describe('export and import', () => {
  it('reads back what it wrote, and ignores other files', () => {
    const games = [game('aaa111', 1, true)]
    expect(parseExport(JSON.stringify(exportGames(games)))).toEqual(games)
    expect(parseExport('{"hello":1}')).toBeNull()
    expect(parseExport('not json')).toBeNull()
  })

  it('adds new games and replaces only older copies', () => {
    const here = [game('aaa111', 5, false), game('bbb222', 5, false)]
    const file = [game('aaa111', 9, true), game('bbb222', 1, true), game('ccc333', 1, true)]
    const result = mergeGames(here, file)
    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.games.find((g) => g.id === 'aaa111')?.updatedAt).toBe(9)
    expect(result.games.find((g) => g.id === 'bbb222')?.updatedAt).toBe(5)
  })
})

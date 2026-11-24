import { afterEach, describe, expect, it, vi } from 'vitest'
import { addWord, editWord, judgeOut, startRound } from './game'
import { anonymize, exportGames, mergeGames, parseExport, save, type SavedGame } from './storage'

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

describe('save when storage is full', () => {
  it('drops the oldest finished games, never the open or unfinished ones', () => {
    const games = [game('old1', 1, true), game('open1', 2, true), game('live1', 0, false), game('new1', 9, true)]
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      // pretend only three games fit
      if ((JSON.parse(value) as { games: unknown[] }).games.length > 3) {
        throw new DOMException('full', 'QuotaExceededError')
      }
      real.call(this, key, value)
    })
    const result = save({ namesText: '', seconds: 3, games, currentId: 'open1' })
    expect(result.dropped).toBe(1)
    expect(result.games.map((g) => g.id)).toEqual(['open1', 'live1', 'new1'])
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

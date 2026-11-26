import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addWord, attachCheck, editWord, judgeOut, passHint, startRound, undo, type WordEvent } from './game'
import {
  anonymize,
  roundPrint,
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

  it('sends the split of a word put out, so a filled-in split reaches collection', () => {
    const round = judgeOut(startRound(['ออย', 'บีม', 'เจ']), 'not-noun', 'วิ่งเล่น', ['วิ่ง', 'เล่น'])
    const data = anonymize({ id: 'abc123', createdAt: 5, updatedAt: 6, round })
    expect(data.events[0]).toEqual({
      type: 'judge',
      playerId: 'p1',
      word: 'วิ่งเล่น',
      syllables: ['วิ่ง', 'เล่น'],
      reason: 'not-noun',
    })
  })

  it('sends the hints the judge was shown, to compare with the rulings later', () => {
    let round = addWord(startRound(['ออย', 'บีม', 'เจ']), 'ด็อก', ['ด็อก'])
    round = addWord(round, 'หมา', ['หมา'], false, undefined, ['translation'])
    round = judgeOut(round, 'not-noun', 'กิน', ['กิน'], ['not-noun'])
    const data = anonymize({ id: 'abc123', createdAt: 5, updatedAt: 6, round })
    expect(data.events[0]).not.toHaveProperty('hints')
    expect(data.events[1]).toMatchObject({ word: 'หมา', hints: ['translation'] })
    expect(data.events[2]).toMatchObject({ type: 'judge', word: 'กิน', hints: ['not-noun'] })
  })

  it('sends who pointed each hint out, how the word was checked, and what the judge did', () => {
    let round = addWord(startRound(['ออย', 'บีม', 'เจ']), 'ด็อก', ['ด็อก'])
    round = addWord(round, 'หมา', ['หมา'], false, undefined, [{ kind: 'translation', by: 'dictionary', english: 'dog' }])
    const sent = round.events[1] as WordEvent
    round = attachCheck(round, sent, [{ kind: 'translation', by: 'both', english: 'dog' }], { by: 'model', model: 'gemma' })
    round = passHint(round, 1, 'translation')
    const data = anonymize({ id: 'abc123', createdAt: 5, updatedAt: 6, round })
    expect(data.events[1]).toMatchObject({
      hints: ['translation'],
      hintInfo: [{ kind: 'translation', by: 'both', english: 'dog', passed: true }],
      checked: { by: 'model', model: 'gemma' },
    })
  })

  it('does not count hints arriving later as a change of the log', () => {
    const round = addWord(startRound(['ออย', 'บีม']), 'กิน', ['กิน'])
    const later = attachCheck(round, round.events[0] as WordEvent, [{ kind: 'not-noun', by: 'model' }], { by: 'model' })
    expect(later).not.toBe(round)
    expect(roundPrint(later.events)).toBe(roundPrint(round.events))
  })

  it('drops an answer for a word no longer in the log as it was', () => {
    const round = addWord(startRound(['ออย', 'บีม']), 'กิน', ['กิน'])
    const sent = round.events[0] as WordEvent
    const redone = addWord(undo(round), 'นอน', ['นอน'])
    expect(attachCheck(redone, sent, [{ kind: 'not-noun' }], { by: 'model' }, 0)).toBe(redone)
    expect(attachCheck(undo(round), sent, [{ kind: 'not-noun' }], { by: 'model' }, 0)).toEqual(undo(round))
  })

  it('keeps the judge\'s pass when the AI answers after it', () => {
    const round = addWord(startRound(['ออย', 'บีม']), 'กิน', ['กิน'], false, undefined, ['not-noun'])
    const passed = passHint(round, 0, 'not-noun')
    const later = attachCheck(passed, round.events[0] as WordEvent, [{ kind: 'not-noun', by: 'both' }], { by: 'model' }, 0)
    expect(later.events[0]).toMatchObject({ hintInfo: [{ kind: 'not-noun', by: 'both', passed: true }] })
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

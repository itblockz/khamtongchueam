import { describe, expect, it } from 'vitest'
import {
  confirmDuplicate,
  currentPlayer,
  findClashes,
  nextPlayer,
  overruleDuplicate,
  parseNames,
  startGame,
  submitWord,
} from './game'

describe('parseNames', () => {
  it('ignores blank lines and trims names', () => {
    expect(parseNames('  ออย \n\n บีม\n')).toEqual({
      names: ['ออย', 'บีม'],
      duplicates: [],
      canStart: true,
    })
  })

  it('needs at least two players', () => {
    expect(parseNames('ออย').canStart).toBe(false)
  })

  it('reports repeated names ignoring case and spaces', () => {
    const result = parseNames('Aoy\nบีม\n aoy \nบีม')
    expect(result.duplicates).toEqual(['aoy', 'บีม'])
    expect(result.canStart).toBe(false)
  })
})

describe('turns and duplicates', () => {
  it('rotates turns in roster order', () => {
    let game = startGame(['ออย', 'บีม', 'เจ'])
    expect(currentPlayer(game).name).toBe('ออย')
    expect(nextPlayer(game).name).toBe('บีม')

    game = submitWord(game, 'กาแฟ', ['กา', 'แฟ'])
    expect(currentPlayer(game).name).toBe('บีม')
    expect(game.words).toEqual([{ word: 'กาแฟ', syllables: ['กา', 'แฟ'], playerId: 'p1' }])
  })

  it('allows a syllable repeated inside the same word', () => {
    const game = submitWord(startGame(['ออย', 'บีม']), 'นานา', ['นา', 'นา'])
    expect(game.pending).toBeNull()
    expect(game.words).toHaveLength(1)
  })

  it('finds every clashing syllable with the word that used it first', () => {
    const words = [
      { word: 'มหา', syllables: ['ม', 'หา'], playerId: 'p1' },
      { word: 'หาดทราย', syllables: ['หาด', 'ทราย'], playerId: 'p2' },
    ]
    expect(findClashes(words, ['ทราย', 'หา'])).toEqual([
      { syllable: 'ทราย', word: 'หาดทราย' },
      { syllable: 'หา', word: 'มหา' },
    ])
  })

  it('holds a duplicate for the judge without moving the turn', () => {
    let game = startGame(['ออย', 'บีม', 'เจ'])
    game = submitWord(game, 'มหา', ['ม', 'หา'])
    game = submitWord(game, 'หาดทราย', ['หา', 'ดทราย'])

    expect(game.pending).toEqual({
      word: 'หาดทราย',
      syllables: ['หา', 'ดทราย'],
      clashes: [{ syllable: 'หา', word: 'มหา' }],
    })
    expect(currentPlayer(game).name).toBe('บีม')
    // nothing else can be submitted until the judge decides
    expect(submitWord(game, 'กาแฟ', ['กา', 'แฟ'])).toBe(game)
  })

  it('eliminates the player when the judge confirms, skipping them afterwards', () => {
    let game = startGame(['ออย', 'บีม', 'เจ'])
    game = submitWord(game, 'มหา', ['ม', 'หา'])
    game = submitWord(game, 'หา', ['หา'])
    game = confirmDuplicate(game)

    expect(game.players.find((p) => p.name === 'บีม')?.out).toBe(true)
    expect(game.words.map((w) => w.word)).toEqual(['มหา'])
    expect(currentPlayer(game).name).toBe('เจ')
    expect(nextPlayer(game).name).toBe('ออย')
    expect(game.winnerId).toBeNull()
  })

  it('keeps the word and moves on when the judge overrules', () => {
    let game = startGame(['ออย', 'บีม'])
    game = submitWord(game, 'มหา', ['ม', 'หา'])
    game = submitWord(game, 'หา', ['หา'])
    game = overruleDuplicate(game)

    expect(game.pending).toBeNull()
    expect(game.words.map((w) => w.word)).toEqual(['มหา', 'หา'])
    expect(currentPlayer(game).name).toBe('ออย')
  })

  it('declares the last player left the winner', () => {
    let game = startGame(['ออย', 'บีม'])
    game = submitWord(game, 'มหา', ['ม', 'หา'])
    game = submitWord(game, 'หา', ['หา'])
    game = confirmDuplicate(game)

    expect(game.winnerId).toBe('p1')
    expect(submitWord(game, 'กาแฟ', ['กา', 'แฟ'])).toBe(game)
  })
})

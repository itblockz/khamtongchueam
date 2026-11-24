import { describe, expect, it } from 'vitest'
import {
  addWord,
  applyEdit,
  applyJudge,
  describeChanges,
  currentPlayer,
  editWord,
  findClashes,
  judgeOut,
  nextPlayer,
  parseNames,
  parseSyllables,
  replay,
  startRound,
  undo,
  type Round,
} from './game'

/** Log words in order; each entry is [word, syllables]. */
function play(names: string[], words: [string, string[]][]): Round {
  return words.reduce(
    (round, [word, syllables]) => addWord(round, word, syllables),
    startRound(names),
  )
}

const nameOf = (round: Round, id: string | null) =>
  round.players.find((player) => player.id === id)?.name ?? null

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

describe('parseSyllables', () => {
  it('splits on spaces, | and /', () => {
    expect(parseSyllables(' ไปร  ษ|ณีย์ / ')).toEqual(['ไปร', 'ษ', 'ณีย์'])
  })
})

describe('findClashes', () => {
  it('finds every clashing syllable with the word that used it first', () => {
    const words = [
      { word: 'มหา', syllables: ['ม', 'หา'], playerId: 'p1' },
      { word: 'หาดทราย', syllables: ['หาด', 'ทราย'], playerId: 'p2' },
    ]
    expect(findClashes(words, ['ทราย', 'หา'])).toEqual([
      { syllable: 'ทราย', word: 'หาดทราย', playerId: 'p2' },
      { syllable: 'หา', word: 'มหา', playerId: 'p1' },
    ])
  })
})

describe('playing a round', () => {
  it('rotates turns in roster order and logs who said each word', () => {
    const round = play(['ออย', 'บีม', 'เจ'], [['กาแฟ', ['กา', 'แฟ']]])
    const game = replay(round)

    expect(currentPlayer(game).name).toBe('บีม')
    expect(nextPlayer(game).name).toBe('เจ')
    expect(round.events).toEqual([
      { type: 'word', playerId: 'p1', word: 'กาแฟ', syllables: ['กา', 'แฟ'] },
    ])
  })

  it('allows a syllable repeated inside the same word', () => {
    const game = replay(play(['ออย', 'บีม'], [['นานา', ['นา', 'นา']]]))
    expect(game.lastElimination).toBeNull()
    expect(game.words).toHaveLength(1)
  })

  it('puts the speaker out on a repeated syllable and says why', () => {
    const game = replay(
      play(['ออย', 'บีม', 'เจ'], [
        ['มหา', ['ม', 'หา']],
        ['หาเงิน', ['หา', 'เงิน']],
      ]),
    )

    expect(game.players.find((p) => p.name === 'บีม')?.out).toBe(true)
    expect(game.lastElimination).toEqual({
      playerId: 'p2',
      word: 'หาเงิน',
      syllables: ['หา', 'เงิน'],
      clashes: [{ syllable: 'หา', word: 'มหา', playerId: 'p1', index: 0 }],
    })
    expect(game.words.map((w) => w.word)).toEqual(['มหา'])
    expect(currentPlayer(game).name).toBe('เจ')
    expect(nextPlayer(game).name).toBe('ออย')
  })

  it('clears the elimination notice once the next word counts', () => {
    const game = replay(
      play(['ออย', 'บีม', 'เจ'], [
        ['มหา', ['ม', 'หา']],
        ['หา', ['หา']],
        ['กาแฟ', ['กา', 'แฟ']],
      ]),
    )
    expect(game.lastElimination).toBeNull()
    expect(currentPlayer(game).name).toBe('ออย')
  })

  it('ends the round when one player is left and ignores further words', () => {
    let round = play(['ออย', 'บีม'], [
      ['มหา', ['ม', 'หา']],
      ['หา', ['หา']],
    ])
    expect(nameOf(round, replay(round).winnerId)).toBe('ออย')
    expect(addWord(round, 'กาแฟ', ['กา', 'แฟ'])).toBe(round)

    round = undo(round)
    expect(replay(round).winnerId).toBeNull()
    expect(currentPlayer(replay(round)).name).toBe('บีม')
  })

  it('marks a judge-typed split', () => {
    const round = addWord(startRound(['ออย', 'บีม']), 'ไปรษณีย์', parseSyllables('ไปร ษ ณีย์'), true)
    expect(replay(round).words[0]).toEqual({
      word: 'ไปรษณีย์',
      syllables: ['ไปร', 'ษ', 'ณีย์'],
      playerId: 'p1',
      manual: true,
      index: 0,
    })
  })
})

describe('undo', () => {
  it('removes the latest word and gives the turn back', () => {
    const round = play(['ออย', 'บีม', 'เจ'], [
      ['กาแฟ', ['กา', 'แฟ']],
      ['แฟนคลับ', ['แฟน', 'คลับ']],
    ])
    const game = replay(undo(round))

    expect(game.words.map((w) => w.word)).toEqual(['กาแฟ'])
    expect(currentPlayer(game).name).toBe('บีม')
  })

  it('brings back a player who went out on the undone word', () => {
    const round = play(['ออย', 'บีม'], [
      ['มหา', ['ม', 'หา']],
      ['หา', ['หา']],
    ])
    const game = replay(undo(round))

    expect(game.players.every((p) => !p.out)).toBe(true)
    expect(game.lastElimination).toBeNull()
  })

  it('does nothing on an empty round', () => {
    const round = startRound(['ออย', 'บีม'])
    expect(undo(round)).toBe(round)
  })
})

describe('correcting an earlier split (replay)', () => {
  // The case from play: อารบิก was split อาร|บิก but should be อา|ร|บิก,
  // which repeats อา from อาหาร.
  const names = ['ชช', 'ลล', 'มม']
  const words: [string, string[]][] = [
    ['อาหาร', ['อา', 'หาร']], // ชช
    ['อารบิก', ['อาร', 'บิก']], // ลล
    ['บิกินี', ['บิ', 'กิ', 'นี']], // มม
    ['นีออน', ['นี', 'ออน']], // ชช: repeats นี from บิกินี
    ['กาแฟ', ['กา', 'แฟ']], // ลล
  ]

  it('before the fix: only ชช is out and ลล keeps playing', () => {
    const before = replay(play(names, words))
    expect(before.players.filter((p) => p.out).map((p) => p.name)).toEqual(['ชช'])
    expect(before.winnerId).toBeNull()
  })

  it('puts the speaker out retroactively, keeps speakers fixed and ends the round', () => {
    const round = editWord(play(names, words), 1, ['อา', 'ร', 'บิก'])
    const fixed = replay(round)

    // ลล goes out at อารบิก: อา repeats อาหาร
    expect(fixed.results[1]).toMatchObject({
      status: 'duplicate',
      manual: true,
      clashes: [{ syllable: 'อา', word: 'อาหาร', playerId: 'p1', index: 0 }],
    })
    // นีออน still repeats นี, so ชช is out too and มม wins
    expect(fixed.results[3]).toMatchObject({ status: 'duplicate', playerId: 'p1' })
    expect(nameOf(round, fixed.winnerId)).toBe('มม')
    // ลล's กาแฟ came after the round ended in the corrected log
    expect(fixed.results[4]).toMatchObject({ word: 'กาแฟ', playerId: 'p2', status: 'after-end' })
    expect(fixed.words.map((w) => w.word)).toEqual(['อาหาร', 'บิกินี'])
  })

  it('voids words said by a player who is out after a correction', () => {
    const round = play(['ชช', 'ลล', 'มม'], [
      ['อาหาร', ['อา', 'หาร']], // ชช
      ['อารบิก', ['อาร', 'บิก']], // ลล
      ['กาแฟ', ['กา', 'แฟ']], // มม
      ['แฟนคลับ', ['แฟน', 'คลับ']], // ชช
      ['คลับเฮาส์', ['คลับ', 'เฮาส์']], // ลล: repeats คลับ -> out
    ])
    const fixed = replay(editWord(round, 1, ['อา', 'ร', 'บิก']))

    expect(fixed.results[1].status).toBe('duplicate')
    expect(fixed.results[4]).toMatchObject({ playerId: 'p2', status: 'speaker-out', clashes: [] })
    expect(fixed.players.filter((p) => p.out).map((p) => p.name)).toEqual(['ลล'])
    expect(fixed.lastElimination).toBeNull()
    expect(currentPlayer(fixed).name).toBe('มม')
  })

  it('brings a player back when a correction removes their duplicate', () => {
    const round = play(['ออย', 'บีม', 'เจ'], [
      ['มหา', ['มหา']], // ออย: segmenter kept มหา whole
      ['หาเงิน', ['หา', 'เงิน']], // บีม
      ['มหาชน', ['มหา', 'ชน']], // เจ: repeats มหา -> out
      ['ชนะ', ['ช', 'นะ']], // ออย
    ])
    expect(replay(round).players.filter((p) => p.out).map((p) => p.name)).toEqual(['เจ'])

    const fixed = replay(editWord(round, 2, ['มหาช', 'น']))

    expect(fixed.players.every((p) => !p.out)).toBe(true)
    expect(fixed.results[2]).toMatchObject({ status: 'counted', manual: true })
    // play goes on from the current turn: after ออย comes บีม, and เจ is back in the rotation
    expect(currentPlayer(fixed).name).toBe('บีม')
    expect(nextPlayer(fixed).name).toBe('เจ')
  })
})

describe('describeChanges', () => {
  it('summarises a retroactive correction', () => {
    const round = play(['ชช', 'ลล', 'มม'], [
      ['อาหาร', ['อา', 'หาร']],
      ['อารบิก', ['อาร', 'บิก']],
      ['กาแฟ', ['กา', 'แฟ']],
      ['แฟนคลับ', ['แฟน', 'คลับ']],
      ['คลับเฮาส์', ['คลับ', 'เฮาส์']],
    ])
    const before = replay(round)
    const after = replay(editWord(round, 1, ['อา', 'ร', 'บิก']))

    expect(describeChanges(before, after)).toEqual([
      'ลล ตกรอบที่คำ “อารบิก” (“อา” ซ้ำกับ คำที่ 1 “อาหาร” ของ ชช)',
      'คำ “คลับเฮาส์” ของ ลล จะไม่นับ (ตกรอบไปแล้ว)',
    ])
  })

  it('reports nothing when the outcome is the same', () => {
    const round = play(['ออย', 'บีม'], [['กาแฟ', ['กา', 'แฟ']]])
    expect(describeChanges(replay(round), replay(editWord(round, 0, ['กาแ', 'ฟ'])))).toEqual([])
  })
})

describe('applyEdit', () => {
  const round = play(['ชช', 'ลล', 'มม'], [
    ['อาหาร', ['อา', 'หาร']],
    ['อารบิก', ['อาร', 'บิก']],
    ['บิกินี', ['บิ', 'กิ', 'นี']],
    ['นีออน', ['นี', 'ออน']],
  ])

  it('goes back to the first changed word and removes everything after it', () => {
    const { round: fixed, removed } = applyEdit(round, 1, ['อา', 'ร', 'บิก'])
    const game = replay(fixed)

    expect(removed.map((e) => e.word)).toEqual(['บิกินี', 'นีออน'])
    expect(fixed.events.map((e) => e.word)).toEqual(['อาหาร', 'อารบิก'])
    expect(game.players.filter((p) => p.out).map((p) => p.name)).toEqual(['ลล'])
    expect(currentPlayer(game).name).toBe('มม')
    expect(game.results.every((r) => r.status === 'counted' || r.status === 'duplicate')).toBe(true)
  })

  it('keeps every word when the outcome does not change', () => {
    const { round: fixed, removed } = applyEdit(round, 0, ['อาห', 'าร'])
    expect(removed).toEqual([])
    expect(fixed.events).toHaveLength(4)
    expect(fixed.events[0]).toMatchObject({ manual: true })
  })

  it('cuts after a later word whose outcome changed', () => {
    // freeing นี (บิกินี -> บิ|กิ|นิ) makes นีออน count; words after it go
    const longer = addWord(round, 'ออนไลน์', ['ออน', 'ไลน์'])
    const { round: fixed, removed } = applyEdit(longer, 2, ['บิ', 'กิ', 'นิ'])
    expect(fixed.events.map((e) => e.word)).toEqual(['อาหาร', 'อารบิก', 'บิกินี', 'นีออน'])
    expect(removed.map((e) => e.word)).toEqual(['ออนไลน์'])
  })
})

describe('judgeOut', () => {
  it('puts the current player out with the reason, and their word does not count', () => {
    let round = play(['ออย', 'บีม', 'เจ'], [['กาแฟ', ['กา', 'แฟ']]])
    round = judgeOut(round, 'not-noun', ' วิ่ง ')
    const game = replay(round)

    expect(game.players.filter((p) => p.out).map((p) => p.name)).toEqual(['บีม'])
    expect(game.lastElimination).toEqual({
      playerId: 'p2',
      word: 'วิ่ง',
      syllables: [],
      clashes: [],
      reason: 'not-noun',
    })
    expect(game.results[1]).toMatchObject({ status: 'judged', reason: 'not-noun', syllables: [] })
    expect(game.words.map((w) => w.word)).toEqual(['กาแฟ'])
    expect(currentPlayer(game).name).toBe('เจ')
  })

  it('can end the round and be undone', () => {
    const empty = startRound(['ออย', 'บีม'])
    expect(judgeOut(empty, 'forbidden', '  ')).toBe(empty)
    const round = judgeOut(empty, 'forbidden', 'คำหยาบ')
    expect(nameOf(round, replay(round).winnerId)).toBe('บีม')
    expect(judgeOut(round, 'forbidden', 'อีก')).toBe(round)
    expect(replay(undo(round)).winnerId).toBeNull()
  })

  it('cannot be edited like a word', () => {
    const round = judgeOut(startRound(['ออย', 'บีม']), 'not-noun', 'วิ่ง')
    expect(editWord(round, 0, ['วิ่ง'])).toBe(round)
  })
})

describe('applyJudge', () => {
  const round = play(['ชช', 'ลล', 'มม'], [
    ['อาหาร', ['อา', 'หาร']],
    ['บิกินี', ['บิ', 'กิ', 'นี']],
    ['นีออน', ['นี', 'ออน']],
    ['กาแฟ', ['กา', 'แฟ']],
  ])

  it('rules an earlier word out and rewinds to it', () => {
    const { round: ruled, removed } = applyJudge(round, 1, 'forbidden')
    const game = replay(ruled)

    expect(removed.map((e) => e.word)).toEqual(['นีออน', 'กาแฟ'])
    expect(game.results[1]).toMatchObject({ word: 'บิกินี', status: 'judged', reason: 'forbidden', playerId: 'p2' })
    expect(game.players.filter((p) => p.out).map((p) => p.name)).toEqual(['ลล'])
    expect(game.words.map((w) => w.word)).toEqual(['อาหาร'])
    expect(currentPlayer(game).name).toBe('มม')
  })

  it('ignores entries that are not words', () => {
    const judged = judgeOut(round, 'not-noun', 'วิ่ง')
    expect(applyJudge(judged, 4, 'forbidden').round).toBe(judged)
  })
})

describe('too slow', () => {
  it('puts the player out without a typed word', async () => {
    const { judgeOut, replay, startRound } = await import('./game')
    const state = replay(judgeOut(startRound(['ก', 'ข', 'ค']), 'too-slow', ''))
    expect(state.lastElimination?.reason).toBe('too-slow')
    expect(state.players[0].out).toBe(true)
  })

  it('still needs a word for other decisions', async () => {
    const { judgeOut, startRound } = await import('./game')
    const round = startRound(['ก', 'ข'])
    expect(judgeOut(round, 'not-noun', ' ')).toBe(round)
  })
})

describe('single-consonant syllables', () => {
  it('never clash', async () => {
    const { findClashes } = await import('./game')
    const words = [{ word: 'สแปร์', syllables: ['ส', 'แปร์'], playerId: 'p1' }]
    expect(findClashes(words, ['ส', 'ปีก', 'เกอร์'])).toEqual([])
    expect(findClashes(words, ['แปร์', 'ปลา'])).toEqual([{ syllable: 'แปร์', word: 'สแปร์', playerId: 'p1' }])
  })
})

describe('challenge', () => {
  const setup = async () => {
    const game = await import('./game')
    let round = game.startRound(['ก', 'ข', 'ค', 'ง'])
    round = game.addWord(round, 'กาแฟ', ['กา', 'แฟ'])
    round = game.addWord(round, 'แฟนคลับ', ['แฟน', 'คลับ'])
    round = game.addWord(round, 'ดาวอังคาร', ['ดาว', 'อัง', 'คาร'])
    return { game, round }
  }

  it('a failed challenge puts the challenger out and keeps the turn', async () => {
    const { game, round } = await setup()
    // ง (p4) is up; ก (p1) challenges word 3 and loses
    const { round: after, removed } = game.applyChallenge(round, 2, 'p1', false)
    const state = game.replay(after)
    expect(removed).toEqual([])
    expect(state.players.find((p) => p.id === 'p1')?.out).toBe(true)
    expect(game.currentPlayer(state).id).toBe('p4')
    expect(state.words).toHaveLength(3)
    expect(state.lastElimination).toMatchObject({ playerId: 'p1', lostChallengeAt: 2 })
    expect(game.describeChallenge('ดาวอังคาร', 2)).toBe(
      'ชาเลนจ์ คำที่ 3 “ดาวอังคาร” ว่าไม่เชื่อม',
    )
  })

  it('moves the turn on when the player whose turn it is loses a challenge', async () => {
    const { game, round } = await setup()
    const state = game.replay(game.applyChallenge(round, 2, 'p4', false).round)
    expect(game.currentPlayer(state).id).toBe('p1')
  })

  it('a successful challenge rules the word out and goes back to it', async () => {
    const { game, round } = await setup()
    const { round: after, removed } = game.applyChallenge(round, 1, 'p4', true)
    const state = game.replay(after)
    expect(removed.map((e) => e.word)).toEqual(['ดาวอังคาร'])
    expect(state.players.find((p) => p.id === 'p2')?.out).toBe(true)
    expect(state.results[1]).toMatchObject({ status: 'judged', challengerId: 'p4' })
    expect(game.currentPlayer(state).id).toBe('p3')
  })

  it('cannot be made by the speaker or by someone who is out', async () => {
    const { game, round } = await setup()
    expect(game.applyChallenge(round, 1, 'p2', false).round).toBe(round)
    const out = game.applyChallenge(round, 2, 'p1', false).round
    expect(game.applyChallenge(out, 1, 'p1', false).round).toBe(out)
  })

  it('cannot be made against the first word, which has nothing to connect to', async () => {
    const { game, round } = await setup()
    expect(game.applyChallenge(round, 0, 'p3', false).round).toBe(round)
  })
})

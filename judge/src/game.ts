// Game rules for the judge app, kept free of UI so they can be tested on their own.
//
// A round is stored as a log of what happened, in order. The game state (who is out,
// whose turn it is, which words count) is always recomputed by replaying the log,
// so undoing or correcting an earlier entry gives a consistent result.
//
// Rules, applied while replaying:
// - Players take turns in roster order, skipping players who are out.
// - A word is checked against the syllables of every word that counts so far.
//   Repeating a syllable inside the same word is allowed (นานา).
// - A repeated syllable puts the speaker out at that word; the word does not count.
// - A word said by someone who is already out (for example because an earlier word
//   was corrected) does not count, so its syllables stay free.
// - Who said each word never changes; a player whose elimination is undone by a
//   correction simply plays again from the current turn on.
// - When one player is left the round ends; anything logged after that is ignored.

export interface Player {
  id: string
  name: string
  out: boolean
}

export interface Clash {
  syllable: string
  /** The earlier word that already used this syllable. */
  word: string
  /** Who said that earlier word. */
  playerId: string
  /** Its position in the round (0-based), as numbered in the word list minus one. */
  index?: number
}

export interface WordEvent {
  type: 'word'
  playerId: string
  word: string
  syllables: string[]
  /** The judge typed the syllables instead of using the segmenter's split. */
  manual?: boolean
}

export type JudgeReason = 'not-connected' | 'not-noun' | 'forbidden' | 'too-slow'

/** The judge put the current player out for the word they said. */
export interface JudgeEvent {
  type: 'judge'
  playerId: string
  word: string
  reason: JudgeReason
}

export type RoundEvent = WordEvent | JudgeEvent

export const JUDGE_REASON_LABEL: Record<JudgeReason, string> = {
  'not-connected': 'ไม่เชื่อม',
  'not-noun': 'ไม่ใช่คำนาม',
  forbidden: 'คำต้องห้าม',
  'too-slow': 'ไม่ทันเวลา',
}

/** Judge reasons in the order the buttons show them. */
export const JUDGE_REASONS: JudgeReason[] = ['not-connected', 'not-noun', 'forbidden', 'too-slow']

/** Reasons that need the word typed first. "ไม่ทันเวลา" (no first sound in time, or
 * stretching a sound to think) can happen before any word is spoken. */
export function needsWord(reason: JudgeReason): boolean {
  return reason !== 'too-slow'
}

/** How a judged word reads: “word” reason, or just the reason when nothing was said. */
export function judgedText(word: string, reason: JudgeReason): string {
  return word ? `“${word}” ${JUDGE_REASON_LABEL[reason]}` : JUDGE_REASON_LABEL[reason]
}

export interface Round {
  players: { id: string; name: string }[]
  events: RoundEvent[]
}

export type WordStatus = 'counted' | 'duplicate' | 'judged' | 'speaker-out' | 'after-end'

export interface WordResult {
  /** Position of this entry in `round.events`. */
  index: number
  word: string
  syllables: string[]
  playerId: string
  manual: boolean
  status: WordStatus
  clashes: Clash[]
  /** Set for judge decisions. */
  reason?: JudgeReason
}

export interface WordEntry {
  word: string
  syllables: string[]
  playerId: string
  manual?: boolean
  /** Position in the round (0-based). */
  index?: number
}

export interface Elimination {
  playerId: string
  word: string
  syllables: string[]
  clashes: Clash[]
  manual?: boolean
  /** Set when the judge put the player out; otherwise it was a repeated syllable. */
  reason?: JudgeReason
}

export interface GameState {
  players: Player[]
  /** Index in `players` of the player whose turn it is. */
  turn: number
  /** Words that count this round, oldest first. */
  words: WordEntry[]
  /** Every logged word with what happened to it, oldest first. */
  results: WordResult[]
  /** The elimination caused by the latest logged word, if it caused one. */
  lastElimination: Elimination | null
  winnerId: string | null
}

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ')
}

/** One name per line. Blank lines are ignored; repeats are compared ignoring case and extra spaces. */
export function parseNames(text: string) {
  const names = text.split('\n').map(normalizeName).filter(Boolean)
  const seen = new Set<string>()
  const duplicates: string[] = []

  for (const name of names) {
    const key = name.toLocaleLowerCase()
    if (seen.has(key) && !duplicates.some((d) => d.toLocaleLowerCase() === key)) {
      duplicates.push(name)
    }
    seen.add(key)
  }

  return { names, duplicates, canStart: names.length >= 2 && duplicates.length === 0 }
}

/** Split a judge-typed syllable list: spaces, | or / separate syllables. */
export function parseSyllables(text: string): string[] {
  return text.split(/[\s|/]+/).map((part) => part.trim()).filter(Boolean)
}

export function startRound(names: string[]): Round {
  return {
    players: names.map((name, index) => ({ id: `p${index + 1}`, name })),
    events: [],
  }
}

/** Syllables of the new word that were already used, each with the word that used it first. */
/** A syllable that is one consonant on its own (the ส in ส|แปร์, the ม in ม|หา) is too
 * short to count as reusing a syllable, so it never clashes. */
export function countsForClash(syllable: string): boolean {
  return !/^[ก-ฮ]$/.test(syllable)
}

export function findClashes(words: WordEntry[], syllables: string[]): Clash[] {
  const firstUse = new Map<string, WordEntry>()
  for (const entry of words) {
    for (const syllable of entry.syllables) {
      if (!firstUse.has(syllable)) {
        firstUse.set(syllable, entry)
      }
    }
  }

  return Array.from(new Set(syllables))
    .filter((syllable) => countsForClash(syllable) && firstUse.has(syllable))
    .map((syllable) => {
      const entry = firstUse.get(syllable)!
      return {
        syllable,
        word: entry.word,
        playerId: entry.playerId,
        ...(entry.index !== undefined ? { index: entry.index } : {}),
      }
    })
}

function nextActiveIndex(players: Player[], from: number): number {
  for (let step = 1; step <= players.length; step += 1) {
    const index = (from + step) % players.length
    if (!players[index].out) {
      return index
    }
  }
  return from
}

/** Recompute the whole game state from the round log. */
export function replay(round: Round): GameState {
  const players: Player[] = round.players.map((player) => ({ ...player, out: false }))
  const words: WordEntry[] = []
  const results: WordResult[] = []
  let turn = 0
  let lastElimination: Elimination | null = null
  let winnerId: string | null = null

  round.events.forEach((event, index) => {
    const isJudge = event.type === 'judge'
    const base = {
      index,
      word: event.word,
      syllables: isJudge ? [] : event.syllables,
      playerId: event.playerId,
      manual: !isJudge && Boolean(event.manual),
      ...(isJudge ? { reason: event.reason } : {}),
    }

    if (winnerId) {
      results.push({ ...base, status: 'after-end', clashes: [] })
      return
    }

    const speakerIndex = players.findIndex((player) => player.id === event.playerId)
    const speaker = players[speakerIndex]

    if (!speaker || speaker.out) {
      results.push({ ...base, status: 'speaker-out', clashes: [] })
      lastElimination = null
      if (speakerIndex >= 0) {
        turn = nextActiveIndex(players, speakerIndex)
      }
      return
    }

    if (event.type === 'judge') {
      speaker.out = true
      results.push({ ...base, status: 'judged', clashes: [] })
      lastElimination = {
        playerId: speaker.id,
        word: event.word,
        syllables: [],
        clashes: [],
        reason: event.reason,
      }
      const remaining = players.filter((player) => !player.out)
      if (remaining.length === 1) {
        winnerId = remaining[0].id
      }
      turn = nextActiveIndex(players, speakerIndex)
      return
    }

    const clashes = findClashes(words, event.syllables)
    if (clashes.length > 0) {
      speaker.out = true
      results.push({ ...base, status: 'duplicate', clashes })
      lastElimination = {
        playerId: speaker.id,
        word: event.word,
        syllables: event.syllables,
        clashes,
        ...(event.manual ? { manual: true } : {}),
      }
      const remaining = players.filter((player) => !player.out)
      if (remaining.length === 1) {
        winnerId = remaining[0].id
      }
    } else {
      const entry: WordEntry = { word: event.word, syllables: event.syllables, playerId: speaker.id, index }
      if (event.manual) {
        entry.manual = true
      }
      words.push(entry)
      results.push({ ...base, status: 'counted', clashes: [] })
      lastElimination = null
    }

    turn = nextActiveIndex(players, speakerIndex)
  })

  if (players[turn]?.out) {
    turn = nextActiveIndex(players, turn)
  }

  return { players, turn, words, results, lastElimination, winnerId }
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.turn]
}

export function nextPlayer(state: GameState): Player {
  return state.players[nextActiveIndex(state.players, state.turn)]
}

/** Log the current player's word. `manual` means the judge typed the split. */
export function addWord(round: Round, word: string, syllables: string[], manual = false): Round {
  const trimmed = word.trim()
  const state = replay(round)
  if (state.winnerId || !trimmed || syllables.length === 0) {
    return round
  }

  const event: WordEvent = {
    type: 'word',
    playerId: currentPlayer(state).id,
    word: trimmed,
    syllables,
  }
  if (manual) {
    event.manual = true
  }
  return { ...round, events: [...round.events, event] }
}

/** Remove the latest entry from the log. */
export function undo(round: Round): Round {
  if (round.events.length === 0) {
    return round
  }
  return { ...round, events: round.events.slice(0, -1) }
}

/** Replace the split of an earlier word (the judge corrected it). */
export function editWord(round: Round, index: number, syllables: string[]): Round {
  const event = round.events[index]
  if (!event || event.type !== 'word' || syllables.length === 0) {
    return round
  }
  const events = round.events.slice()
  events[index] = { ...event, syllables, manual: true }
  return { ...round, events }
}

/** Human-readable list of what changes in the game between two states (for confirming an edit). */
export function describeChanges(before: GameState, after: GameState): string[] {
  const changes: string[] = []
  const name = (state: GameState, id: string) =>
    state.players.find((player) => player.id === id)?.name ?? ''
  const newlyOutAtWord = new Set<string>()

  after.results.forEach((result, index) => {
    const was = before.results[index]
    if (!was || was.status === result.status) return
    const speaker = name(after, result.playerId)
    const label = `คำ “${result.word}” ของ ${speaker}`
    if (result.status === 'duplicate') {
      const reason = result.clashes.map((c) => `“${c.syllable}” ซ้ำกับ “${c.word}”`).join(', ')
      changes.push(`${speaker} ตกรอบที่คำ “${result.word}” (${reason})`)
      newlyOutAtWord.add(result.playerId)
    } else if (result.status === 'counted') changes.push(`${label} จะนับ`)
    else if (result.status === 'speaker-out') changes.push(`${label} จะไม่นับ (ตกรอบไปแล้ว)`)
    else changes.push(`${label} จะไม่นับ (หลังจบรอบ)`)
  })

  after.players.forEach((player, index) => {
    const was = before.players[index]
    if (!was.out && player.out && !newlyOutAtWord.has(player.id)) changes.unshift(`${player.name} ตกรอบ`)
    if (was.out && !player.out) changes.unshift(`${player.name} กลับมาเล่น`)
  })

  if (before.winnerId !== after.winnerId) {
    changes.push(after.winnerId ? `${name(after, after.winnerId)} ชนะ` : 'รอบยังไม่จบ เล่นต่อ')
  } else if (!after.winnerId && before.turn !== after.turn) {
    changes.push(
      `ตาต่อไปเปลี่ยนจาก ${before.players[before.turn].name} เป็น ${after.players[after.turn].name}`,
    )
  }

  return changes
}

export const STATUS_LABEL: Record<WordStatus, string> = {
  counted: '',
  duplicate: 'พยางค์ซ้ำ',
  judged: 'กรรมการให้ตก',
  'speaker-out': 'ไม่นับ (ตกรอบไปแล้ว)',
  'after-end': 'ไม่นับ (หลังจบรอบ)',
}

/**
 * Correct the split of an earlier word. If that changes the outcome of any word,
 * the round goes back to the first word whose outcome changed: that word stays and
 * every word after it is removed, as if the judge had caught it at the time.
 */
export function applyEdit(
  round: Round,
  index: number,
  syllables: string[],
): { round: Round; removed: RoundEvent[] } {
  const edited = editWord(round, index, syllables)
  if (edited === round) {
    return { round, removed: [] }
  }

  const before = replay(round).results
  const after = replay(edited).results
  const firstChanged = after.findIndex(
    (result, i) => i >= index && result.status !== before[i]?.status,
  )
  if (firstChanged === -1) {
    return { round: edited, removed: [] }
  }

  return {
    round: { ...edited, events: edited.events.slice(0, firstChanged + 1) },
    removed: edited.events.slice(firstChanged + 1),
  }
}

/** The judge puts the current player out, e.g. the word is not a noun. */
export function judgeOut(round: Round, reason: JudgeReason, word: string): Round {
  const state = replay(round)
  if (state.winnerId || (needsWord(reason) && !word.trim())) {
    return round
  }
  const event: JudgeEvent = { type: 'judge', playerId: currentPlayer(state).id, word: word.trim(), reason }
  return { ...round, events: [...round.events, event] }
}

/**
 * The judge rules an earlier word out (not a noun, forbidden). Its speaker goes out at
 * that word and every word after it is removed, like correcting a split.
 */
export function applyJudge(
  round: Round,
  index: number,
  reason: JudgeReason,
): { round: Round; removed: RoundEvent[] } {
  const event = round.events[index]
  if (!event || event.type !== 'word') {
    return { round, removed: [] }
  }
  const judged: JudgeEvent = { type: 'judge', playerId: event.playerId, word: event.word, reason }
  return {
    round: { ...round, events: [...round.events.slice(0, index), judged] },
    removed: round.events.slice(index + 1),
  }
}

/**
 * Decisions available for the word at `index` (default: the word being typed now).
 * "ไม่เชื่อม" needs an earlier counted word to connect to, so it is not offered for
 * the first word of a round.
 */
export function judgeReasonsAt(state: GameState, index = state.results.length): JudgeReason[] {
  const hasEarlier = state.results.some((r) => r.index < index && r.status === 'counted')
  return hasEarlier ? JUDGE_REASONS : JUDGE_REASONS.filter((r) => r !== 'not-connected')
}

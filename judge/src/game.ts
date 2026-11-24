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
}

export interface WordEvent {
  type: 'word'
  playerId: string
  word: string
  syllables: string[]
  /** The judge typed the syllables instead of using the segmenter's split. */
  manual?: boolean
}

export type RoundEvent = WordEvent

export interface Round {
  players: { id: string; name: string }[]
  events: RoundEvent[]
}

export type WordStatus = 'counted' | 'duplicate' | 'speaker-out' | 'after-end'

export interface WordResult {
  /** Position of this entry in `round.events`. */
  index: number
  word: string
  syllables: string[]
  playerId: string
  manual: boolean
  status: WordStatus
  clashes: Clash[]
}

export interface WordEntry {
  word: string
  syllables: string[]
  playerId: string
  manual?: boolean
}

export interface Elimination {
  playerId: string
  word: string
  syllables: string[]
  clashes: Clash[]
  manual?: boolean
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
export function findClashes(words: WordEntry[], syllables: string[]): Clash[] {
  const firstUse = new Map<string, string>()
  for (const entry of words) {
    for (const syllable of entry.syllables) {
      if (!firstUse.has(syllable)) {
        firstUse.set(syllable, entry.word)
      }
    }
  }

  return Array.from(new Set(syllables))
    .filter((syllable) => firstUse.has(syllable))
    .map((syllable) => ({ syllable, word: firstUse.get(syllable)! }))
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
    const base = {
      index,
      word: event.word,
      syllables: event.syllables,
      playerId: event.playerId,
      manual: Boolean(event.manual),
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
      const entry: WordEntry = { word: event.word, syllables: event.syllables, playerId: speaker.id }
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
  if (!event || syllables.length === 0) {
    return round
  }
  const events = round.events.slice()
  events[index] = { ...event, syllables, manual: true }
  return { ...round, events }
}

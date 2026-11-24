// Game rules for the judge app, kept free of UI so they can be tested on their own.
//
// Feature 1 rules:
// - Players take turns in roster order, skipping players who are out.
// - A word is checked against every syllable already used in this round.
//   Repeating a syllable inside the same word is allowed (นานา).
// - A repeated syllable puts the player out straight away. Their word is not kept,
//   and the round notes who went out and why so the judge can announce it.
// - The last player left wins.

export interface Player {
  id: string
  name: string
  out: boolean
}

export interface WordEntry {
  word: string
  syllables: string[]
  playerId: string
}

export interface Clash {
  syllable: string
  /** The earlier word that already used this syllable. */
  word: string
}

export interface Elimination {
  playerId: string
  word: string
  syllables: string[]
  clashes: Clash[]
}

export interface GameState {
  players: Player[]
  /** Index in `players` of the player whose turn it is. */
  turn: number
  /** Words accepted this round, oldest first. */
  words: WordEntry[]
  /** The most recent player out and why; cleared when the next word is accepted. */
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

export function startGame(names: string[]): GameState {
  return {
    players: names.map((name, index) => ({ id: `p${index + 1}`, name, out: false })),
    turn: 0,
    words: [],
    lastElimination: null,
    winnerId: null,
  }
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.turn]
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

export function nextPlayer(state: GameState): Player {
  return state.players[nextActiveIndex(state.players, state.turn)]
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

function acceptWord(state: GameState, word: string, syllables: string[]): GameState {
  return {
    ...state,
    words: [...state.words, { word, syllables, playerId: currentPlayer(state).id }],
    turn: nextActiveIndex(state.players, state.turn),
    lastElimination: null,
  }
}

/** Submit the current player's word with the syllables from the segmenter. */
export function submitWord(state: GameState, word: string, syllables: string[]): GameState {
  const trimmed = word.trim()
  if (state.winnerId || !trimmed || syllables.length === 0) {
    return state
  }

  const clashes = findClashes(state.words, syllables)
  if (clashes.length === 0) {
    return acceptWord(state, trimmed, syllables)
  }

  const out = currentPlayer(state)
  const players = state.players.map((player) =>
    player.id === out.id ? { ...player, out: true } : player,
  )
  const remaining = players.filter((player) => !player.out)

  return {
    ...state,
    players,
    turn: nextActiveIndex(players, state.turn),
    lastElimination: { playerId: out.id, word: trimmed, syllables, clashes },
    winnerId: remaining.length === 1 ? remaining[0].id : null,
  }
}

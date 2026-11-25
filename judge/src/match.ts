// Grouping saved rounds into matches, and what a match looks like as a whole.

import { MATCH_ROUNDS, matchWinners, replay, standings, type GameState, type Standing } from './game'
import type { MatchInfo, SavedGame } from './storage'

/**
 * The match a saved round belongs to. Rounds saved before matches existed count as
 * round 1 of a match of the usual length for their mode, so they can carry on.
 */
export function matchOf(game: SavedGame): MatchInfo {
  return game.match ?? { id: game.id, round: 1, rounds: MATCH_ROUNDS[game.round.mode ?? 'normal'] }
}

export interface MatchView {
  id: string
  /** Its rounds, in round order. */
  rounds: SavedGame[]
  /** The round played last (the highest number). */
  latest: SavedGame
  latestState: GameState
  /** How many rounds the match has (the latest round's setting, which "end now" lowers). */
  length: number
  /** Every round is played and finished. */
  over: boolean
  table: Standing[]
  /** Top total(s) once over; more than one is a tie. */
  winners: string[]
}

export function viewMatch(rounds: SavedGame[]): MatchView {
  const ordered = [...rounds].sort((a, b) => matchOf(a).round - matchOf(b).round)
  const latest = ordered[ordered.length - 1]
  const info = matchOf(latest)
  const latestState = replay(latest.round)
  const states = Array.from({ length: info.rounds }, (_, i) => {
    const game = ordered.find((g) => matchOf(g).round === i + 1)
    return game ? replay(game.round) : null
  })
  const names = ordered[0].round.players.map((p) => p.name)
  const table = standings(names, states)
  const over = info.round >= info.rounds && latestState.winnerId !== null
  return {
    id: info.id,
    rounds: ordered,
    latest,
    latestState,
    length: info.rounds,
    over,
    table,
    winners: over ? matchWinners(table) : [],
  }
}

/** Every match among `games`, most recently played first. */
export function groupMatches(games: SavedGame[]): MatchView[] {
  const byId = new Map<string, SavedGame[]>()
  for (const game of games) {
    const id = matchOf(game).id
    byId.set(id, [...(byId.get(id) ?? []), game])
  }
  return [...byId.values()]
    .map(viewMatch)
    .sort(
      (a, b) =>
        Math.max(...b.rounds.map((g) => g.updatedAt)) - Math.max(...a.rounds.map((g) => g.updatedAt)),
    )
}

export interface NameSuggestions {
  /** Every name played before, most recently played first. */
  names: string[]
  /** The line-ups of recent matches (round 1's order), most recent first, no repeats. */
  groups: string[][]
}

/** Names and line-ups from earlier games, to fill in the players quickly. */
export function suggestNames(games: SavedGame[], maxGroups = 3): NameSuggestions {
  const names: string[] = []
  const groups: string[][] = []
  const seenGroups = new Set<string>()
  for (const match of groupMatches(games)) {
    const lineup = match.rounds[0].round.players.map((p) => p.name.trim()).filter(Boolean)
    for (const name of [...match.latest.round.players.map((p) => p.name.trim()), ...lineup]) {
      if (name && !names.includes(name)) names.push(name)
    }
    const key = lineup.join('\n')
    if (lineup.length >= 2 && !seenGroups.has(key) && groups.length < maxGroups) {
      seenGroups.add(key)
      groups.push(lineup)
    }
  }
  return { names, groups }
}

export const TURN_DURATION_MS = 3000

export type PlayerStatus = 'active' | 'eliminated' | 'winner'
export type GamePhase = 'setup' | 'playing' | 'finished'
export type TurnDirection = 1 | -1

export interface PlayerDraft {
  id: string
  name: string
}

export interface PlayerSeed {
  id: string
  name: string
}

export interface Player {
  id: string
  name: string
  status: PlayerStatus
  answers: string[]
  eliminatedAtRound: number | null
  eliminatedOrder: number | null
}

export interface GameState {
  phase: GamePhase
  players: Player[]
  activePlayerId: string | null
  round: number
  turnDirection: TurnDirection
  currentInput: string
  turnStartedAt: number | null
  turnDeadlineAt: number | null
  timeLeftMs: number
  isSafeToFinish: boolean
  winnerId: string | null
  isAwaitingFirstTurnStart: boolean
}

export interface LeaderboardAward {
  playerId: string
  playerName: string
  placement: number
  standingPoints: number
  winnerBonus: number
  points: number
}

export type AdvanceTurnAction =
  | { type: 'submit'; answer: string; now?: number }
  | { type: 'timeout'; now?: number }

function createId() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `draft-${Math.random().toString(16).slice(2)}-${Date.now()}`
}

function buildTurnState(now: number, durationMs: number) {
  return {
    currentInput: '',
    turnStartedAt: now,
    turnDeadlineAt: now + durationMs,
    timeLeftMs: durationMs,
    isSafeToFinish: false,
  }
}

function buildPausedTurnState(durationMs: number) {
  return {
    currentInput: '',
    turnStartedAt: null,
    turnDeadlineAt: null,
    timeLeftMs: durationMs,
    isSafeToFinish: false,
  }
}

function findNextActiveIndexInDirection(
  players: Player[],
  currentIndex: number,
  direction: TurnDirection,
) {
  for (
    let nextIndex = currentIndex + direction;
    nextIndex >= 0 && nextIndex < players.length;
    nextIndex += direction
  ) {
    if (players[nextIndex].status === 'active') {
      return nextIndex
    }
  }

  return -1
}

function findBoundaryActiveIndex(
  players: Player[],
  direction: TurnDirection,
) {
  return direction === 1
    ? findNextActiveIndexInDirection(players, -1, direction)
    : findNextActiveIndexInDirection(players, players.length, direction)
}

function getActivePlayerIdForDirection(
  players: Player[],
  direction: TurnDirection,
) {
  const boundaryIndex = findBoundaryActiveIndex(players, direction)

  if (boundaryIndex === -1) {
    return null
  }

  return players[boundaryIndex].id
}

function getNextTurn(
  players: Player[],
  currentIndex: number,
  round: number,
  turnDirection: TurnDirection,
) {
  const nextIndex = findNextActiveIndexInDirection(
    players,
    currentIndex,
    turnDirection,
  )

  if (nextIndex !== -1) {
    return {
      nextIndex,
      nextRound: round,
    }
  }

  return {
    nextIndex: findBoundaryActiveIndex(players, turnDirection),
    nextRound: round + 1,
  }
}

function markWinner(players: Player[], winnerId: string) {
  return players.map((player) =>
    player.id === winnerId ? { ...player, status: 'winner' as const } : player,
  )
}

function createPlayers(playerSeeds: PlayerSeed[]): Player[] {
  return playerSeeds.map((seed) => ({
    id: seed.id,
    name: seed.name,
    status: 'active' as const,
    answers: [],
    eliminatedAtRound: null,
    eliminatedOrder: null,
  }))
}

function getPlacementValue(player: Player) {
  if (player.status === 'winner') {
    return Number.MAX_SAFE_INTEGER
  }

  return player.eliminatedOrder ?? Number.MIN_SAFE_INTEGER
}

export function createPlayerDraft(name = ''): PlayerDraft {
  return {
    id: createId(),
    name,
  }
}

export function createInitialDrafts(count = 1) {
  return Array.from({ length: count }, () => createPlayerDraft())
}

export function createSetupState(): GameState {
  return {
    phase: 'setup',
    players: [],
    activePlayerId: null,
    round: 1,
    turnDirection: 1,
    currentInput: '',
    turnStartedAt: null,
    turnDeadlineAt: null,
    timeLeftMs: TURN_DURATION_MS,
    isSafeToFinish: false,
    winnerId: null,
    isAwaitingFirstTurnStart: false,
  }
}

export function getSetupValidation(playerDrafts: PlayerDraft[]) {
  const meaningfulNames = playerDrafts
    .map((draft) => draft.name.trim())
    .filter((name) => name.length > 0)
  const normalizedNames = meaningfulNames.map((name) => name.toLocaleLowerCase())
  const hasDuplicates =
    new Set(normalizedNames).size !== normalizedNames.length

  return {
    hasBlankNames: false,
    hasDuplicates,
    playerCount: meaningfulNames.length,
    canStart: meaningfulNames.length >= 2 && !hasDuplicates,
  }
}

export function prepareRoster(playerDrafts: PlayerDraft[]): PlayerSeed[] {
  return playerDrafts
    .map((draft) => ({
      id: draft.id,
      name: draft.name.trim(),
    }))
    .filter((draft) => draft.name.length > 0)
}

export function createGameState(
  playerSeeds: PlayerSeed[],
  now = Date.now(),
  durationMs = TURN_DURATION_MS,
  turnDirection: TurnDirection = 1,
): GameState {
  const players = createPlayers(playerSeeds)

  return {
    phase: 'playing',
    players,
    activePlayerId: getActivePlayerIdForDirection(players, turnDirection),
    round: 1,
    turnDirection,
    winnerId: null,
    isAwaitingFirstTurnStart: false,
    ...buildTurnState(now, durationMs),
  }
}

export function createConfirmedGameState(
  playerSeeds: PlayerSeed[],
  durationMs = TURN_DURATION_MS,
  turnDirection: TurnDirection = 1,
): GameState {
  const players = createPlayers(playerSeeds)

  return {
    phase: 'playing',
    players,
    activePlayerId: getActivePlayerIdForDirection(players, turnDirection),
    round: 1,
    turnDirection,
    winnerId: null,
    isAwaitingFirstTurnStart: true,
    ...buildPausedTurnState(durationMs),
  }
}

export function startActiveTurn(
  state: GameState,
  now = Date.now(),
  durationMs = TURN_DURATION_MS,
): GameState {
  if (
    state.phase !== 'playing' ||
    state.activePlayerId === null ||
    state.turnStartedAt !== null ||
    state.turnDeadlineAt !== null ||
    state.isSafeToFinish
  ) {
    return state
  }

  return {
    ...state,
    isAwaitingFirstTurnStart: false,
    ...buildTurnState(now, durationMs),
  }
}

export function applyInputChange(
  state: GameState,
  nextValue: string,
  now = Date.now(),
): GameState {
  if (
    state.phase !== 'playing' ||
    state.isAwaitingFirstTurnStart ||
    state.turnStartedAt === null
  ) {
    return state
  }

  const typedInTime =
    !state.isSafeToFinish &&
    nextValue.length > 0 &&
    state.turnDeadlineAt !== null &&
    now <= state.turnDeadlineAt

  return {
    ...state,
    currentInput: nextValue,
    isSafeToFinish: state.isSafeToFinish || typedInTime,
  }
}

export function getFinalPlacements(state: GameState) {
  if (state.phase !== 'finished' || state.winnerId === null) {
    return []
  }

  const initialOrder = new Map(
    state.players.map((player, index) => [player.id, index]),
  )

  return [...state.players].sort((left, right) => {
    const placementDifference =
      getPlacementValue(right) - getPlacementValue(left)

    if (placementDifference !== 0) {
      return placementDifference
    }

    return (initialOrder.get(left.id) ?? 0) - (initialOrder.get(right.id) ?? 0)
  })
}

export function getScoreAwards(state: GameState): LeaderboardAward[] {
  return getFinalPlacements(state)
    .slice(0, 3)
    .map((player, index) => {
      const standingPoints = 1
      const winnerBonus = index === 0 ? 2 : 0

      return {
        playerId: player.id,
        playerName: player.name,
        placement: index + 1,
        standingPoints,
        winnerBonus,
        points: standingPoints + winnerBonus,
      }
    })
}

export function applyScoreAwards(
  scoreByPlayerId: Record<string, number>,
  awards: LeaderboardAward[],
) {
  if (awards.length === 0) {
    return scoreByPlayerId
  }

  return awards.reduce<Record<string, number>>(
    (nextScores, award) => ({
      ...nextScores,
      [award.playerId]: (nextScores[award.playerId] ?? 0) + award.points,
    }),
    { ...scoreByPlayerId },
  )
}

export function advanceTurn(
  state: GameState,
  action: AdvanceTurnAction,
  durationMs = TURN_DURATION_MS,
): GameState {
  if (
    state.phase !== 'playing' ||
    state.activePlayerId === null ||
    state.isAwaitingFirstTurnStart
  ) {
    return state
  }

  const now = action.now ?? Date.now()
  const currentIndex = state.players.findIndex(
    (player) => player.id === state.activePlayerId,
  )

  if (currentIndex === -1 || state.players[currentIndex].status !== 'active') {
    return state
  }

  if (action.type === 'timeout' && state.isSafeToFinish) {
    return state
  }

  let nextPlayers = state.players
  let shouldPauseNextTurn = false
  const nextEliminatedOrder =
    state.players.filter((player) => player.status === 'eliminated').length + 1

  if (action.type === 'submit') {
    const answer = action.answer.trim()
    const lateSubmit =
      !state.isSafeToFinish &&
      state.turnDeadlineAt !== null &&
      now > state.turnDeadlineAt

    if (!answer) {
      return state
    }

    if (lateSubmit) {
      shouldPauseNextTurn = true
      nextPlayers = state.players.map((player, index) =>
        index === currentIndex
          ? {
              ...player,
              status: 'eliminated' as const,
              eliminatedAtRound: state.round,
              eliminatedOrder: nextEliminatedOrder,
            }
          : player,
      )
    } else {
      nextPlayers = state.players.map((player, index) =>
        index === currentIndex
          ? {
              ...player,
              answers: [...player.answers, answer],
            }
          : player,
      )
    }
  } else {
    shouldPauseNextTurn = true
    nextPlayers = state.players.map((player, index) =>
      index === currentIndex
        ? {
            ...player,
            status: 'eliminated' as const,
            eliminatedAtRound: state.round,
            eliminatedOrder: nextEliminatedOrder,
          }
        : player,
    )
  }

  const activePlayers = nextPlayers.filter((player) => player.status === 'active')

  if (activePlayers.length === 1) {
    const winnerId = activePlayers[0].id

    return {
      ...state,
      phase: 'finished',
      players: markWinner(nextPlayers, winnerId),
      activePlayerId: winnerId,
      currentInput: '',
      turnStartedAt: null,
      turnDeadlineAt: null,
      timeLeftMs: 0,
      isSafeToFinish: false,
      winnerId,
      isAwaitingFirstTurnStart: false,
    }
  }

  const { nextIndex, nextRound } = getNextTurn(
    nextPlayers,
    currentIndex,
    state.round,
    state.turnDirection,
  )

  if (nextIndex === -1) {
    return createSetupState()
  }

  return {
    ...state,
    players: nextPlayers,
    activePlayerId: nextPlayers[nextIndex].id,
    round: nextRound,
    winnerId: null,
    isAwaitingFirstTurnStart: false,
    ...(shouldPauseNextTurn
      ? buildPausedTurnState(durationMs)
      : buildTurnState(now, durationMs)),
  }
}

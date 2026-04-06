export const TURN_DURATION_MS = 3000
export const CHALLENGE_DEBATE_SEGMENT_DURATION_MS = 15000
export const CHALLENGE_DEBATE_SEGMENT_COUNT = 4
const CHALLENGE_BONUS_POINTS = 2

export type PlayerStatus = 'active' | 'eliminated' | 'winner'
export type GamePhase = 'setup' | 'playing' | 'finished'
export type TurnDirection = 1 | -1
export type ChallengeStatus = 'idle' | 'selecting' | 'debating' | 'judging'
export type ChallengeSpeaker = 'challenger' | 'challenged'
export type ChallengeDecision = 'connects' | 'not_connects'
export type EliminationReason =
  | 'timeout'
  | 'late_submit'
  | 'duplicate_syllable'
  | 'failed_challenge'
  | 'invalid_connection'

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
  eliminatedAtTurnCycle: number | null
  eliminatedOrder: number | null
  eliminationReason: EliminationReason | null
  duplicateSyllable: string | null
  duplicateSourceAnswer: string | null
  duplicateSubmittedAnswer: string | null
  challengeSourceAnswer: string | null
  challengeTargetAnswer: string | null
}

interface UsedSyllableEntry {
  syllable: string
  answer: string
}

export interface AnswerRecord {
  id: string
  playerId: string
  answer: string
  syllables: string[]
  previousValidAnswerId: string | null
  invalidatedByChallenge: boolean
  challengeResolved: boolean
}

export interface ChallengeState {
  status: ChallengeStatus
  challengerPlayerId: string | null
  challengedAnswerId: string | null
  challengedPlayerId: string | null
  previousValidAnswerId: string | null
  currentSpeaker: ChallengeSpeaker | null
  segmentIndex: number
  segmentStartedAt: number | null
  segmentDeadlineAt: number | null
  timeLeftMs: number
  segmentAwaitingContinue: boolean
  awaitingChallengeStart: boolean
}

export interface GameState {
  phase: GamePhase
  players: Player[]
  activePlayerId: string | null
  turnCycle: number
  turnDirection: TurnDirection
  currentInput: string
  turnStartedAt: number | null
  turnDeadlineAt: number | null
  timeLeftMs: number
  isSafeToFinish: boolean
  winnerId: string | null
  isAwaitingFirstTurnStart: boolean
  isAwaitingRoundSummary: boolean
  usedSyllablesInRound: string[]
  usedSyllableEntriesInRound: UsedSyllableEntry[]
  answerHistory: AnswerRecord[]
  challenge: ChallengeState
  challengeBonusPointsByPlayerId: Record<string, number>
  isEliminationPause: boolean
}

export interface LeaderboardAward {
  playerId: string
  playerName: string
  placement: number | null
  standingPoints: number
  winnerBonus: number
  challengeBonus: number
  points: number
}

export type AdvanceTurnAction =
  | { type: 'submit'; answer: string; syllables?: string[]; now?: number }
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

function createIdleChallengeState(): ChallengeState {
  return {
    status: 'idle',
    challengerPlayerId: null,
    challengedAnswerId: null,
    challengedPlayerId: null,
    previousValidAnswerId: null,
    currentSpeaker: null,
    segmentIndex: 0,
    segmentStartedAt: null,
    segmentDeadlineAt: null,
    timeLeftMs: CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
    segmentAwaitingContinue: false,
    awaitingChallengeStart: false,
  }
}

function normalizeProvidedSyllables(syllables: string[] | undefined) {
  if (!syllables) {
    return null
  }

  return syllables
    .map((syllable) => syllable.trim())
    .filter((syllable) => syllable.length > 0)
}

function findDuplicateSyllableEntry(
  usedSyllableEntriesInRound: UsedSyllableEntry[],
  nextSyllables: string[],
) {
  const seenSyllables = new Map(
    usedSyllableEntriesInRound.map((entry) => [entry.syllable, entry]),
  )

  for (const syllable of nextSyllables) {
    const matchedEntry = seenSyllables.get(syllable)

    if (matchedEntry) {
      return matchedEntry
    }

    seenSyllables.set(syllable, {
      syllable,
      answer: '',
    })
  }

  return null
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
  turnCycle: number,
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
      nextTurnCycle: turnCycle,
    }
  }

  return {
    nextIndex: findBoundaryActiveIndex(players, turnDirection),
    nextTurnCycle: turnCycle + 1,
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
    eliminatedAtTurnCycle: null,
    eliminatedOrder: null,
    eliminationReason: null,
    duplicateSyllable: null,
    duplicateSourceAnswer: null,
    duplicateSubmittedAnswer: null,
    challengeSourceAnswer: null,
    challengeTargetAnswer: null,
  }))
}

function getPlacementValue(player: Player) {
  if (player.status === 'winner') {
    return Number.MAX_SAFE_INTEGER
  }

  return player.eliminatedOrder ?? Number.MIN_SAFE_INTEGER
}

function getValidAnswerHistory(answerHistory: AnswerRecord[]) {
  return answerHistory.filter((record) => !record.invalidatedByChallenge)
}

function getAnswerRecordById(
  answerHistory: AnswerRecord[],
  answerId: string | null,
) {
  if (!answerId) {
    return null
  }

  return answerHistory.find((record) => record.id === answerId) ?? null
}

function buildUsedSyllableStateFromAnswerHistory(answerHistory: AnswerRecord[]) {
  const entries = getValidAnswerHistory(answerHistory).flatMap((record) =>
    record.syllables.map((syllable) => ({
      syllable,
      answer: record.answer,
    })),
  )

  return {
    usedSyllablesInRound: entries.map((entry) => entry.syllable),
    usedSyllableEntriesInRound: entries,
  }
}

function getChallengeSpeakerForSegmentIndex(
  segmentIndex: number,
): ChallengeSpeaker {
  return segmentIndex % 2 === 0 ? 'challenger' : 'challenged'
}

function buildDebatingChallengeState(
  challenge: ChallengeState,
  now: number,
  durationMs: number,
  segmentIndex: number,
  awaitingContinue: boolean = false,
): ChallengeState {
  return {
    ...challenge,
    status: 'debating',
    currentSpeaker: getChallengeSpeakerForSegmentIndex(segmentIndex),
    segmentIndex,
    segmentStartedAt: awaitingContinue ? null : now,
    segmentDeadlineAt: awaitingContinue ? null : now + durationMs,
    timeLeftMs: durationMs,
    segmentAwaitingContinue: awaitingContinue,
    awaitingChallengeStart: false,
  }
}

function buildJudgingChallengeState(challenge: ChallengeState): ChallengeState {
  return {
    ...challenge,
    status: 'judging',
    currentSpeaker: null,
    segmentStartedAt: null,
    segmentDeadlineAt: null,
    timeLeftMs: 0,
    segmentAwaitingContinue: false,
    awaitingChallengeStart: false,
  }
}

function getNextEliminatedOrder(players: Player[]) {
  return players.filter((player) => player.status === 'eliminated').length + 1
}

function getNextTurnAfterPlayer(
  players: Player[],
  currentPlayerId: string,
  turnCycle: number,
  turnDirection: TurnDirection,
) {
  const currentIndex = players.findIndex((player) => player.id === currentPlayerId)

  if (currentIndex === -1) {
    return {
      nextIndex: -1,
      nextTurnCycle: turnCycle,
    }
  }

  return getNextTurn(players, currentIndex, turnCycle, turnDirection)
}

function finalizePlayingState(
  state: GameState,
  {
    nextPlayers,
    currentPlayerIdForNextTurn,
    nextAnswerHistory,
    nextChallengeBonusPointsByPlayerId,
    nextUsedSyllablesInRound,
    nextUsedSyllableEntriesInRound,
    shouldPauseNextTurn,
    now,
  }: {
    nextPlayers: Player[]
    currentPlayerIdForNextTurn: string
    nextAnswerHistory: AnswerRecord[]
    nextChallengeBonusPointsByPlayerId: Record<string, number>
    nextUsedSyllablesInRound: string[]
    nextUsedSyllableEntriesInRound: UsedSyllableEntry[]
    shouldPauseNextTurn: boolean
    now: number
  },
  durationMs = TURN_DURATION_MS,
): GameState {
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
      isAwaitingRoundSummary: true,
      usedSyllablesInRound: nextUsedSyllablesInRound,
      usedSyllableEntriesInRound: nextUsedSyllableEntriesInRound,
      answerHistory: nextAnswerHistory,
      challenge: createIdleChallengeState(),
      challengeBonusPointsByPlayerId: nextChallengeBonusPointsByPlayerId,
    }
  }

  const { nextIndex, nextTurnCycle } = getNextTurnAfterPlayer(
    nextPlayers,
    currentPlayerIdForNextTurn,
    state.turnCycle,
    state.turnDirection,
  )

  if (nextIndex === -1) {
    return createSetupState()
  }

  return {
    ...state,
    players: nextPlayers,
    activePlayerId: nextPlayers[nextIndex].id,
    turnCycle: nextTurnCycle,
    winnerId: null,
    isAwaitingFirstTurnStart: false,
    isAwaitingRoundSummary: false,
    usedSyllablesInRound: nextUsedSyllablesInRound,
    usedSyllableEntriesInRound: nextUsedSyllableEntriesInRound,
    answerHistory: nextAnswerHistory,
    challenge: createIdleChallengeState(),
    challengeBonusPointsByPlayerId: nextChallengeBonusPointsByPlayerId,
    ...(shouldPauseNextTurn
      ? buildPausedTurnState(durationMs)
      : buildTurnState(now, durationMs)),
    isEliminationPause: shouldPauseNextTurn,
  }
}

function createAnswerRecord(
  playerId: string,
  answer: string,
  syllables: string[],
  previousValidAnswerId: string | null,
): AnswerRecord {
  return {
    id: createId(),
    playerId,
    answer,
    syllables,
    previousValidAnswerId,
    invalidatedByChallenge: false,
    challengeResolved: false,
  }
}

function markChallengeResolved(
  answerHistory: AnswerRecord[],
  challengedAnswerId: string,
) {
  return answerHistory.map((record) =>
    record.id === challengedAnswerId
      ? {
          ...record,
          challengeResolved: true,
        }
      : record,
  )
}

function invalidateAnswerHistoryFrom(
  answerHistory: AnswerRecord[],
  challengedAnswerId: string,
) {
  let shouldInvalidate = false

  return answerHistory.map((record) => {
    if (record.id === challengedAnswerId) {
      shouldInvalidate = true
    }

    if (!shouldInvalidate) {
      return record
    }

    return {
      ...record,
      invalidatedByChallenge: true,
      challengeResolved:
        record.id === challengedAnswerId ? true : record.challengeResolved,
    }
  })
}

function buildChallengeSelectionState(
  currentChallenge: ChallengeState,
  answerHistory: AnswerRecord[],
  players: Player[],
  challengerPlayerId: string | null,
  challengedAnswerId: string | null,
): ChallengeState {
  const activePlayerIds = new Set(
    players
      .filter((player) => player.status === 'active')
      .map((player) => player.id),
  )
  const challengeableAnswerIds = new Set(
    getChallengeableAnswers({
      phase: 'playing',
      players,
      activePlayerId: null,
      turnCycle: 1,
      turnDirection: 1,
      currentInput: '',
      turnStartedAt: null,
      turnDeadlineAt: null,
      timeLeftMs: TURN_DURATION_MS,
      isSafeToFinish: false,
      winnerId: null,
      isAwaitingFirstTurnStart: false,
      isAwaitingRoundSummary: false,
      usedSyllablesInRound: [],
      usedSyllableEntriesInRound: [],
      answerHistory,
      challenge: createIdleChallengeState(),
      challengeBonusPointsByPlayerId: {},
      isEliminationPause: false,
    }).map((answerRecord) => answerRecord.id),
  )

  const nextChallengedAnswerId =
    challengedAnswerId && challengeableAnswerIds.has(challengedAnswerId)
      ? challengedAnswerId
      : null
  const challengedAnswerRecord = getAnswerRecordById(
    answerHistory,
    nextChallengedAnswerId,
  )
  const nextChallengedPlayerId = challengedAnswerRecord?.playerId ?? null
  const nextPreviousValidAnswerId =
    challengedAnswerRecord?.previousValidAnswerId ?? null

  const nextChallengerPlayerId =
    challengerPlayerId &&
    activePlayerIds.has(challengerPlayerId) &&
    challengerPlayerId !== nextChallengedPlayerId
      ? challengerPlayerId
      : null

  return {
    ...currentChallenge,
    status: 'selecting',
    challengerPlayerId: nextChallengerPlayerId,
    challengedAnswerId: nextChallengedAnswerId,
    challengedPlayerId: nextChallengedPlayerId,
    previousValidAnswerId: nextPreviousValidAnswerId,
    currentSpeaker: null,
    segmentIndex: 0,
    segmentStartedAt: null,
    segmentDeadlineAt: null,
    timeLeftMs: CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
  }
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
    turnCycle: 1,
    turnDirection: 1,
    currentInput: '',
    turnStartedAt: null,
    turnDeadlineAt: null,
    timeLeftMs: TURN_DURATION_MS,
    isSafeToFinish: false,
    winnerId: null,
    isAwaitingFirstTurnStart: false,
    isAwaitingRoundSummary: false,
    usedSyllablesInRound: [],
    usedSyllableEntriesInRound: [],
    answerHistory: [],
    challenge: createIdleChallengeState(),
    challengeBonusPointsByPlayerId: {},
    isEliminationPause: false,
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
    turnCycle: 1,
    turnDirection,
    winnerId: null,
    isAwaitingFirstTurnStart: false,
    isAwaitingRoundSummary: false,
    usedSyllablesInRound: [],
    usedSyllableEntriesInRound: [],
    answerHistory: [],
    challenge: createIdleChallengeState(),
    challengeBonusPointsByPlayerId: {},
    isEliminationPause: false,
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
    turnCycle: 1,
    turnDirection,
    winnerId: null,
    isAwaitingFirstTurnStart: true,
    isAwaitingRoundSummary: false,
    usedSyllablesInRound: [],
    usedSyllableEntriesInRound: [],
    answerHistory: [],
    challenge: createIdleChallengeState(),
    challengeBonusPointsByPlayerId: {},
    isEliminationPause: false,
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
    state.isSafeToFinish ||
    state.challenge.status !== 'idle'
  ) {
    return state
  }

  return {
    ...state,
    isAwaitingFirstTurnStart: false,
    isEliminationPause: false,
    ...buildTurnState(now, durationMs),
  }
}

export function acknowledgeRoundSummary(state: GameState): GameState {
  if (state.phase !== 'finished' || !state.isAwaitingRoundSummary) {
    return state
  }

  return {
    ...state,
    isAwaitingRoundSummary: false,
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
    state.turnStartedAt === null ||
    state.challenge.status !== 'idle'
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
  const placementAwards = getFinalPlacements(state)
    .slice(0, 3)
    .map((player, index) => ({
      playerId: player.id,
      playerName: player.name,
      placement: index + 1,
      standingPoints: 1,
      winnerBonus: index === 0 ? 2 : 0,
      challengeBonus: state.challengeBonusPointsByPlayerId[player.id] ?? 0,
    }))

  const bonusOnlyAwards = state.players
    .filter(
      (player) =>
        !placementAwards.some((award) => award.playerId === player.id) &&
        (state.challengeBonusPointsByPlayerId[player.id] ?? 0) > 0,
    )
    .map((player) => ({
      playerId: player.id,
      playerName: player.name,
      placement: null,
      standingPoints: 0,
      winnerBonus: 0,
      challengeBonus: state.challengeBonusPointsByPlayerId[player.id] ?? 0,
    }))

  return [...placementAwards, ...bonusOnlyAwards].map((award) => ({
    ...award,
    points:
      award.standingPoints + award.winnerBonus + award.challengeBonus,
  }))
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

export function getChallengeableAnswers(state: GameState) {
  if (state.phase !== 'playing') {
    return []
  }

  const activePlayerIds = new Set(
    state.players
      .filter((player) => player.status === 'active')
      .map((player) => player.id),
  )

  return getValidAnswerHistory(state.answerHistory)
    .filter(
      (record) =>
        record.previousValidAnswerId !== null &&
        !record.challengeResolved &&
        activePlayerIds.has(record.playerId),
    )
    .slice(-3)
    .reverse()
}

export function beginChallengeSelection(
  state: GameState,
  durationMs = TURN_DURATION_MS,
): GameState {
  const challengeableAnswers = getChallengeableAnswers(state)

  if (
    state.phase !== 'playing' ||
    state.activePlayerId === null ||
    state.challenge.status !== 'idle' ||
    state.players.filter((player) => player.status === 'active').length < 2 ||
    challengeableAnswers.length === 0
  ) {
    return state
  }

  return {
    ...state,
    challenge: buildChallengeSelectionState(
      createIdleChallengeState(),
      state.answerHistory,
      state.players,
      null,
      challengeableAnswers[0]?.id ?? null,
    ),
    isEliminationPause: false,
    ...buildPausedTurnState(durationMs),
  }
}

export function cancelChallenge(
  state: GameState,
  durationMs = TURN_DURATION_MS,
): GameState {
  if (state.phase !== 'playing' || state.challenge.status !== 'selecting') {
    return state
  }

  return {
    ...state,
    challenge: createIdleChallengeState(),
    ...buildPausedTurnState(durationMs),
  }
}

export function updateChallengeSelection(
  state: GameState,
  selection: {
    challengerPlayerId?: string | null
    challengedAnswerId?: string | null
  },
) {
  if (state.phase !== 'playing' || state.challenge.status !== 'selecting') {
    return state
  }

  const nextChallenge = buildChallengeSelectionState(
    state.challenge,
    state.answerHistory,
    state.players,
    selection.challengerPlayerId ?? state.challenge.challengerPlayerId,
    selection.challengedAnswerId ?? state.challenge.challengedAnswerId,
  )

  return {
    ...state,
    challenge: nextChallenge,
  }
}

export function confirmChallengeDebate(state: GameState) {
  if (
    state.phase !== 'playing' ||
    state.challenge.status !== 'selecting' ||
    !state.challenge.challengerPlayerId ||
    !state.challenge.challengedAnswerId ||
    !state.challenge.challengedPlayerId ||
    !state.challenge.previousValidAnswerId
  ) {
    return state
  }

  return {
    ...state,
    challenge: buildDebatingChallengeState(state.challenge, 0, CHALLENGE_DEBATE_SEGMENT_DURATION_MS, 0, true),
  }
}

export function startChallengeDebate(
  state: GameState,
  now = Date.now(),
  durationMs = CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
) {
  if (state.phase !== 'playing' || state.challenge.status !== 'selecting') {
    return state
  }

  if (
    !state.challenge.challengerPlayerId ||
    !state.challenge.challengedAnswerId ||
    !state.challenge.challengedPlayerId ||
    !state.challenge.previousValidAnswerId
  ) {
    return state
  }

  if (!state.challenge.awaitingChallengeStart) {
    return state
  }

  return {
    ...state,
    challenge: {
      ...state.challenge,
      awaitingChallengeStart: false,
      segmentAwaitingContinue: false,
      segmentStartedAt: now,
      segmentDeadlineAt: now + durationMs,
      timeLeftMs: durationMs,
    },
  }
}

export function tickChallengeDebate(
  state: GameState,
  timeLeftMs: number,
  startedAt: number,
) {
  if (
    state.phase !== 'playing' ||
    state.challenge.status !== 'debating' ||
    state.challenge.segmentStartedAt !== startedAt
  ) {
    return state
  }

  return {
    ...state,
    challenge: {
      ...state.challenge,
      timeLeftMs,
    },
  }
}

export function advanceChallengeDebate(
  state: GameState,
  startedAt: number,
  now = Date.now(),
  durationMs = CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
) {
  if (
    state.phase !== 'playing' ||
    state.challenge.status !== 'debating' ||
    state.challenge.segmentStartedAt !== startedAt
  ) {
    return state
  }

  const nextSegmentIndex = state.challenge.segmentIndex + 1

  if (nextSegmentIndex >= CHALLENGE_DEBATE_SEGMENT_COUNT) {
    return {
      ...state,
      challenge: buildJudgingChallengeState(state.challenge),
    }
  }

  const shouldAwaitContinue = nextSegmentIndex > 0

  return {
    ...state,
    challenge: buildDebatingChallengeState(
      state.challenge,
      now,
      durationMs,
      nextSegmentIndex,
      shouldAwaitContinue,
    ),
  }
}

export function resumeChallengeDebate(
  state: GameState,
  now = Date.now(),
  durationMs = CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
) {
  if (
    state.phase !== 'playing' ||
    state.challenge.status !== 'debating' ||
    !state.challenge.segmentAwaitingContinue
  ) {
    return state
  }

  return {
    ...state,
    challenge: {
      ...state.challenge,
      segmentAwaitingContinue: false,
      segmentStartedAt: now,
      segmentDeadlineAt: now + durationMs,
      timeLeftMs: durationMs,
    },
  }
}

export function resolveChallenge(
  state: GameState,
  decision: ChallengeDecision,
  now = Date.now(),
  durationMs = TURN_DURATION_MS,
): GameState {
  if (state.phase !== 'playing' || state.challenge.status !== 'judging') {
    return state
  }

  const challengedAnswer = getAnswerRecordById(
    state.answerHistory,
    state.challenge.challengedAnswerId,
  )
  const previousValidAnswer = getAnswerRecordById(
    state.answerHistory,
    state.challenge.previousValidAnswerId,
  )
  const challengerPlayerId = state.challenge.challengerPlayerId
  const challengedPlayerId = state.challenge.challengedPlayerId

  if (
    !challengedAnswer ||
    !previousValidAnswer ||
    !challengerPlayerId ||
    !challengedPlayerId
  ) {
    return state
  }

  const eliminatedPlayerId =
    decision === 'not_connects' ? challengedPlayerId : challengerPlayerId
  const eliminatedOrder = getNextEliminatedOrder(state.players)

  const nextPlayers = state.players.map((player) => {
    if (player.id !== eliminatedPlayerId) {
      return player
    }

    return {
      ...player,
      status: 'eliminated' as const,
      eliminatedAtTurnCycle: state.turnCycle,
      eliminatedOrder,
      eliminationReason:
        decision === 'not_connects'
          ? ('invalid_connection' as const)
          : ('failed_challenge' as const),
      duplicateSyllable: null,
      duplicateSourceAnswer: null,
      duplicateSubmittedAnswer: null,
      challengeSourceAnswer: previousValidAnswer.answer,
      challengeTargetAnswer: challengedAnswer.answer,
    }
  })

  const nextAnswerHistory =
    decision === 'not_connects'
      ? invalidateAnswerHistoryFrom(state.answerHistory, challengedAnswer.id)
      : markChallengeResolved(state.answerHistory, challengedAnswer.id)
  const nextUsedSyllableState =
    decision === 'not_connects'
      ? buildUsedSyllableStateFromAnswerHistory(nextAnswerHistory)
      : {
          usedSyllablesInRound: state.usedSyllablesInRound,
          usedSyllableEntriesInRound: state.usedSyllableEntriesInRound,
        }
  const nextChallengeBonusPointsByPlayerId =
    decision === 'not_connects'
      ? {
          ...state.challengeBonusPointsByPlayerId,
          [challengerPlayerId]:
            (state.challengeBonusPointsByPlayerId[challengerPlayerId] ?? 0) +
            CHALLENGE_BONUS_POINTS,
        }
      : state.challengeBonusPointsByPlayerId

  return finalizePlayingState(
    state,
    {
      nextPlayers,
      currentPlayerIdForNextTurn: eliminatedPlayerId,
      nextAnswerHistory,
      nextChallengeBonusPointsByPlayerId,
      nextUsedSyllablesInRound: nextUsedSyllableState.usedSyllablesInRound,
      nextUsedSyllableEntriesInRound:
        nextUsedSyllableState.usedSyllableEntriesInRound,
      shouldPauseNextTurn: true,
      now,
    },
    durationMs,
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
    state.isAwaitingFirstTurnStart ||
    state.challenge.status !== 'idle'
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
  let nextAnswerHistory = state.answerHistory
  let shouldPauseNextTurn = false
  let nextUsedSyllablesInRound = state.usedSyllablesInRound
  let nextUsedSyllableEntriesInRound = state.usedSyllableEntriesInRound
  const nextEliminatedOrder = getNextEliminatedOrder(state.players)

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
              eliminatedAtTurnCycle: state.turnCycle,
              eliminatedOrder: nextEliminatedOrder,
              eliminationReason: 'late_submit' as const,
              duplicateSyllable: null,
              duplicateSourceAnswer: null,
              duplicateSubmittedAnswer: null,
              challengeSourceAnswer: null,
              challengeTargetAnswer: null,
            }
          : player,
      )
    } else {
      const nextSyllables = normalizeProvidedSyllables(action.syllables)

      if (!nextSyllables || nextSyllables.length === 0) {
        return state
      }

      const duplicateSyllableEntry = findDuplicateSyllableEntry(
        state.usedSyllableEntriesInRound,
        nextSyllables,
      )

      if (duplicateSyllableEntry !== null) {
        shouldPauseNextTurn = true
        nextPlayers = state.players.map((player, index) =>
          index === currentIndex
            ? {
                ...player,
                status: 'eliminated' as const,
                eliminatedAtTurnCycle: state.turnCycle,
                eliminatedOrder: nextEliminatedOrder,
                eliminationReason: 'duplicate_syllable' as const,
                duplicateSyllable: duplicateSyllableEntry.syllable,
                duplicateSourceAnswer: duplicateSyllableEntry.answer,
                duplicateSubmittedAnswer: answer,
                challengeSourceAnswer: null,
                challengeTargetAnswer: null,
              }
            : player,
        )
      } else {
        nextUsedSyllablesInRound = [
          ...state.usedSyllablesInRound,
          ...nextSyllables,
        ]
        nextUsedSyllableEntriesInRound = [
          ...state.usedSyllableEntriesInRound,
          ...nextSyllables.map((syllable) => ({
            syllable,
            answer,
          })),
        ]
        nextPlayers = state.players.map((player, index) =>
          index === currentIndex
            ? {
                ...player,
                answers: [...player.answers, answer],
              }
            : player,
        )
        nextAnswerHistory = [
          ...state.answerHistory,
          createAnswerRecord(
            state.activePlayerId,
            answer,
            nextSyllables,
            getValidAnswerHistory(state.answerHistory).at(-1)?.id ?? null,
          ),
        ]
      }
    }
  } else {
    shouldPauseNextTurn = true
    nextPlayers = state.players.map((player, index) =>
      index === currentIndex
        ? {
            ...player,
            status: 'eliminated' as const,
            eliminatedAtTurnCycle: state.turnCycle,
            eliminatedOrder: nextEliminatedOrder,
            eliminationReason: 'timeout' as const,
            duplicateSyllable: null,
            duplicateSourceAnswer: null,
            duplicateSubmittedAnswer: null,
            challengeSourceAnswer: null,
            challengeTargetAnswer: null,
          }
        : player,
    )
  }

  return finalizePlayingState(
    state,
    {
      nextPlayers,
      currentPlayerIdForNextTurn: state.activePlayerId,
      nextAnswerHistory,
      nextChallengeBonusPointsByPlayerId: state.challengeBonusPointsByPlayerId,
      nextUsedSyllablesInRound,
      nextUsedSyllableEntriesInRound,
      shouldPauseNextTurn,
      now,
    },
    durationMs,
  )
}

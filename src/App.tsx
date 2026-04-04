import {
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import './App.css'
import {
  acknowledgeRoundSummary,
  TURN_DURATION_MS,
  applyScoreAwards,
  advanceTurn,
  applyInputChange,
  createConfirmedGameState,
  createInitialDrafts,
  createPlayerDraft,
  createSetupState,
  getScoreAwards,
  getSetupValidation,
  prepareRoster,
  startActiveTurn,
  type GameState,
  type PlayerDraft,
  type TurnDirection,
} from './game'
import {
  DEFAULT_SYLLABLE_ENGINE,
  SyllableSegmentationError,
  type SyllableSegmentationResponse,
  segmentThaiText,
} from './syllableClient'
import { useTurnTimer } from './useTurnTimer'

const MATCH_ROUNDS_PER_MATCH = 4
const SYLLABLE_REQUEST_DEBOUNCE_MS = 250

function getTurnDirectionForMatchRound(matchRound: number): TurnDirection {
  return matchRound % 2 === 1 ? 1 : -1
}

function formatSeconds(timeLeftMs: number) {
  return (timeLeftMs / 1000).toFixed(1)
}

function getSetupMessage(
  validation: ReturnType<typeof getSetupValidation>,
) {
  if (validation.playerCount < 2) {
    return 'ต้องมีผู้เล่นอย่างน้อย 2 คน'
  }

  if (validation.hasDuplicates) {
    return 'ชื่อผู้เล่นห้ามซ้ำหลังตัดช่องว่างหน้า-ท้าย'
  }

  return `พร้อมยืนยันผู้เล่น ${validation.playerCount} คน`
}

function getEliminatedPlayerSummary(
  player: GameState['players'][number] | null,
) {
  if (!player) {
    return 'มีผู้เล่นตกรอบในรอบนี้'
  }

  if (player.eliminationReason === 'duplicate_syllable') {
    if (player.duplicateSubmittedAnswer && player.duplicateSourceAnswer) {
      return `${player.name} ตกรอบเพราะคำตอบ "${player.duplicateSubmittedAnswer}" ซ้ำกับคำ "${player.duplicateSourceAnswer}"`
    }

    if (player.duplicateSourceAnswer) {
      return `${player.name} ตกรอบเพราะซ้ำกับคำ "${player.duplicateSourceAnswer}"`
    }

    return `${player.name} ตกรอบเพราะใช้พยางค์ซ้ำ`
  }

  if (player.eliminationReason === 'late_submit') {
    return `${player.name} ตกรอบเพราะส่งคำช้าเกินเวลา`
  }

  if (player.eliminationReason === 'timeout') {
    return `${player.name} ตกรอบเพราะไม่ทันเวลา`
  }

  return `${player.name} ตกรอบ`
}

function getPausedTurnReasonText(
  player: GameState['players'][number] | null,
) {
  return getEliminatedPlayerSummary(player)
}

function getPausedTurnInstructions(
  player: GameState['players'][number] | null,
  activePlayerName: string,
) {
  return `ยังไม่เริ่มจับเวลา ${getPausedTurnReasonText(
    player,
  )} กดเริ่มเพื่อเริ่มจับเวลาของ ${activePlayerName}`
}

function getDuplicateSyllableDetails(
  player: GameState['players'][number] | null,
) {
  if (
    !player ||
    player.eliminationReason !== 'duplicate_syllable' ||
    !player.duplicateSyllable ||
    !player.duplicateSourceAnswer ||
    !player.duplicateSubmittedAnswer
  ) {
    return null
  }

  return {
    duplicateSyllable: player.duplicateSyllable,
    sourceAnswer: player.duplicateSourceAnswer,
    submittedAnswer: player.duplicateSubmittedAnswer,
  }
}

function renderHighlightedAnswer(answer: string, syllable: string) {
  if (!syllable || !answer.includes(syllable)) {
    return <span className="duplicate-answer-text">{answer}</span>
  }

  const parts: ReactNode[] = []
  const segments = answer.split(syllable)

  segments.forEach((segment, index) => {
    if (segment) {
      parts.push(<span key={`segment-${index}`}>{segment}</span>)
    }

    if (index < segments.length - 1) {
      parts.push(
        <mark className="duplicate-syllable-mark" key={`match-${index}`}>
          {syllable}
        </mark>,
      )
    }
  })

  return <span className="duplicate-answer-text">{parts}</span>
}

function renderEliminatedPlayerSummaryContent(
  player: GameState['players'][number] | null,
) {
  const duplicateDetails = getDuplicateSyllableDetails(player)

  if (player && duplicateDetails) {
    return (
      <>
        <span>{player.name} ตกรอบเพราะคำตอบ "</span>
        {renderHighlightedAnswer(
          duplicateDetails.submittedAnswer,
          duplicateDetails.duplicateSyllable,
        )}
        <span>" ซ้ำกับคำ "</span>
        {renderHighlightedAnswer(
          duplicateDetails.sourceAnswer,
          duplicateDetails.duplicateSyllable,
        )}
        <span>"</span>
      </>
    )
  }

  return getEliminatedPlayerSummary(player)
}

function getSegmentationCacheKey(text: string) {
  return `${DEFAULT_SYLLABLE_ENGINE}::${text.trim()}`
}

function getSegmentationErrorMessage(error: unknown) {
  if (error instanceof SyllableSegmentationError) {
    return error.message
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'ไม่สามารถเชื่อมต่อระบบแยกพยางค์ได้'
}

function isBlankDraft(draft: PlayerDraft) {
  return draft.name.trim().length === 0
}

function ensureTrailingBlankDraft(playerDrafts: PlayerDraft[]) {
  if (playerDrafts.length === 0) {
    return [createPlayerDraft()]
  }

  const nextDrafts = [...playerDrafts]

  while (
    nextDrafts.length > 1 &&
    isBlankDraft(nextDrafts[nextDrafts.length - 1]) &&
    isBlankDraft(nextDrafts[nextDrafts.length - 2])
  ) {
    nextDrafts.pop()
  }

  if (!isBlankDraft(nextDrafts[nextDrafts.length - 1])) {
    nextDrafts.push(createPlayerDraft())
  }

  return nextDrafts
}

function findNextBlankDraftIndex(playerDrafts: PlayerDraft[], startIndex: number) {
  for (let index = startIndex + 1; index < playerDrafts.length; index += 1) {
    if (isBlankDraft(playerDrafts[index])) {
      return index
    }
  }

  return -1
}

const TRANSPARENT_DRAG_IMAGE_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function reorderPlayerDrafts(
  playerDrafts: PlayerDraft[],
  sourceDraftId: string,
  targetDraftId: string,
  insertAfter = false,
) {
  const sourceIndex = playerDrafts.findIndex((draft) => draft.id === sourceDraftId)
  const targetIndex = playerDrafts.findIndex((draft) => draft.id === targetDraftId)

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return playerDrafts
  }

  const reorderedDrafts = [...playerDrafts]
  const [movedDraft] = reorderedDrafts.splice(sourceIndex, 1)

  if (!movedDraft) {
    return playerDrafts
  }

  const targetDraft = playerDrafts[targetIndex]
  const insertionIndex = reorderedDrafts.findIndex(
    (draft) => draft.id === targetDraftId,
  )

  if (insertionIndex === -1) {
    return playerDrafts
  }

  const shouldInsertAfter =
    insertAfter &&
    Boolean(targetDraft) &&
    !(isBlankDraft(targetDraft) && targetIndex === playerDrafts.length - 1)
  const nextInsertionIndex = Math.min(
    insertionIndex + (shouldInsertAfter ? 1 : 0),
    reorderedDrafts.length,
  )

  reorderedDrafts.splice(nextInsertionIndex, 0, movedDraft)

  const normalizedDrafts = ensureTrailingBlankDraft(reorderedDrafts)

  if (
    normalizedDrafts.length === playerDrafts.length &&
    normalizedDrafts.every((draft, index) => draft.id === playerDrafts[index]?.id)
  ) {
    return playerDrafts
  }

  return normalizedDrafts
}

function getActivePlayerCardClass(
  playerId: string,
  activePlayerId: string | null,
) {
  if (playerId === activePlayerId) {
    return 'player-chip is-active'
  }

  return 'player-chip'
}

interface SessionState {
  gameState: GameState
  leaderboardScores: Record<string, number>
  roundScoresInMatch: Array<Record<string, number>>
  completedRoundsInMatch: number
}

function createInitialSessionState(): SessionState {
  return {
    gameState: createSetupState(),
    leaderboardScores: {},
    roundScoresInMatch: [],
    completedRoundsInMatch: 0,
  }
}

function createRoundScoreMap(
  gameState: GameState,
): Record<string, number> {
  return getScoreAwards(gameState).reduce<Record<string, number>>(
    (scoreMap, award) => ({
      ...scoreMap,
      [award.playerId]: award.points,
    }),
    {},
  )
}

function applyFinishedSessionState(
  currentSession: SessionState,
  nextGameState: GameState,
): SessionState {
  if (
    currentSession.gameState.phase === 'finished' ||
    nextGameState.phase !== 'finished'
  ) {
    return {
      ...currentSession,
      gameState: nextGameState,
    }
  }

  const roundAwards = getScoreAwards(nextGameState)

  return {
    gameState: nextGameState,
    leaderboardScores: applyScoreAwards(
      currentSession.leaderboardScores,
      roundAwards,
    ),
    roundScoresInMatch: [
      ...currentSession.roundScoresInMatch,
      createRoundScoreMap(nextGameState),
    ],
    completedRoundsInMatch: Math.min(
      currentSession.completedRoundsInMatch + 1,
      MATCH_ROUNDS_PER_MATCH,
    ),
  }
}

function App() {
  const [playerDrafts, setPlayerDrafts] = useState<PlayerDraft[]>(() =>
    ensureTrailingBlankDraft(createInitialDrafts()),
  )
  const [sessionState, setSessionState] = useState<SessionState>(() =>
    createInitialSessionState(),
  )
  const answerInputRef = useRef<HTMLInputElement>(null)
  const startFirstTurnButtonRef = useRef<HTMLButtonElement>(null)
  const leaderboardActionButtonRef = useRef<HTMLButtonElement>(null)
  const playerInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const draftItemRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const draftItemPositionSnapshotRef = useRef<Record<string, number>>({})
  const transparentDragImageRef = useRef<HTMLImageElement | null>(null)
  const segmentationCacheRef = useRef<
    Map<string, SyllableSegmentationResponse>
  >(new Map())
  const pendingSetupFocusIdRef = useRef<string | null>(null)
  const [draggedDraftId, setDraggedDraftId] = useState<string | null>(null)
  const [currentInputSegmentation, setCurrentInputSegmentation] =
    useState<SyllableSegmentationResponse | null>(null)
  const [segmentationError, setSegmentationError] = useState<string | null>(null)
  const [isSegmentingCurrentInput, setIsSegmentingCurrentInput] = useState(false)
  const [isSubmittingTurn, setIsSubmittingTurn] = useState(false)
  const { gameState, leaderboardScores, roundScoresInMatch } = sessionState
  const currentMatchRound =
    gameState.phase === 'finished'
      ? Math.max(sessionState.completedRoundsInMatch, 1)
      : Math.min(
          sessionState.completedRoundsInMatch + 1,
          MATCH_ROUNDS_PER_MATCH,
        )
  const isMatchComplete =
    sessionState.completedRoundsInMatch >= MATCH_ROUNDS_PER_MATCH
  const replayButtonLabel = isMatchComplete
    ? 'เริ่มแมตช์ใหม่ด้วยรายชื่อเดิม'
    : 'เล่นรอบถัดไปด้วยรายชื่อเดิม'
  const replayButtonCopy = isMatchComplete ? 'แมตช์ใหม่' : 'รอบถัดไป'

  const validation = getSetupValidation(playerDrafts)
  const activePlayer =
    gameState.players.find((player) => player.id === gameState.activePlayerId) ??
    null
  const winner =
    gameState.players.find((player) => player.id === gameState.winnerId) ?? null
  const isAwaitingRoundSummary =
    gameState.phase === 'finished' &&
    gameState.isAwaitingRoundSummary &&
    winner !== null
  const playScreenPlayer =
    gameState.phase === 'playing'
      ? activePlayer
      : isAwaitingRoundSummary
        ? winner
        : null
  const activePlayers = gameState.players.filter(
    (player) => player.status === 'active',
  )
  const visiblePlayers =
    isAwaitingRoundSummary && winner !== null ? [winner] : activePlayers
  const displayedActivePlayers =
    currentMatchRound % 2 === 0 && !isAwaitingRoundSummary
      ? [...visiblePlayers].reverse()
      : visiblePlayers
  const eliminatedPlayers = gameState.players.filter(
    (player) => player.status === 'eliminated',
  )
  const latestEliminatedPlayer =
    eliminatedPlayers.length > 0
      ? [...eliminatedPlayers].sort(
          (left, right) =>
            (right.eliminatedOrder ?? 0) - (left.eliminatedOrder ?? 0),
        )[0]
      : null
  const eliminatedPlayerSummary = getEliminatedPlayerSummary(
    latestEliminatedPlayer,
  )
  const eliminatedPlayerSummaryContent = renderEliminatedPlayerSummaryContent(
    latestEliminatedPlayer,
  )
  const roundAwards =
    gameState.phase === 'finished' ? getScoreAwards(gameState) : []
  const roundAwardMap = new Map(
    roundAwards.map((award) => [award.playerId, award]),
  )
  const leaderboardEntries =
    gameState.phase === 'finished'
      ? gameState.players
          .map((player, index) => ({
            player,
            score: leaderboardScores[player.id] ?? 0,
            roundScores: Array.from(
              { length: MATCH_ROUNDS_PER_MATCH },
              (_, roundIndex) => {
                if (roundIndex >= sessionState.completedRoundsInMatch) {
                  return null
                }

                return roundScoresInMatch[roundIndex]?.[player.id] ?? 0
              },
            ),
            roundPoints: roundAwardMap.get(player.id)?.points ?? 0,
            placement: roundAwardMap.get(player.id)?.placement ?? null,
            initialIndex: index,
          }))
          .sort((left, right) => {
            if (right.score !== left.score) {
              return right.score - left.score
            }

            if (right.roundPoints !== left.roundPoints) {
              return right.roundPoints - left.roundPoints
            }

            const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER
            const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER

            if (leftPlacement !== rightPlacement) {
              return leftPlacement - rightPlacement
            }

            return left.initialIndex - right.initialIndex
          })
      : []
  const isAwaitingFirstTurnStart =
    gameState.phase === 'playing' && gameState.isAwaitingFirstTurnStart
  const isPausedTurn =
    gameState.phase === 'playing' &&
    !gameState.isAwaitingFirstTurnStart &&
    gameState.activePlayerId !== null &&
    gameState.turnStartedAt === null &&
    !gameState.isSafeToFinish
  const requiresManualTurnStart =
    gameState.phase === 'playing' && (isAwaitingFirstTurnStart || isPausedTurn)
  const requiresPrimaryAction =
    requiresManualTurnStart || isAwaitingRoundSummary
  const canSubmitCurrentTurn =
    gameState.phase === 'playing' &&
    !requiresPrimaryAction &&
    !isSubmittingTurn &&
    gameState.currentInput.trim().length > 0 &&
    (gameState.isSafeToFinish || gameState.timeLeftMs > 0)
  const timerTone =
    isAwaitingRoundSummary
      ? 'is-safe'
      : gameState.phase === 'playing' && isAwaitingFirstTurnStart
      ? 'is-pending'
      : gameState.phase === 'playing' && isPausedTurn
        ? 'is-paused'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'is-safe'
        : gameState.phase === 'playing' && gameState.timeLeftMs <= 1000
          ? 'is-urgent'
          : ''
  const timerValue = isAwaitingRoundSummary
    ? 'สรุปรอบ'
    : requiresManualTurnStart
      ? 'รอเริ่ม'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'ผ่านแล้ว'
        : gameState.phase === 'playing'
          ? `${formatSeconds(gameState.timeLeftMs)}s`
          : ''
  const timerAriaLabel = isAwaitingRoundSummary
    ? 'เวลา สรุปรอบ'
    : requiresManualTurnStart
      ? 'เวลา รอเริ่ม'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'เวลา ผ่านแล้ว'
        : gameState.phase === 'playing'
          ? `เวลาเหลือ ${formatSeconds(gameState.timeLeftMs)} วินาที`
          : 'เวลา'
  const currentInputSyllables = currentInputSegmentation?.syllables ?? []
  const currentInputSegmentationMeta = currentInputSegmentation
    ? `${currentInputSegmentation.engine} · ${currentInputSegmentation.modelVersion}`
    : null

  async function getSyllableSegmentation(
    text: string,
    signal?: AbortSignal,
  ) {
    const normalizedText = text.trim()

    if (!normalizedText) {
      return {
        syllables: [],
        engine: DEFAULT_SYLLABLE_ENGINE,
        mode: 'written' as const,
        modelVersion: 'empty-input',
      }
    }

    const cacheKey = getSegmentationCacheKey(normalizedText)
    const cachedResult = segmentationCacheRef.current.get(cacheKey)

    if (cachedResult) {
      return cachedResult
    }

    const result = await segmentThaiText(normalizedText, {
      engine: DEFAULT_SYLLABLE_ENGINE,
      signal,
    })

    segmentationCacheRef.current.set(cacheKey, result)
    return result
  }

  function replaceGameState(nextGameState: GameState) {
    setSessionState((current) =>
      applyFinishedSessionState(current, nextGameState),
    )
  }

  function updateGameState(
    updater: (currentGameState: GameState) => GameState,
  ) {
    setSessionState((current) => {
      const nextGameState = updater(current.gameState)

      if (nextGameState === current.gameState) {
        return current
      }

      return applyFinishedSessionState(current, nextGameState)
    })
  }

  useTurnTimer({
    durationMs: TURN_DURATION_MS,
    active: gameState.phase === 'playing' && gameState.activePlayerId !== null,
    safeToFinish: gameState.phase === 'playing' && gameState.isSafeToFinish,
    startedAt: gameState.phase === 'playing' ? gameState.turnStartedAt : null,
    onTick: (timeLeftMs, startedAt) => {
      updateGameState((current) => {
        if (
          current.phase !== 'playing' ||
          current.turnStartedAt !== startedAt
        ) {
          return current
        }

        return {
          ...current,
          timeLeftMs,
        }
      })
    },
    onExpire: (startedAt) => {
      updateGameState((current) => {
        if (
          current.phase !== 'playing' ||
          current.isSafeToFinish ||
          current.turnStartedAt !== startedAt
        ) {
          return current
        }

        return advanceTurn(current, { type: 'timeout' })
      })
    },
  })

  useEffect(() => {
    if (gameState.phase !== 'playing') {
      return
    }

    if (isAwaitingFirstTurnStart || isPausedTurn) {
      startFirstTurnButtonRef.current?.focus()
      return
    }

    if (!isAwaitingFirstTurnStart && !isPausedTurn) {
      answerInputRef.current?.focus()
    }
  }, [
    gameState.phase,
    gameState.activePlayerId,
    gameState.turnStartedAt,
    isAwaitingFirstTurnStart,
    gameState.isAwaitingFirstTurnStart,
    isPausedTurn,
  ])

  useEffect(() => {
    if (!isAwaitingRoundSummary) {
      return
    }

    startFirstTurnButtonRef.current?.focus()
  }, [isAwaitingRoundSummary])

  useEffect(() => {
    if (gameState.phase !== 'finished' || gameState.isAwaitingRoundSummary) {
      return
    }

    leaderboardActionButtonRef.current?.focus()
  }, [
    gameState.phase,
    gameState.isAwaitingRoundSummary,
    sessionState.completedRoundsInMatch,
  ])

  useEffect(() => {
    if (gameState.phase !== 'setup') {
      return
    }

    const targetId = pendingSetupFocusIdRef.current

    if (!targetId) {
      return
    }

    const targetInput = playerInputRefs.current[targetId]

    if (targetInput) {
      targetInput.focus()
      targetInput.select()
    }

    pendingSetupFocusIdRef.current = null
  }, [gameState.phase, playerDrafts])

  useEffect(() => {
    if (gameState.phase !== 'playing') {
      setCurrentInputSegmentation(null)
      setSegmentationError(null)
      setIsSegmentingCurrentInput(false)
      return
    }

    if (requiresManualTurnStart) {
      setCurrentInputSegmentation(null)
      setIsSegmentingCurrentInput(false)
      return
    }

    const normalizedInput = gameState.currentInput.trim()

    if (!normalizedInput) {
      setCurrentInputSegmentation(null)
      setSegmentationError(null)
      setIsSegmentingCurrentInput(false)
      return
    }

    const cacheKey = getSegmentationCacheKey(normalizedInput)
    const cachedResult = segmentationCacheRef.current.get(cacheKey)

    if (cachedResult) {
      setCurrentInputSegmentation(cachedResult)
      setSegmentationError(null)
      setIsSegmentingCurrentInput(false)
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void getSyllableSegmentation(normalizedInput, controller.signal)
        .then((result) => {
          setCurrentInputSegmentation(result)
          setSegmentationError(null)
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return
          }

          setCurrentInputSegmentation(null)
          setSegmentationError(getSegmentationErrorMessage(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSegmentingCurrentInput(false)
          }
        })
    }, SYLLABLE_REQUEST_DEBOUNCE_MS)

    setSegmentationError(null)
    setIsSegmentingCurrentInput(true)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [
    gameState.phase,
    gameState.currentInput,
    requiresManualTurnStart,
  ])

  useLayoutEffect(() => {
    const previousPositions = draftItemPositionSnapshotRef.current

    if (Object.keys(previousPositions).length === 0) {
      return
    }

    playerDrafts.forEach((draft) => {
      const draftItem = draftItemRefs.current[draft.id]
      const previousTop = previousPositions[draft.id]

      if (!draftItem || previousTop === undefined) {
        return
      }

      const currentTop = draftItem.getBoundingClientRect().top
      const deltaY = previousTop - currentTop

      if (Math.abs(deltaY) < 1) {
        return
      }

      draftItem.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: 'translateY(0)' },
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      )
    })

    draftItemPositionSnapshotRef.current = {}
  }, [playerDrafts])

  function focusPlayerInput(draftId: string | null, shouldSelect = false) {
    if (!draftId) {
      return
    }

    const targetInput = playerInputRefs.current[draftId]

    if (!targetInput) {
      return
    }

    targetInput.focus()

    if (shouldSelect) {
      targetInput.select()
    }
  }

  function handlePlayerDraftChange(
    draftId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const { value } = event.target

    setPlayerDrafts((current) =>
      ensureTrailingBlankDraft(
        current.map((draft) =>
          draft.id === draftId ? { ...draft, name: value } : draft,
        ),
      ),
    )
  }

  function handleRemovePlayer(draftId: string) {
    setPlayerDrafts((current) => {
      const draftIndex = current.findIndex((draft) => draft.id === draftId)

      if (draftIndex === -1) {
        return current
      }

      const nextDrafts = ensureTrailingBlankDraft(
        current.filter((draft) => draft.id !== draftId),
      )
      const focusIndex = Math.min(draftIndex, nextDrafts.length - 1)
      pendingSetupFocusIdRef.current = nextDrafts[focusIndex]?.id ?? null
      return nextDrafts
    })
  }

  function handlePlayerDraftPaste(
    draftId: string,
    event: ClipboardEvent<HTMLInputElement>,
  ) {
    const pastedText = event.clipboardData.getData('text')
    const pastedLines = pastedText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const selectionStart =
      event.currentTarget.selectionStart ?? event.currentTarget.value.length
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart

    if (pastedLines.length === 0) {
      return
    }

    event.preventDefault()

    setPlayerDrafts((current) => {
      const draftIndex = current.findIndex((draft) => draft.id === draftId)

      if (draftIndex === -1) {
        return current
      }

      if (pastedLines.length === 1) {
        const nextDrafts = ensureTrailingBlankDraft(
          current.map((draft, index) =>
            index === draftIndex
              ? {
                  ...draft,
                  name: `${draft.name.slice(0, selectionStart)}${
                    pastedLines[0]
                  }${draft.name.slice(selectionEnd)}`,
                }
              : draft,
          ),
        )
        const nextBlankIndex = findNextBlankDraftIndex(nextDrafts, draftIndex)
        const focusIndex =
          nextBlankIndex === -1
            ? Math.min(draftIndex + 1, nextDrafts.length - 1)
            : nextBlankIndex

        pendingSetupFocusIdRef.current = nextDrafts[focusIndex]?.id ?? null
        return nextDrafts
      }

      const insertedDrafts = pastedLines.map((name) => createPlayerDraft(name))
      const nextDrafts = ensureTrailingBlankDraft([
        ...current.slice(0, draftIndex),
        ...insertedDrafts,
        ...current.slice(draftIndex + 1),
      ])
      const nextBlankIndex = findNextBlankDraftIndex(
        nextDrafts,
        draftIndex + insertedDrafts.length - 1,
      )
      const focusIndex =
        nextBlankIndex === -1 ? nextDrafts.length - 1 : nextBlankIndex

      pendingSetupFocusIdRef.current = nextDrafts[focusIndex]?.id ?? null
      return nextDrafts
    })
  }

  function handlePlayerDraftKeyDown(
    draftId: string,
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    const currentDraft = playerDrafts[index]

    if (!currentDraft || currentDraft.id !== draftId) {
      return
    }

    const isTrailingRow = index === playerDrafts.length - 1
    const hasName = currentDraft.name.trim().length > 0

    if (event.key === 'Enter') {
      event.preventDefault()

      if (!hasName && isTrailingRow) {
        if (validation.canStart) {
          handleConfirmPlayers()
        }
        return
      }

      const nextDraft = playerDrafts[Math.min(index + 1, playerDrafts.length - 1)]
      focusPlayerInput(nextDraft?.id ?? null, true)
      return
    }

    if (
      event.key === 'Backspace' &&
      currentDraft.name.length === 0 &&
      playerDrafts.length > 1
    ) {
      event.preventDefault()

      setPlayerDrafts((current) => {
        const draftIndex = current.findIndex((draft) => draft.id === draftId)

        if (draftIndex === -1 || current[draftIndex].name.length > 0) {
          return current
        }

        const nextDrafts = ensureTrailingBlankDraft(
          current.filter((draft) => draft.id !== draftId),
        )
        const focusIndex = Math.max(0, draftIndex - 1)
        pendingSetupFocusIdRef.current = nextDrafts[focusIndex]?.id ?? null
        return nextDrafts
      })
    }
  }

  function resetDraggedDraftState() {
    setDraggedDraftId(null)
    draftItemPositionSnapshotRef.current = {}
  }

  function handleDraftDragStart(
    draftId: string,
    event: DragEvent<HTMLLIElement>,
  ) {
    setDraggedDraftId(draftId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', draftId)

    if (!transparentDragImageRef.current) {
      const image = new Image(1, 1)
      image.src = TRANSPARENT_DRAG_IMAGE_SRC
      transparentDragImageRef.current = image
    }

    if (typeof event.dataTransfer.setDragImage === 'function') {
      event.dataTransfer.setDragImage(transparentDragImageRef.current, 0, 0)
    }
  }

  function handleDraftDragOver(
    targetDraftId: string,
    event: DragEvent<HTMLLIElement>,
  ) {
    if (!draggedDraftId || draggedDraftId === targetDraftId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const targetRect = event.currentTarget.getBoundingClientRect()
    const shouldInsertAfter =
      event.clientY > targetRect.top + targetRect.height / 2

    setPlayerDrafts((current) => {
      const nextDrafts = reorderPlayerDrafts(
        current,
        draggedDraftId,
        targetDraftId,
        shouldInsertAfter,
      )

      if (nextDrafts === current) {
        return current
      }

      draftItemPositionSnapshotRef.current = current.reduce<Record<string, number>>(
        (positions, draft) => {
          const draftItem = draftItemRefs.current[draft.id]

          if (draftItem) {
            positions[draft.id] = draftItem.getBoundingClientRect().top
          }

          return positions
        },
        {},
      )

      return nextDrafts
    })
  }

  function handleDraftDrop(
    _targetDraftId: string,
    event: DragEvent<HTMLLIElement>,
  ) {
    event.preventDefault()
    resetDraggedDraftState()
  }

  function handleConfirmPlayers() {
    if (!validation.canStart) {
      return
    }

    setCurrentInputSegmentation(null)
    setSegmentationError(null)
    setIsSegmentingCurrentInput(false)

    replaceGameState(
      createConfirmedGameState(
        prepareRoster(playerDrafts),
        TURN_DURATION_MS,
        getTurnDirectionForMatchRound(1),
      ),
    )
  }

  function handleStartFirstTurn() {
    setSegmentationError(null)
    updateGameState((current) => startActiveTurn(current))
  }

  function handleContinueToRoundSummary() {
    updateGameState((current) => acknowledgeRoundSummary(current))
  }

  function handleStartFirstTurnKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    if (isAwaitingRoundSummary) {
      handleContinueToRoundSummary()
      return
    }

    handleStartFirstTurn()
  }

  function handleAnswerChange(event: ChangeEvent<HTMLInputElement>) {
    const { value } = event.target

    updateGameState((current) => {
      if (
        current.phase !== 'playing' ||
        current.isAwaitingFirstTurnStart ||
        current.turnStartedAt === null
      ) {
        return current
      }

      return applyInputChange(current, value)
    })
  }

  async function handleSubmitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const submittedAt = Date.now()
    const currentGameState = sessionState.gameState

    if (
      currentGameState.phase !== 'playing' ||
      currentGameState.isAwaitingFirstTurnStart ||
      currentGameState.turnStartedAt === null
    ) {
      return
    }

    const answer = currentGameState.currentInput.trim()

    if (!answer) {
      return
    }

    setIsSubmittingTurn(true)
    setSegmentationError(null)

    try {
      const segmentation = await getSyllableSegmentation(answer)

      updateGameState((current) => {
        if (
          current.phase !== 'playing' ||
          current.isAwaitingFirstTurnStart ||
          current.turnStartedAt === null
        ) {
          return current
        }

        return advanceTurn(current, {
          type: 'submit',
          answer: current.currentInput,
          syllables: segmentation.syllables,
          now: submittedAt,
        })
      })
    } catch (error) {
      setSegmentationError(getSegmentationErrorMessage(error))
    } finally {
      setIsSubmittingTurn(false)
    }
  }

  function handleReplaySamePlayers() {
    if (!validation.canStart) {
      return
    }

    setCurrentInputSegmentation(null)
    setSegmentationError(null)
    setIsSegmentingCurrentInput(false)

    setSessionState((current) => {
      if (
        current.completedRoundsInMatch >= MATCH_ROUNDS_PER_MATCH
      ) {
        segmentationCacheRef.current.clear()
      }

      const shouldStartNewMatch =
        current.completedRoundsInMatch >= MATCH_ROUNDS_PER_MATCH
      const nextMatchRound = shouldStartNewMatch
        ? 1
        : current.completedRoundsInMatch + 1

      return {
        gameState: createConfirmedGameState(
          prepareRoster(playerDrafts),
          TURN_DURATION_MS,
          getTurnDirectionForMatchRound(nextMatchRound),
        ),
        leaderboardScores: shouldStartNewMatch
          ? {}
          : current.leaderboardScores,
        roundScoresInMatch: shouldStartNewMatch
          ? []
          : current.roundScoresInMatch,
        completedRoundsInMatch: shouldStartNewMatch
          ? 0
          : current.completedRoundsInMatch,
      }
    })
  }

  function handleResetAll() {
    segmentationCacheRef.current.clear()
    setCurrentInputSegmentation(null)
    setSegmentationError(null)
    setIsSegmentingCurrentInput(false)
    setIsSubmittingTurn(false)
    setPlayerDrafts(ensureTrailingBlankDraft(createInitialDrafts()))
    setSessionState(createInitialSessionState())
  }

  return (
    <main className="app-shell">
      {gameState.phase === 'setup' && (
        <section className="phase-screen setup-screen">
          <div className="surface-card setup-card">
            <div className="panel-header setup-header">
              <div className="setup-copy">
                <h1>จัดรายชื่อผู้เล่น</h1>
              </div>
              <div className="setup-tooltip">
                <button
                  type="button"
                  className="ghost-button symbol-button setup-help-button"
                  aria-label="วิธีจัดรายชื่อผู้เล่น"
                  aria-describedby="setup-help-tooltip"
                  title="วิธีจัดรายชื่อผู้เล่น"
                >
                  วิธีใช้
                </button>
                <div
                  className="setup-tooltip-panel"
                  id="setup-help-tooltip"
                  role="tooltip"
                >
                  <ul className="setup-tooltip-list">
                    <li>พิมพ์ชื่อแล้วกด Enter เพื่อไปแถวถัดไป</li>
                    <li>กด Enter บนแถวว่างท้ายเพื่อยืนยันรายชื่อ</li>
                    <li>ลากการ์ดผู้เล่นเพื่อจัดลำดับได้อิสระ</li>
                    <li>กด Backspace บนช่องว่างเพื่อลบ</li>
                    <li>วางรายชื่อหลายบรรทัดได้</li>
                  </ul>
                </div>
              </div>
            </div>

            <p className="sr-only">
              พิมพ์ชื่อแล้วกด Enter เพื่อไปแถวถัดไป กด Enter บนแถวว่างท้ายเพื่อยืนยันรายชื่อ
              ลากการ์ดผู้เล่นเพื่อจัดลำดับได้อิสระ กด Backspace บนช่องว่างเพื่อลบ และวางรายชื่อหลายบรรทัดได้
            </p>

            {playerDrafts.length > 0 ? (
              <ol className="draft-list">
                {playerDrafts.map((draft, index) => (
                  <li
                    className={`draft-item ${
                      index < playerDrafts.length - 1 ? 'is-draggable' : ''
                    } ${
                      draggedDraftId === draft.id ? 'is-dragging' : ''
                    }`.trim()}
                    key={draft.id}
                    ref={(item) => {
                      draftItemRefs.current[draft.id] = item
                    }}
                    draggable={index < playerDrafts.length - 1}
                    onDragStart={(event) => handleDraftDragStart(draft.id, event)}
                    onDragEnd={resetDraggedDraftState}
                    onDragOver={(event) => handleDraftDragOver(draft.id, event)}
                    onDrop={(event) => handleDraftDrop(draft.id, event)}
                  >
                    <div className="draft-order">
                      <span className="order-chip" aria-hidden="true">
                        {index + 1}
                      </span>
                    </div>

                    <div className="draft-field">
                      <label htmlFor={`player-${draft.id}`}>
                        ชื่อผู้เล่น {index + 1}
                      </label>
                      <input
                        id={`player-${draft.id}`}
                        className="text-input"
                        type="text"
                        ref={(input) => {
                          playerInputRefs.current[draft.id] = input
                        }}
                        value={draft.name}
                        onChange={(event) =>
                          handlePlayerDraftChange(draft.id, event)
                        }
                        onKeyDown={(event) =>
                          handlePlayerDraftKeyDown(draft.id, index, event)
                        }
                        onPaste={(event) => handlePlayerDraftPaste(draft.id, event)}
                        placeholder="เช่น เมย์"
                        autoComplete="off"
                        autoFocus={index === 0}
                      />
                    </div>

                    <div className="draft-actions">
                      <button
                        type="button"
                        className="ghost-button danger-button symbol-button compact-symbol-button"
                        onClick={() => handleRemovePlayer(draft.id)}
                        aria-label={`ลบผู้เล่น ${index + 1}`}
                        tabIndex={-1}
                        title="ลบผู้เล่น"
                      >
                        <span className="button-symbol" aria-hidden="true">
                          ×
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-state">
                <p>ยังไม่มีผู้เล่นในเกมนี้</p>
                <p>พิมพ์ชื่อผู้เล่นเพื่อเริ่มจัดลำดับ</p>
              </div>
            )}

            <div className="setup-footer">
              <p
                className={`validation-note ${
                  validation.canStart ? 'is-ready' : ''
                }`}
              >
                {getSetupMessage(validation)}
              </p>

              <button
                type="button"
                className="primary-button start-button"
                disabled={!validation.canStart}
                onClick={handleConfirmPlayers}
                aria-label="ยืนยันผู้เล่น"
                title="ยืนยันผู้เล่น"
              >
                <span className="button-copy">ยืนยันผู้เล่น</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {playScreenPlayer && (gameState.phase === 'playing' || isAwaitingRoundSummary) && (
        <section className="phase-screen play-screen">
          <form className="surface-card answer-panel" onSubmit={handleSubmitTurn}>
            <div className="form-copy">
              <h1 className="sr-only">ถึงตา {playScreenPlayer.name}</h1>
              <p className="round-indicator">
                รอบ {currentMatchRound}/{MATCH_ROUNDS_PER_MATCH}
              </p>
              {isAwaitingRoundSummary && (
                <p className="pause-note" role="status" aria-live="polite">
                  {eliminatedPlayerSummaryContent}
                </p>
              )}
              {isPausedTurn && (
                <p className="pause-note" role="status" aria-live="polite">
                  {eliminatedPlayerSummaryContent}
                </p>
              )}
              {segmentationError && (
                <p className="segmentation-error" role="alert">
                  {segmentationError}
                </p>
              )}
              <label htmlFor="current-answer" className="sr-only">
                คำตอบของ {playScreenPlayer.name}
              </label>
              <p className="sr-only">
                {isAwaitingRoundSummary
                  ? `${eliminatedPlayerSummary} กดสรุปรอบเพื่อดูตารางคะแนนของ ${playScreenPlayer.name}`
                  : isAwaitingFirstTurnStart
                  ? `ยืนยันผู้เล่นแล้ว กดเริ่มรอบแรกเพื่อเริ่มจับเวลา ${playScreenPlayer.name}`
                  : isPausedTurn
                    ? getPausedTurnInstructions(
                        latestEliminatedPlayer,
                        playScreenPlayer.name,
                      )
                    : 'เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ'}
              </p>
              {requiresPrimaryAction && (
                <span className="sr-only">ยังไม่เริ่มจับเวลา</span>
              )}
            </div>

            <div className="answer-controls">
              <input
                ref={answerInputRef}
                id="current-answer"
                className="text-input answer-input"
                type="text"
                value={gameState.currentInput}
                onChange={handleAnswerChange}
                placeholder="พิมพ์คำตอบของผู้เล่น"
                autoComplete="off"
                disabled={requiresPrimaryAction || isSubmittingTurn}
              />
              <div
                className={`turn-timer-pill ${timerTone}`}
                aria-live="polite"
                aria-label={timerAriaLabel}
              >
                <span>เวลา</span>
                <strong>{timerValue}</strong>
              </div>
              {requiresPrimaryAction ? (
                <button
                  ref={startFirstTurnButtonRef}
                  type="button"
                  className="primary-button symbol-button start-turn-button"
                  onClick={
                    isAwaitingRoundSummary
                      ? handleContinueToRoundSummary
                      : handleStartFirstTurn
                  }
                  onKeyDown={handleStartFirstTurnKeyDown}
                  aria-label={
                    isAwaitingRoundSummary
                      ? 'สรุปรอบ'
                      : isAwaitingFirstTurnStart
                        ? 'เริ่มรอบแรก'
                        : 'เริ่มตาถัดไป'
                  }
                  title={
                    isAwaitingRoundSummary
                      ? 'สรุปรอบ'
                      : isAwaitingFirstTurnStart
                        ? 'เริ่มรอบแรก'
                        : 'เริ่มตาถัดไป'
                  }
                >
                  <span className="button-symbol" aria-hidden="true">
                    ▶
                  </span>
                  <span className="button-copy">
                    {isAwaitingRoundSummary
                      ? 'สรุปรอบ'
                      : isAwaitingFirstTurnStart
                        ? 'เริ่มรอบแรก'
                        : 'เริ่มตาถัดไป'}
                  </span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary-button symbol-button compact-symbol-button"
                  disabled={!canSubmitCurrentTurn}
                  aria-label="ถัดไป"
                  title="ถัดไป"
                >
                  <span className="button-symbol" aria-hidden="true">
                    →
                  </span>
                </button>
              )}
            </div>
          </form>

          <section className="surface-card syllable-debug-card" aria-label="ดีบักพยางค์">
            <div className="panel-header compact debug-header">
              <div>
                <p className="eyebrow">debug</p>
                <h2>พยางค์ที่ระบบใช้จริง</h2>
              </div>
            </div>

            <div className="syllable-debug-grid">
              <section className="syllable-debug-group" aria-label="พยางค์ของคำปัจจุบัน">
                <h3>คำที่กำลังพิมพ์</h3>
                {currentInputSegmentationMeta && (
                  <p className="syllable-meta">{currentInputSegmentationMeta}</p>
                )}
                <div className="syllable-chip-list">
                  {isSegmentingCurrentInput ? (
                    <span className="syllable-empty">กำลังแยกพยางค์...</span>
                  ) : currentInputSyllables.length > 0 ? (
                    currentInputSyllables.map((syllable, index) => (
                      <span
                        className="syllable-chip is-current"
                        key={`${syllable}-${index}`}
                      >
                        {syllable}
                      </span>
                    ))
                  ) : (
                    <span className="syllable-empty">ยังไม่มีพยางค์</span>
                  )}
                </div>
              </section>

              <section
                className="syllable-debug-group"
                aria-label="พยางค์ที่บันทึกในรอบนี้"
              >
                <h3>พยางค์ที่บันทึกในรอบนี้</h3>
                <div className="syllable-chip-list">
                  {gameState.usedSyllablesInRound.length > 0 ? (
                    gameState.usedSyllablesInRound.map((syllable, index) => (
                      <span
                        className="syllable-chip"
                        key={`${syllable}-${index}`}
                      >
                        {syllable}
                      </span>
                    ))
                  ) : (
                    <span className="syllable-empty">ยังไม่มีพยางค์</span>
                  )}
                </div>
              </section>
            </div>
          </section>

          <section className="board-grid">
            <section className="surface-card board-card active-board-card">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">ยังอยู่ในเกม</p>
                  <h2>
                    <span className="headline-symbol" aria-hidden="true">
                      ◌
                    </span>
                    คิวผู้เล่น
                  </h2>
                </div>
                <span className="count-badge">{visiblePlayers.length} คน</span>
              </div>

              <ol
                className="player-board active-player-board"
                aria-label="ผู้เล่นที่ยังไม่ตกรอบ"
              >
                {displayedActivePlayers.map((player) => (
                  <li
                    className={getActivePlayerCardClass(
                      player.id,
                      gameState.activePlayerId,
                    )}
                    key={player.id}
                  >
                    <strong>{player.name}</strong>
                    {player.id === gameState.activePlayerId && (
                      <span className="player-chip-current">ตอนนี้</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>

            <section
              className={`surface-card board-card eliminated-board-card ${
                eliminatedPlayers.length === 0 ? 'is-empty-collapsed' : ''
              }`.trim()}
            >
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">หลุดออกจากเกม</p>
                  <h2>
                    <span className="headline-symbol" aria-hidden="true">
                      ×
                    </span>
                    ผู้เล่นที่ตกรอบ
                  </h2>
                </div>
                <span className="count-badge">{eliminatedPlayers.length} คน</span>
              </div>

              {eliminatedPlayers.length > 0 ? (
                <ol
                  className="player-board eliminated-player-board"
                  aria-label="ผู้เล่นที่ตกรอบ"
                >
                  {eliminatedPlayers.map((player) => (
                    <li className="player-chip is-out" key={player.id}>
                      <strong>{player.name}</strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty-note">ยังไม่มีใครตกรอบในตอนนี้</p>
              )}
            </section>
          </section>
        </section>
      )}

      {gameState.phase === 'finished' && winner && !gameState.isAwaitingRoundSummary && (
        <section className="phase-screen result-screen">
          <section className="surface-card leaderboard-card result-leaderboard-card">
            <div className="panel-header compact">
              <div>
                <h2>ตารางคะแนน</h2>
              </div>
            </div>

            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table" aria-label="ตารางคะแนนสะสม">
                <thead>
                  <tr>
                    <th scope="col">ผู้เล่น</th>
                    <th scope="col">รอบที่ 1</th>
                    <th scope="col">รอบที่ 2</th>
                    <th scope="col">รอบที่ 3</th>
                    <th scope="col">รอบที่ 4</th>
                    <th scope="col">คะแนนรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardEntries.map((entry) => (
                    <tr
                      key={entry.player.id}
                      className={`${entry.player.status === 'winner' ? 'is-winner' : ''} ${
                        entry.roundPoints > 0 ? 'is-awarded' : ''
                      }`.trim()}
                      aria-label={`คะแนนสะสมของ ${entry.player.name}`}
                    >
                      <th scope="row">
                        <div className="leaderboard-player-cell">
                          <strong>{entry.player.name}</strong>
                        </div>
                      </th>
                      {entry.roundScores.map((roundScore, roundIndex) => (
                        <td
                          key={`${entry.player.id}-round-${roundIndex + 1}`}
                          className={
                            roundIndex + 1 === sessionState.completedRoundsInMatch
                              ? 'is-current-round'
                              : ''
                          }
                        >
                          {roundScore === null ? '-' : roundScore}
                        </td>
                      ))}
                      <td className="leaderboard-total-cell">
                        <strong>{entry.score}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="action-row">
              <button
                ref={leaderboardActionButtonRef}
                type="button"
                className="primary-button symbol-button"
                onClick={handleReplaySamePlayers}
                aria-label={replayButtonLabel}
                title={replayButtonLabel}
              >
                <span className="button-copy">{replayButtonCopy}</span>
              </button>
              <button
                type="button"
                className="secondary-button symbol-button"
                onClick={handleResetAll}
                aria-label="เริ่มใหม่"
                title="เริ่มใหม่"
              >
                <span className="button-copy">เริ่มใหม่</span>
              </button>
            </div>
          </section>
        </section>
      )}
    </main>
  )
}

export default App

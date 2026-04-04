import {
  type ClipboardEvent,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import './App.css'
import {
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
import { useTurnTimer } from './useTurnTimer'

const MATCH_ROUNDS_PER_MATCH = 4

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
  const pendingSetupFocusIdRef = useRef<string | null>(null)
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
  const activePlayers = gameState.players.filter(
    (player) => player.status === 'active',
  )
  const displayedActivePlayers =
    currentMatchRound % 2 === 0 ? [...activePlayers].reverse() : activePlayers
  const eliminatedPlayers = gameState.players.filter(
    (player) => player.status === 'eliminated',
  )
  const winner =
    gameState.players.find((player) => player.id === gameState.winnerId) ?? null
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
  const canSubmitCurrentTurn =
    gameState.phase === 'playing' &&
    !requiresManualTurnStart &&
    gameState.currentInput.trim().length > 0 &&
    (gameState.isSafeToFinish || gameState.timeLeftMs > 0)
  const timerTone =
    gameState.phase === 'playing' && isAwaitingFirstTurnStart
      ? 'is-pending'
      : gameState.phase === 'playing' && isPausedTurn
        ? 'is-paused'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'is-safe'
        : gameState.phase === 'playing' && gameState.timeLeftMs <= 1000
          ? 'is-urgent'
          : ''
  const timerValue =
    requiresManualTurnStart
      ? 'รอเริ่ม'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'ผ่านแล้ว'
        : gameState.phase === 'playing'
          ? `${formatSeconds(gameState.timeLeftMs)}s`
          : ''
  const timerAriaLabel =
    requiresManualTurnStart
      ? 'เวลา รอเริ่ม'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'เวลา ผ่านแล้ว'
        : gameState.phase === 'playing'
          ? `เวลาเหลือ ${formatSeconds(gameState.timeLeftMs)} วินาที`
          : 'เวลา'

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
    if (gameState.phase !== 'finished') {
      return
    }

    leaderboardActionButtonRef.current?.focus()
  }, [gameState.phase, sessionState.completedRoundsInMatch])

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

  function handleAddPlayer() {
    setPlayerDrafts((current) => {
      const nextDrafts = ensureTrailingBlankDraft(current)
      pendingSetupFocusIdRef.current =
        nextDrafts[nextDrafts.length - 1]?.id ?? null
      return nextDrafts
    })
  }

  function handleMovePlayer(draftId: string, direction: -1 | 1) {
    setPlayerDrafts((current) => {
      const currentIndex = current.findIndex((draft) => draft.id === draftId)

      if (currentIndex === -1) {
        return current
      }

      const targetIndex = currentIndex + direction

      if (targetIndex < 0 || targetIndex >= current.length) {
        return current
      }

      const reordered = [...current]
      const [movedDraft] = reordered.splice(currentIndex, 1)
      reordered.splice(targetIndex, 0, movedDraft)
      return reordered
    })
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

  function handleConfirmPlayers() {
    if (!validation.canStart) {
      return
    }

    replaceGameState(
      createConfirmedGameState(
        prepareRoster(playerDrafts),
        TURN_DURATION_MS,
        getTurnDirectionForMatchRound(1),
      ),
    )
  }

  function handleStartFirstTurn() {
    updateGameState((current) => startActiveTurn(current))
  }

  function handleStartFirstTurnKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
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

  function handleSubmitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

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
      })
    })
  }

  function handleReplaySamePlayers() {
    if (!validation.canStart) {
      return
    }

    setSessionState((current) => {
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
              <button
                type="button"
                className="secondary-button symbol-button compact-symbol-button add-player-button"
                onClick={handleAddPlayer}
                aria-label="เพิ่มรายชื่อผู้เล่น"
                tabIndex={-1}
                title="เพิ่มรายชื่อผู้เล่น"
              >
                <span className="button-symbol" aria-hidden="true">
                  ＋
                </span>
              </button>
            </div>

              <p className="support-text setup-support">
              พิมพ์ชื่อแล้วกด Enter เพื่อไปแถวถัดไป, กด Enter บนแถวว่างท้ายเพื่อยืนยันรายชื่อ,
              กด Backspace บนช่องว่างเพื่อลบ และวางรายชื่อหลายบรรทัดได้
            </p>

            {playerDrafts.length > 0 ? (
              <ol className="draft-list">
                {playerDrafts.map((draft, index) => (
                  <li className="draft-item" key={draft.id}>
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
                        className="ghost-button symbol-button compact-symbol-button"
                        onClick={() => handleMovePlayer(draft.id, -1)}
                        disabled={index === 0}
                        aria-label={`เลื่อนผู้เล่น ${index + 1} ขึ้น`}
                        tabIndex={-1}
                        title="เลื่อนขึ้น"
                      >
                        <span className="button-symbol" aria-hidden="true">
                          ↑
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ghost-button symbol-button compact-symbol-button"
                        onClick={() => handleMovePlayer(draft.id, 1)}
                        disabled={index === playerDrafts.length - 1}
                        aria-label={`เลื่อนผู้เล่น ${index + 1} ลง`}
                        tabIndex={-1}
                        title="เลื่อนลง"
                      >
                        <span className="button-symbol" aria-hidden="true">
                          ↓
                        </span>
                      </button>
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
                <p>กดปุ่มเพิ่มรายชื่อผู้เล่นเพื่อเริ่มจัดลำดับ</p>
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
                className="primary-button symbol-button compact-symbol-button start-button"
                disabled={!validation.canStart}
                onClick={handleConfirmPlayers}
                aria-label="ยืนยันผู้เล่น"
                title="ยืนยันผู้เล่น"
              >
                <span className="button-symbol" aria-hidden="true">
                  ▶
                </span>
              </button>
            </div>
          </div>
        </section>
      )}

      {gameState.phase === 'playing' && activePlayer && (
        <section className="phase-screen play-screen">
          <form className="surface-card answer-panel" onSubmit={handleSubmitTurn}>
            <div className="form-copy">
              <h1 className="sr-only">ถึงตา {activePlayer.name}</h1>
              <p className="round-indicator">
                รอบ {currentMatchRound}/{MATCH_ROUNDS_PER_MATCH}
              </p>
              <label htmlFor="current-answer" className="sr-only">
                คำตอบของ {activePlayer.name}
              </label>
              <p className="sr-only">
                {isAwaitingFirstTurnStart
                  ? `ยืนยันผู้เล่นแล้ว กดเริ่มรอบแรกเพื่อเริ่มจับเวลา ${activePlayer.name}`
                  : isPausedTurn
                    ? `ยังไม่เริ่มจับเวลา คนก่อนหน้าเพิ่งตกรอบ กดเริ่มเพื่อเริ่มจับเวลาของ ${activePlayer.name}`
                    : 'เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ'}
              </p>
              {requiresManualTurnStart && (
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
                disabled={requiresManualTurnStart}
              />
              <div
                className={`turn-timer-pill ${timerTone}`}
                aria-live="polite"
                aria-label={timerAriaLabel}
              >
                <span>เวลา</span>
                <strong>{timerValue}</strong>
              </div>
              {requiresManualTurnStart ? (
                <button
                  ref={startFirstTurnButtonRef}
                  type="button"
                  className="primary-button symbol-button start-turn-button"
                  onClick={handleStartFirstTurn}
                  onKeyDown={handleStartFirstTurnKeyDown}
                  aria-label={isAwaitingFirstTurnStart ? 'เริ่มรอบแรก' : 'เริ่มตาถัดไป'}
                  title={isAwaitingFirstTurnStart ? 'เริ่มรอบแรก' : 'เริ่มตาถัดไป'}
                >
                  <span className="button-symbol" aria-hidden="true">
                    ▶
                  </span>
                  <span className="button-copy">
                    {isAwaitingFirstTurnStart ? 'เริ่มรอบแรก' : 'เริ่มตาถัดไป'}
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
                <span className="count-badge">{activePlayers.length} คน</span>
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

      {gameState.phase === 'finished' && winner && (
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

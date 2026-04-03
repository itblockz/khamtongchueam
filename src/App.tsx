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
  createGameState,
  createInitialDrafts,
  createPlayerDraft,
  createSetupState,
  getFinalPlacements,
  getScoreAwards,
  getSetupValidation,
  prepareRoster,
  startActiveTurn,
  type GameState,
  type Player,
  type PlayerDraft,
} from './game'
import { useTurnTimer } from './useTurnTimer'

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

function getPlayerStatusLabel(player: Player, activePlayerId: string | null) {
  if (player.status === 'winner') {
    return 'ผู้ชนะ'
  }

  if (player.status === 'eliminated') {
    return 'ตกรอบ'
  }

  if (player.id === activePlayerId) {
    return 'กำลังเล่น'
  }

  return 'รอคิว'
}

function getPlayerStatusSymbol(player: Player, activePlayerId: string | null) {
  if (player.status === 'winner') {
    return '★'
  }

  if (player.status === 'eliminated') {
    return '×'
  }

  if (player.id === activePlayerId) {
    return '▶'
  }

  return '◌'
}

function getPlayerCardClass(player: Player, activePlayerId: string | null) {
  if (player.status === 'winner') {
    return 'player-chip is-winner'
  }

  if (player.status === 'eliminated') {
    return 'player-chip is-out'
  }

  if (player.id === activePlayerId) {
    return 'player-chip is-active'
  }

  return 'player-chip'
}

interface SessionState {
  gameState: GameState
  leaderboardScores: Record<string, number>
}

function createInitialSessionState(): SessionState {
  return {
    gameState: createSetupState(),
    leaderboardScores: {},
  }
}

function applyFinishedLeaderboardScores(
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

  return {
    gameState: nextGameState,
    leaderboardScores: applyScoreAwards(
      currentSession.leaderboardScores,
      getScoreAwards(nextGameState),
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
  const playerInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingSetupFocusIdRef = useRef<string | null>(null)
  const { gameState, leaderboardScores } = sessionState

  const validation = getSetupValidation(playerDrafts)
  const activePlayer =
    gameState.players.find((player) => player.id === gameState.activePlayerId) ??
    null
  const activePlayers = gameState.players.filter(
    (player) => player.status === 'active',
  )
  const eliminatedPlayers = gameState.players.filter(
    (player) => player.status === 'eliminated',
  )
  const winner =
    gameState.players.find((player) => player.id === gameState.winnerId) ?? null
  const finalPlacements =
    gameState.phase === 'finished' ? getFinalPlacements(gameState) : []
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
  const totalAnswers = gameState.players.reduce(
    (sum, player) => sum + player.answers.length,
    0,
  )
  const isAwaitingFirstTurnStart =
    gameState.phase === 'playing' && gameState.isAwaitingFirstTurnStart
  const isPausedTurn =
    gameState.phase === 'playing' &&
    !gameState.isAwaitingFirstTurnStart &&
    gameState.activePlayerId !== null &&
    gameState.turnStartedAt === null &&
    !gameState.isSafeToFinish
  const canSubmitCurrentTurn =
    gameState.phase === 'playing' &&
    !gameState.isAwaitingFirstTurnStart &&
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
    gameState.phase === 'playing' && (isAwaitingFirstTurnStart || isPausedTurn)
      ? 'รอเริ่ม'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'ผ่านแล้ว'
        : gameState.phase === 'playing'
          ? `${formatSeconds(gameState.timeLeftMs)}s`
          : ''
  const timerAriaLabel =
    gameState.phase === 'playing' && (isAwaitingFirstTurnStart || isPausedTurn)
      ? 'เวลา รอเริ่ม'
      : gameState.phase === 'playing' && gameState.isSafeToFinish
        ? 'เวลา ผ่านแล้ว'
        : gameState.phase === 'playing'
          ? `เวลาเหลือ ${formatSeconds(gameState.timeLeftMs)} วินาที`
          : 'เวลา'

  function replaceGameState(nextGameState: GameState) {
    setSessionState((current) =>
      applyFinishedLeaderboardScores(current, nextGameState),
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

      return applyFinishedLeaderboardScores(current, nextGameState)
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

    if (gameState.isAwaitingFirstTurnStart) {
      startFirstTurnButtonRef.current?.focus()
      return
    }

    if (!gameState.isAwaitingFirstTurnStart) {
      answerInputRef.current?.focus()
    }
  }, [
    gameState.phase,
    gameState.activePlayerId,
    gameState.turnStartedAt,
    gameState.isAwaitingFirstTurnStart,
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

    replaceGameState(createConfirmedGameState(prepareRoster(playerDrafts)))
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
      if (current.phase !== 'playing' || current.isAwaitingFirstTurnStart) {
        return current
      }

      return applyInputChange(current, value)
    })
  }

  function handleSubmitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    updateGameState((current) => {
      if (current.phase !== 'playing') {
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

    replaceGameState(createGameState(prepareRoster(playerDrafts)))
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
              <p className="eyebrow">บันทึกคำตอบ</p>
              <label htmlFor="current-answer">คำตอบของ {activePlayer.name}</label>
              <p className="support-text">
                {isAwaitingFirstTurnStart
                  ? `ยืนยันผู้เล่นแล้ว กดเริ่มรอบแรกเพื่อเริ่มจับเวลา ${activePlayer.name}`
                  : isPausedTurn
                  ? `ยังไม่เริ่มจับเวลา คนก่อนหน้าเพิ่งตกรอบ พอส่งคำของ ${activePlayer.name} แล้วระบบจะเริ่มนับเวลาของคนถัดไป`
                  : 'เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ'}
              </p>
              {(isAwaitingFirstTurnStart || isPausedTurn) && (
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
                disabled={isAwaitingFirstTurnStart}
              />
              <div
                className={`turn-timer-pill ${timerTone}`}
                aria-live="polite"
                aria-label={timerAriaLabel}
              >
                <span>เวลา</span>
                <strong>{timerValue}</strong>
              </div>
              {isAwaitingFirstTurnStart ? (
                <button
                  ref={startFirstTurnButtonRef}
                  type="button"
                  className="primary-button symbol-button start-turn-button"
                  onClick={handleStartFirstTurn}
                  onKeyDown={handleStartFirstTurnKeyDown}
                  aria-label="เริ่มรอบแรก"
                  title="เริ่มรอบแรก"
                >
                  <span className="button-symbol" aria-hidden="true">
                    ▶
                  </span>
                  <span className="button-copy">เริ่มรอบแรก</span>
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
                    ลำดับผู้เล่น
                  </h2>
                </div>
                <span className="count-badge">{activePlayers.length} คน</span>
              </div>

              <ul
                className="player-board active-player-board"
                aria-label="ผู้เล่นที่ยังไม่ตกรอบ"
              >
                {gameState.players
                  .filter((player) => player.status === 'active')
                  .map((player) => (
                    <li
                      className={getPlayerCardClass(player, gameState.activePlayerId)}
                      key={player.id}
                    >
                      <div>
                        <strong>{player.name}</strong>
                        <span className="status-line">
                          <span className="status-symbol" aria-hidden="true">
                            {getPlayerStatusSymbol(
                              player,
                              gameState.activePlayerId,
                            )}
                          </span>
                          {getPlayerStatusLabel(player, gameState.activePlayerId)}
                        </span>
                      </div>
                      <small>
                        {player.answers.length > 0
                          ? `ตอบล่าสุด ${player.answers.at(-1)}`
                          : 'ยังไม่มีคำตอบ'}
                      </small>
                    </li>
                  ))}
              </ul>
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
                <ul
                  className={`player-board eliminated-player-board ${
                    eliminatedPlayers.length >= 2 ? 'is-two-column' : ''
                  }`.trim()}
                  aria-label="ผู้เล่นที่ตกรอบ"
                >
                  {eliminatedPlayers.map((player) => (
                    <li className={getPlayerCardClass(player, null)} key={player.id}>
                      <div>
                        <strong>{player.name}</strong>
                        <span className="status-line">
                          <span className="status-symbol" aria-hidden="true">
                            {getPlayerStatusSymbol(player, null)}
                          </span>
                          {getPlayerStatusLabel(player, null)}
                        </span>
                      </div>
                      <small>ตกรอบในรอบ {player.eliminatedAtRound}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-note">ยังไม่มีใครตกรอบในตอนนี้</p>
              )}
            </section>
          </section>
        </section>
      )}

      {gameState.phase === 'finished' && winner && (
        <section className="phase-screen result-screen">
          <section className="surface-card winner-card">
            <div className="winner-copy">
              <p className="eyebrow">เกมจบแล้ว</p>
              <h1>
                <span className="headline-symbol" aria-hidden="true">
                  ★
                </span>
                ผู้ชนะคือ {winner.name}
              </h1>
              <p className="support-text">
                เหลือรอดเป็นผู้เล่นคนสุดท้ายจากทั้งหมด {gameState.players.length}{' '}
                คน
              </p>
            </div>

            <div className="winner-stats" aria-label="ข้อมูลสรุปเกม">
              <article className="stat-tile">
                <span>จำนวนคำทั้งหมด</span>
                <strong>{totalAnswers} คำ</strong>
              </article>
              <article className="stat-tile">
                <span>รอบสุดท้าย</span>
                <strong>รอบ {gameState.round}</strong>
              </article>
              <article className="stat-tile">
                <span>ผู้เล่นเริ่มต้น</span>
                <strong>{gameState.players.length} คน</strong>
              </article>
            </div>

            <section className="surface-card leaderboard-card">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">คะแนนสะสม</p>
                  <h2>Leaderboard</h2>
                </div>
                <span className="count-badge">{leaderboardEntries.length} คน</span>
              </div>

              <p className="support-text leaderboard-note">
                3 คนสุดท้ายได้คนละ 1 คะแนน และผู้ชนะได้โบนัสเพิ่มอีก 2 คะแนน
              </p>

              <ol className="leaderboard-list" aria-label="ตารางคะแนนสะสม">
                {leaderboardEntries.map((entry, index) => (
                  <li
                    className={`leaderboard-row ${
                      entry.player.status === 'winner' ? 'is-winner' : ''
                    } ${entry.roundPoints > 0 ? 'is-awarded' : ''}`.trim()}
                    key={entry.player.id}
                    aria-label={`อันดับ ${index + 1} ${entry.player.name} ${entry.score} คะแนน${
                      entry.roundPoints > 0
                        ? ` ได้เพิ่ม ${entry.roundPoints} คะแนนรอบนี้`
                        : ''
                    }`}
                  >
                    <div className="leaderboard-copy">
                      <span className="leaderboard-rank" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div>
                        <strong>{entry.player.name}</strong>
                        <span>
                          {entry.placement !== null
                            ? `จบรอบนี้อันดับ ${entry.placement}`
                            : 'รอบนี้ยังไม่ได้คะแนน'}
                        </span>
                      </div>
                    </div>

                    <div className="leaderboard-score">
                      {entry.roundPoints > 0 ? (
                        <span className="leaderboard-delta">
                          +{entry.roundPoints} รอบนี้
                        </span>
                      ) : (
                        <span className="leaderboard-delta is-muted">
                          ยังไม่ได้คะแนน
                        </span>
                      )}
                      <strong>{entry.score} คะแนน</strong>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="action-row">
              <button
                type="button"
                className="primary-button symbol-button"
                onClick={handleReplaySamePlayers}
                aria-label="เล่นใหม่ด้วยรายชื่อเดิม"
                title="เล่นใหม่ด้วยรายชื่อเดิม"
              >
                <span className="button-symbol" aria-hidden="true">
                  ↺
                </span>
                <span className="button-copy">เดิม</span>
              </button>
              <button
                type="button"
                className="secondary-button symbol-button"
                onClick={handleResetAll}
                aria-label="เริ่มใหม่ทั้งหมด"
                title="เริ่มใหม่ทั้งหมด"
              >
                <span className="button-symbol" aria-hidden="true">
                  ⌂
                </span>
                <span className="button-copy">ใหม่</span>
              </button>
            </div>
          </section>

          <section className="summary-grid">
            {finalPlacements.map((player) => (
              <article
                className={`surface-card summary-card status-${player.status}`}
                key={player.id}
              >
                <div className="panel-header compact">
                  <div>
                    <p className="eyebrow">
                      {getPlayerStatusSymbol(player, null)}{' '}
                      {getPlayerStatusLabel(player, null)}
                    </p>
                    <h2>{player.name}</h2>
                  </div>
                  <span className="count-badge">{player.answers.length} คำ</span>
                </div>

                <div className="summary-copy">
                  {player.status === 'eliminated' ? (
                    <p>ตกรอบในรอบ {player.eliminatedAtRound}</p>
                  ) : (
                    <p>อยู่รอดจนจบเกม</p>
                  )}
                  <p
                    className={`summary-award ${
                      roundAwardMap.has(player.id) ? '' : 'is-muted'
                    }`.trim()}
                  >
                    {roundAwardMap.has(player.id)
                      ? `รับ ${roundAwardMap.get(player.id)?.points} คะแนนรอบนี้`
                      : 'รอบนี้ยังไม่ได้คะแนน'}
                  </p>
                </div>

                {player.answers.length > 0 ? (
                  <ul className="answer-list" aria-label={`คำตอบของ ${player.name}`}>
                    {player.answers.map((answer, index) => (
                      <li key={`${player.id}-${index}-${answer}`}>{answer}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-note">ยังไม่มีคำตอบที่ถูกบันทึก</p>
                )}
              </article>
            ))}
          </section>
        </section>
      )}
    </main>
  )
}

export default App

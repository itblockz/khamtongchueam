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
  advanceTurn,
  applyInputChange,
  createGameState,
  createInitialDrafts,
  createPlayerDraft,
  createSetupState,
  getSetupValidation,
  prepareRoster,
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

  return `พร้อมเริ่มเกม ${validation.playerCount} คน`
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

function App() {
  const [playerDrafts, setPlayerDrafts] = useState<PlayerDraft[]>(() =>
    ensureTrailingBlankDraft(createInitialDrafts()),
  )
  const [gameState, setGameState] = useState<GameState>(() => createSetupState())
  const answerInputRef = useRef<HTMLInputElement>(null)
  const playerInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingSetupFocusIdRef = useRef<string | null>(null)

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
  const totalAnswers = gameState.players.reduce(
    (sum, player) => sum + player.answers.length,
    0,
  )
  const isPausedTurn =
    gameState.phase === 'playing' &&
    gameState.activePlayerId !== null &&
    gameState.turnStartedAt === null &&
    !gameState.isSafeToFinish
  const canSubmitCurrentTurn =
    gameState.phase === 'playing' &&
    gameState.currentInput.trim().length > 0 &&
    (gameState.isSafeToFinish || gameState.timeLeftMs > 0)

  useTurnTimer({
    durationMs: TURN_DURATION_MS,
    active: gameState.phase === 'playing' && gameState.activePlayerId !== null,
    safeToFinish: gameState.phase === 'playing' && gameState.isSafeToFinish,
    startedAt: gameState.phase === 'playing' ? gameState.turnStartedAt : null,
    onTick: (timeLeftMs, startedAt) => {
      setGameState((current) => {
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
      setGameState((current) => {
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
    if (gameState.phase === 'playing') {
      answerInputRef.current?.focus()
    }
  }, [gameState.phase, gameState.activePlayerId])

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
    const pastedLines = event.clipboardData
      .getData('text')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (pastedLines.length <= 1) {
      return
    }

    event.preventDefault()

    setPlayerDrafts((current) => {
      const draftIndex = current.findIndex((draft) => draft.id === draftId)

      if (draftIndex === -1) {
        return current
      }

      const insertedDrafts = pastedLines.map((name) => createPlayerDraft(name))
      const nextDrafts = ensureTrailingBlankDraft([
        ...current.slice(0, draftIndex),
        ...insertedDrafts,
        ...current.slice(draftIndex + 1),
      ])
      const focusIndex = Math.min(
        draftIndex + insertedDrafts.length,
        nextDrafts.length - 1,
      )
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
          handleStartGame()
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

  function handleStartGame() {
    if (!validation.canStart) {
      return
    }

    setGameState(createGameState(prepareRoster(playerDrafts)))
  }

  function handleAnswerChange(event: ChangeEvent<HTMLInputElement>) {
    const { value } = event.target

    setGameState((current) => {
      if (current.phase !== 'playing') {
        return current
      }

      return applyInputChange(current, value)
    })
  }

  function handleSubmitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setGameState((current) => {
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

    setGameState(createGameState(prepareRoster(playerDrafts)))
  }

  function handleResetAll() {
    setPlayerDrafts(ensureTrailingBlankDraft(createInitialDrafts()))
    setGameState(createSetupState())
  }

  return (
    <main className="app-shell">
      {gameState.phase === 'setup' && (
        <section className="phase-screen setup-screen">
          <div className="surface-card setup-card">
            <div className="panel-header setup-header">
              <div className="setup-copy">
                <p className="eyebrow">เตรียมรายชื่อ</p>
                <h1>
                  <span className="headline-symbol" aria-hidden="true">
                    ＋
                  </span>
                  เพิ่มผู้เล่น
                </h1>
              </div>
              <button
                type="button"
                className="secondary-button symbol-button compact-symbol-button add-player-button"
                onClick={handleAddPlayer}
                aria-label="เพิ่มผู้เล่น"
                tabIndex={-1}
                title="เพิ่มผู้เล่น"
              >
                <span className="button-symbol" aria-hidden="true">
                  ＋
                </span>
              </button>
            </div>

            <p className="support-text setup-support">
              พิมพ์ชื่อแล้วกด Enter เพื่อไปแถวถัดไป, กด Enter บนแถวว่างท้ายเพื่อเริ่ม,
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
                <p>กดปุ่มเพิ่มผู้เล่นเพื่อเริ่มตั้งค่ารายชื่อ</p>
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
                onClick={handleStartGame}
                aria-label="เริ่มเกม"
                title="เริ่มเกม"
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
          <header className="surface-card spotlight-card">
            <div className="spotlight-copy">
              <p className="eyebrow">รอบที่ {gameState.round}</p>
              <h1>
                <span className="headline-symbol" aria-hidden="true">
                  ▶
                </span>
                ถึงตา {activePlayer.name}
              </h1>
              <p className="support-text">
                โฮสต์พิมพ์คำตอบตามที่ผู้เล่นพูด เมื่อคำจบแล้วค่อยส่งไปคนถัดไป
              </p>
            </div>

            <article
              className={`timer-card ${
                isPausedTurn
                  ? 'is-paused'
                  : gameState.isSafeToFinish
                  ? 'is-safe'
                  : gameState.timeLeftMs <= 1000
                    ? 'is-urgent'
                    : ''
              }`}
              aria-live="polite"
            >
              {isPausedTurn ? (
                <>
                  <span>คนก่อนหน้าแพ้</span>
                  <strong>ยังไม่เริ่มจับเวลา</strong>
                  <p>พิมพ์คำของ {activePlayer.name} แล้วกดถัดไป จากนั้นจึงเริ่มนับเวลาของคนถัดไป</p>
                </>
              ) : gameState.isSafeToFinish ? (
                <>
                  <span>ผ่านเวลาแล้ว</span>
                  <strong>เริ่มพิมพ์ทันเวลาแล้ว</strong>
                  <p>พิมพ์ต่อได้จนกว่าจะกดถัดไป</p>
                </>
              ) : (
                <>
                  <span>เวลาที่เหลือ</span>
                  <strong>{formatSeconds(gameState.timeLeftMs)} วินาที</strong>
                  <p>ถ้ายังไม่เริ่มพิมพ์เมื่อหมดเวลา ผู้เล่นจะตกรอบทันที</p>
                </>
              )}
            </article>
          </header>

          <form className="surface-card answer-panel" onSubmit={handleSubmitTurn}>
            <div className="form-copy">
              <p className="eyebrow">บันทึกคำตอบ</p>
              <label htmlFor="current-answer">คำตอบของ {activePlayer.name}</label>
              <p className="support-text">
                {isPausedTurn
                  ? `คนก่อนหน้าเพิ่งตกรอบ เทิร์นนี้ยังไม่จับเวลา พอส่งคำของ ${activePlayer.name} แล้วระบบจะเริ่มนับเวลาของคนถัดไป`
                  : 'เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ'}
              </p>
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
              />
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
            </div>
          </form>

          <section className="board-grid">
            <section className="surface-card board-card">
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

              <ul className="player-board" aria-label="ผู้เล่นที่ยังไม่ตกรอบ">
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

            <section className="surface-card board-card">
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
                <ul className="player-board" aria-label="ผู้เล่นที่ตกรอบ">
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
            {gameState.players.map((player) => (
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

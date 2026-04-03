import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
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
  playerDrafts: PlayerDraft[],
  validation: ReturnType<typeof getSetupValidation>,
) {
  if (playerDrafts.length < 2) {
    return 'ต้องมีผู้เล่นอย่างน้อย 2 คน'
  }

  if (validation.hasBlankNames) {
    return 'กรอกชื่อให้ครบทุกช่องก่อนเริ่มเกม'
  }

  if (validation.hasDuplicates) {
    return 'ชื่อผู้เล่นห้ามซ้ำหลังตัดช่องว่างหน้า-ท้าย'
  }

  return `พร้อมเริ่มเกม ${playerDrafts.length} คน`
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
    createInitialDrafts(),
  )
  const [gameState, setGameState] = useState<GameState>(() => createSetupState())
  const answerInputRef = useRef<HTMLInputElement>(null)

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
  const canSubmitCurrentTurn =
    gameState.phase === 'playing' &&
    gameState.currentInput.trim().length > 0 &&
    (gameState.isSafeToFinish || gameState.timeLeftMs > 0)

  const heroStats =
    gameState.phase === 'playing'
      ? [
          { label: 'รอบปัจจุบัน', value: `รอบ ${gameState.round}` },
          { label: 'ผู้เล่นที่เหลือ', value: `${activePlayers.length} คน` },
          { label: 'เวลาต่อเทิร์น', value: '3 วินาที' },
        ]
      : gameState.phase === 'finished' && winner
        ? [
            { label: 'ผู้ชนะ', value: winner.name },
            { label: 'จำนวนคำทั้งหมด', value: `${totalAnswers} คำ` },
            { label: 'รอบสุดท้าย', value: `รอบ ${gameState.round}` },
          ]
        : [
            { label: 'โหมดเล่น', value: 'โฮสต์คนเดียว' },
            { label: 'เวลาต่อคน', value: '3 วินาที' },
            { label: 'เงื่อนไขชนะ', value: 'เหลือคนสุดท้าย' },
          ]

  useTurnTimer({
    durationMs: TURN_DURATION_MS,
    active: gameState.phase === 'playing' && gameState.activePlayerId !== null,
    safeToFinish: gameState.phase === 'playing' && gameState.isSafeToFinish,
    startedAt: gameState.phase === 'playing' ? gameState.turnStartedAt : null,
    onTick: (timeLeftMs) => {
      setGameState((current) => {
        if (current.phase !== 'playing') {
          return current
        }

        return {
          ...current,
          timeLeftMs,
        }
      })
    },
    onExpire: () => {
      setGameState((current) => {
        if (current.phase !== 'playing' || current.isSafeToFinish) {
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

  function handlePlayerDraftChange(
    draftId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const { value } = event.target

    setPlayerDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId ? { ...draft, name: value } : draft,
      ),
    )
  }

  function handleAddPlayer() {
    setPlayerDrafts((current) => [...current, createPlayerDraft()])
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
    setPlayerDrafts((current) =>
      current.filter((draft) => draft.id !== draftId),
    )
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
    setPlayerDrafts(createInitialDrafts())
    setGameState(createSetupState())
  }

  return (
    <main className="app-shell">
      <div className="ambient-orb orb-left" aria-hidden="true" />
      <div className="ambient-orb orb-right" aria-hidden="true" />

      <header className="hero-banner">
        <div className="hero-copy">
          <p className="eyebrow">HOST-ONLY WORD CHAIN</p>
          <h1>คำต้องเชื่อม</h1>
          <p className="hero-text">
            โฮสต์คนเดียวควบคุมคิวผู้เล่น จับเวลา 3 วินาที และบันทึกคำตอบทีละคน
            ใครไม่เริ่มพิมพ์ในเวลาจะตกรอบทันที
          </p>
        </div>

        <div className="hero-stats" aria-label="ข้อมูลสรุปเกม">
          {heroStats.map((stat) => (
            <article className="stat-tile" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </div>
      </header>

      {gameState.phase === 'setup' && (
        <section className="screen-grid">
          <section className="panel panel-main">
            <div className="panel-header">
              <div>
                <p className="eyebrow">เตรียมรายชื่อ</p>
                <h2>เพิ่มผู้เล่น</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={handleAddPlayer}
              >
                เพิ่มผู้เล่น
              </button>
            </div>

            <p className="support-text">
              ตั้งชื่อ แก้ไขรายชื่อ และสลับลำดับได้ก่อนเริ่มเกมเท่านั้น
            </p>

            {playerDrafts.length > 0 ? (
              <ol className="draft-list">
                {playerDrafts.map((draft, index) => (
                  <li className="draft-item" key={draft.id}>
                    <span className="order-chip" aria-hidden="true">
                      {index + 1}
                    </span>

                    <div className="draft-field">
                      <label htmlFor={`player-${draft.id}`}>
                        ชื่อผู้เล่น {index + 1}
                      </label>
                      <input
                        id={`player-${draft.id}`}
                        className="text-input"
                        type="text"
                        value={draft.name}
                        onChange={(event) =>
                          handlePlayerDraftChange(draft.id, event)
                        }
                        placeholder="เช่น เมย์"
                        autoComplete="off"
                      />
                    </div>

                    <div className="draft-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleMovePlayer(draft.id, -1)}
                        disabled={index === 0}
                        aria-label={`เลื่อนผู้เล่น ${index + 1} ขึ้น`}
                      >
                        ขึ้น
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleMovePlayer(draft.id, 1)}
                        disabled={index === playerDrafts.length - 1}
                        aria-label={`เลื่อนผู้เล่น ${index + 1} ลง`}
                      >
                        ลง
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger-button"
                        onClick={() => handleRemovePlayer(draft.id)}
                        aria-label={`ลบผู้เล่น ${index + 1}`}
                      >
                        ลบ
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
                {getSetupMessage(playerDrafts, validation)}
              </p>

              <button
                type="button"
                className="primary-button"
                disabled={!validation.canStart}
                onClick={handleStartGame}
              >
                เริ่มเกม
              </button>
            </div>
          </section>

          <aside className="panel panel-side">
            <p className="eyebrow">กติกาย่อ</p>
            <h2>โฟลว์ของโฮสต์</h2>
            <ul className="rule-list">
              <li>เริ่มเทิร์นแล้วต้องเริ่มพิมพ์ภายใน 3 วินาที</li>
              <li>ถ้าเริ่มพิมพ์ทันเวลา จะพิมพ์ต่อได้นานเท่าที่ต้องการ</li>
              <li>กด Enter หรือปุ่มถัดไปเมื่อคำตอบจบแล้ว</li>
              <li>ใครไม่ทันจะตกรอบทันที เกมจบเมื่อเหลือผู้เล่นคนเดียว</li>
            </ul>
          </aside>
        </section>
      )}

      {gameState.phase === 'playing' && activePlayer && (
        <section className="playing-stack">
          <section className="panel spotlight-panel">
            <div className="spotlight-copy">
              <p className="eyebrow">รอบที่ {gameState.round}</p>
              <h2>ถึงตา {activePlayer.name}</h2>
              <p className="support-text">
                โฮสต์พิมพ์คำตอบตามที่ผู้เล่นพูด เมื่อคำจบแล้วค่อยส่งไปคนถัดไป
              </p>
            </div>

            <article
              className={`timer-card ${
                gameState.isSafeToFinish
                  ? 'is-safe'
                  : gameState.timeLeftMs <= 1000
                    ? 'is-urgent'
                    : ''
              }`}
              aria-live="polite"
            >
              {gameState.isSafeToFinish ? (
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
          </section>

          <form className="panel answer-form" onSubmit={handleSubmitTurn}>
            <div className="form-copy">
              <label htmlFor="current-answer">คำตอบของ {activePlayer.name}</label>
              <p>
                เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ
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
                className="primary-button"
                disabled={!canSubmitCurrentTurn}
              >
                ถัดไป
              </button>
            </div>
          </form>

          <section className="board-grid">
            <section className="panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">ยังอยู่ในเกม</p>
                  <h2>ลำดับผู้เล่น</h2>
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
                        <span>
                          {getPlayerStatusLabel(player, gameState.activePlayerId)}
                        </span>
                      </div>
                      <small>
                        {player.answers.length > 0
                          ? `ล่าสุด: ${player.answers.at(-1)}`
                          : 'ยังไม่มีคำตอบ'}
                      </small>
                    </li>
                  ))}
              </ul>
            </section>

            <section className="panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">หลุดออกจากเกม</p>
                  <h2>ผู้เล่นที่ตกรอบ</h2>
                </div>
                <span className="count-badge">{eliminatedPlayers.length} คน</span>
              </div>

              {eliminatedPlayers.length > 0 ? (
                <ul className="player-board" aria-label="ผู้เล่นที่ตกรอบ">
                  {eliminatedPlayers.map((player) => (
                    <li className={getPlayerCardClass(player, null)} key={player.id}>
                      <div>
                        <strong>{player.name}</strong>
                        <span>{getPlayerStatusLabel(player, null)}</span>
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
        <section className="result-stack">
          <section className="panel winner-panel">
            <p className="eyebrow">เกมจบแล้ว</p>
            <h2>ผู้ชนะคือ {winner.name}</h2>
            <p className="support-text">
              เหลือรอดเป็นผู้เล่นคนสุดท้ายจากทั้งหมด {gameState.players.length}{' '}
              คน
            </p>

            <div className="action-row">
              <button
                type="button"
                className="primary-button"
                onClick={handleReplaySamePlayers}
              >
                เล่นใหม่ด้วยรายชื่อเดิม
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleResetAll}
              >
                เริ่มใหม่ทั้งหมด
              </button>
            </div>
          </section>

          <section className="summary-grid">
            {gameState.players.map((player) => (
              <article
                className={`panel summary-card status-${player.status}`}
                key={player.id}
              >
                <div className="panel-header compact">
                  <div>
                    <p className="eyebrow">{getPlayerStatusLabel(player, null)}</p>
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

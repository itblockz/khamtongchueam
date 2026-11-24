import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SegmentError, segment } from './api'
import {
  addWord,
  JUDGE_REASON_LABEL,
  judgeReasonsAt,
  judgeOut,
  judgedText,
  needsWord,
  type JudgeReason,
  applyEdit,
  applyJudge,
  currentPlayer,
  describeChanges,
  nextPlayer,
  parseNames,
  parseSyllables,
  replay,
  STATUS_LABEL,
  startRound,
  undo,
  type GameState,
  type Round,
} from './game'

const PREVIEW_DELAY_MS = 250

interface TimerSettings {
  /** Time allowed from the start of a turn to the player's first sound. */
  seconds: number
}
const DEFAULT_TIMER: TimerSettings = { seconds: 3 }

/** idle: not counting yet · counting: since startedAt · spoke: first sound in time · late: time ran out */
type TimerState =
  | { phase: 'idle' }
  | { phase: 'counting'; startedAt: number }
  | { phase: 'spoke' }
  | { phase: 'late' }

export default function App() {
  const [namesText, setNamesText] = useState('')
  const [round, setRound] = useState<Round | null>(null)
  const [timer, setTimer] = useState<TimerSettings>(DEFAULT_TIMER)
  const game = useMemo(() => (round ? replay(round) : null), [round])

  if (!round || !game) {
    return (
      <Setup
        namesText={namesText}
        onNamesChange={setNamesText}
        timer={timer}
        onTimerChange={setTimer}
        onStart={(names) => setRound(startRound(names))}
      />
    )
  }

  const undoButton = (
    <button
      type="button"
      className="secondary"
      onClick={() => setRound(undo(round))}
      disabled={round.events.length === 0}
    >
      ย้อนกลับ
    </button>
  )

  if (game.winnerId) {
    const winner = game.players.find((player) => player.id === game.winnerId)
    return (
      <main className="page">
        <EliminationNotice game={game} />
        <h1 className="winner">{winner?.name} ชนะ</h1>
        <WordList round={round} game={game} onChange={setRound} />
        <div className="row">
          <button type="button" onClick={() => setRound(startRound(round.players.map((p) => p.name)))}>
            เล่นอีกรอบ
          </button>
          {undoButton}
          <button type="button" className="secondary" onClick={() => setRound(null)}>
            แก้รายชื่อ
          </button>
        </div>
      </main>
    )
  }

  return <Play round={round} game={game} onChange={setRound} undoButton={undoButton} timer={timer} />
}

function Setup({
  namesText,
  onNamesChange,
  onStart,
  timer,
  onTimerChange,
}: {
  namesText: string
  onNamesChange: (text: string) => void
  onStart: (names: string[]) => void
  timer: TimerSettings
  onTimerChange: (timer: TimerSettings) => void
}) {
  const { names, duplicates, canStart } = parseNames(namesText)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (canStart) {
      onStart(names)
    }
  }

  return (
    <main className="page">
      <h1>คำต้องเชื่อม</h1>
      <form className="stack" onSubmit={handleSubmit}>
        <label htmlFor="names">รายชื่อผู้เล่น (บรรทัดละคน เรียงตามลำดับเล่น)</label>
        <textarea
          id="names"
          rows={6}
          value={namesText}
          onChange={(event) => onNamesChange(event.target.value)}
          placeholder="ใส่ชื่อผู้เล่นบรรทัดละคน"
        />
        <p className={duplicates.length > 0 ? 'note error' : 'note'} role="status">
          {duplicates.length > 0
            ? `ชื่อซ้ำ: ${duplicates.join(', ')}`
            : names.length < 2
              ? 'ต้องมีผู้เล่นอย่างน้อย 2 คน'
              : `ผู้เล่น ${names.length} คน`}
        </p>
        <label htmlFor="seconds">เวลาต่อตา (วินาที)</label>
        <input
          id="seconds"
          type="number"
          inputMode="decimal"
          min={1}
          max={30}
          step={0.5}
          value={timer.seconds}
          onChange={(event) => {
            const seconds = Number(event.target.value)
            if (seconds > 0) onTimerChange({ ...timer, seconds })
          }}
        />
        <button type="submit" disabled={!canStart}>
          เริ่มเกม
        </button>
      </form>
    </main>
  )
}

function Play({
  round,
  game,
  onChange,
  undoButton,
  timer: settings,
}: {
  round: Round
  game: GameState
  onChange: (round: Round) => void
  undoButton: ReactNode
  timer: TimerSettings
}) {
  const [timer, setTimer] = useState<TimerState>({ phase: 'idle' })
  const [now, setNow] = useState(() => Date.now())
  /** Set when this screen sends a word or a decision, so the next turn can start counting. */
  const turnEnded = useRef(false)
  const eventCount = round.events.length

  const lastCounted = game.results.at(-1)?.status === 'counted'

  // A new turn starts counting as soon as the previous player's word is sent (they have
  // finished speaking). It waits for the judge's signal instead when someone just went
  // out, on the first turn, and after an undo or an edit.
  useEffect(() => {
    const auto = turnEnded.current && lastCounted
    turnEnded.current = false
    setTimer(auto ? { phase: 'counting', startedAt: Date.now() } : { phase: 'idle' })
    setNow(Date.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new turn
  }, [eventCount])

  useEffect(() => {
    if (timer.phase !== 'counting') return
    const id = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current - timer.startedAt >= settings.seconds * 1000) {
        setTimer({ phase: 'late' })
        navigator.vibrate?.(300)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [timer, settings.seconds])

  const remaining =
    timer.phase === 'counting' ? Math.max(0, settings.seconds - (now - timer.startedAt) / 1000) : 0

  const [word, setWord] = useState('')
  const [preview, setPreview] = useState<string[]>([])
  /** null: use the segmenter's split; otherwise the judge's correction (space separated). */
  const [manualSplit, setManualSplit] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const player = currentPlayer(game)
  const next = nextPlayer(game)

  // Live syllable preview while the judge types
  useEffect(() => {
    const text = word.trim()
    if (!text) {
      setPreview([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      segment(text, controller.signal)
        .then(setPreview)
        .catch(() => {
          /* preview is best-effort; submit reports errors */
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [word])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const text = word.trim()
    if (!text || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const manual = manualSplit !== null
      const syllables = manual ? parseSyllables(manualSplit) : await segment(text)
      if (syllables.length === 0) {
        setError('ใส่การแยกพยางค์ก่อนส่ง')
        return
      }
      turnEnded.current = true
      onChange(addWord(round, text, syllables, manual))
      setWord('')
      setPreview([])
      setManualSplit(null)
    } catch (caught) {
      setError(caught instanceof SegmentError ? caught.message : 'เชื่อมต่อระบบไม่ได้ ลองใหม่อีกครั้ง')
    } finally {
      setIsSubmitting(false)
      inputRef.current?.focus()
    }
  }

  return (
    <main className="page">
      <div className="turn">
        <span>
          ตาของ <strong>{player.name}</strong>
          <span className="next"> · ถัดไป {next.name}</span>
        </span>
        {undoButton}
      </div>

      <div className={`timer timer-${timer.phase}`} role="timer" aria-label="จับเวลา">
        {timer.phase === 'idle' && (
          <button
            type="button"
            className="big"
            onClick={() => {
              setNow(Date.now())
              setTimer({ phase: 'counting', startedAt: Date.now() })
            }}
          >
            เริ่มจับเวลา ({settings.seconds} วิ)
          </button>
        )}
        {timer.phase === 'counting' && (
          <button type="button" className="big" onClick={() => setTimer({ phase: 'spoke' })}>
            พูดแล้ว <span className="countdown">{remaining.toFixed(1)}</span>
          </button>
        )}
        {timer.phase === 'spoke' && <p className="note">พูดทันเวลา</p>}
        {timer.phase === 'late' && <p className="late">หมดเวลา</p>}
        {timer.phase !== 'idle' && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setNow(Date.now())
              setTimer({ phase: 'counting', startedAt: Date.now() })
            }}
          >
            จับเวลาใหม่
          </button>
        )}
        <button
          type="button"
          className={timer.phase === 'late' ? 'outline-danger selected' : 'outline-danger'}
          onClick={() => {
            turnEnded.current = true
            onChange(judgeOut(round, 'too-slow', word))
            setWord('')
            setPreview([])
            setManualSplit(null)
            setError(null)
          }}
        >
          ไม่ทันเวลา
        </button>
      </div>

      <form className="row" onSubmit={handleSubmit}>
        <label htmlFor="word" className="visually-hidden">
          คำของ {player.name}
        </label>
        <input
          id="word"
          ref={inputRef}
          value={word}
          onChange={(event) => {
            setWord(event.target.value)
            setManualSplit(null) // a correction belongs to the word it was made for
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="พิมพ์คำที่ผู้เล่นพูด"
        />
        <button type="submit" disabled={!word.trim() || isSubmitting}>
          ส่ง
        </button>
      </form>
      {manualSplit === null ? (
        <div className="split-row">
          <p className="syllables" aria-label="พยางค์ของคำที่พิมพ์">
            {preview.length > 0 ? preview.join(' | ') : ' '}
          </p>
          {word.trim() && (
            <button
              type="button"
              className="link"
              onClick={() => setManualSplit(preview.length > 0 ? preview.join(' ') : word.trim())}
            >
              แก้การแยก
            </button>
          )}
        </div>
      ) : (
        <div className="stack">
          <label htmlFor="split">แก้การแยกพยางค์ (เว้นวรรคระหว่างพยางค์)</label>
          <div className="row">
            <input
              id="split"
              value={manualSplit}
              onChange={(event) => setManualSplit(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
            <button type="button" className="secondary" onClick={() => setManualSplit(null)}>
              ใช้ของระบบ
            </button>
          </div>
          <p className="syllables">{parseSyllables(manualSplit).join(' | ') || ' '}</p>
        </div>
      )}
      <div className="row judge-actions">
        {judgeReasonsAt(game).filter(needsWord).map((reason) => (
          <button
            key={reason}
            type="button"
            className="outline-danger"
            disabled={!word.trim()}
            onClick={() => {
              turnEnded.current = true
              onChange(judgeOut(round, reason, word))
              setWord('')
              setPreview([])
              setManualSplit(null)
              setError(null)
              inputRef.current?.focus()
            }}
          >
            {JUDGE_REASON_LABEL[reason]}
          </button>
        ))}
      </div>
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}

      <EliminationNotice game={game} />

      <WordList round={round} game={game} onChange={onChange} />

      <p className="note">
        ยังเล่นอยู่: {game.players.filter((p) => !p.out).map((p) => p.name).join(', ')}
        {game.players.some((p) => p.out) &&
          ` · ตกรอบ: ${game.players.filter((p) => p.out).map((p) => p.name).join(', ')}`}
      </p>
    </main>
  )
}

function EliminationNotice({ game }: { game: GameState }) {
  const elimination = game.lastElimination
  if (!elimination) {
    return null
  }
  const name = game.players.find((player) => player.id === elimination.playerId)?.name
  return (
    <section className="elimination" role="status">
      <h2>{name} ตกรอบ</h2>
      {elimination.reason ? (
        <p>{judgedText(elimination.word, elimination.reason)}</p>
      ) : (
        <p>
          “{elimination.word}” ({elimination.syllables.join(' | ')})
        </p>
      )}
      <ul>
        {elimination.clashes.map((clash) => (
          <li key={clash.syllable}>
            “{clash.syllable}” ซ้ำกับคำ “{clash.word}”
          </li>
        ))}
      </ul>
    </section>
  )
}

type Pending = { round: Round; removed: Round['events'] }

/** What applying `pending` would change, in words, for the judge to confirm. */
function summarize(round: Round, game: GameState, pending: Pending | null): string[] {
  if (!pending || pending.round === round) return []
  const after = replay(pending.round)
  const lines: string[] = []
  if (pending.removed.length > 0) {
    lines.push(
      `ย้อนกลับไป${after.winnerId ? 'ตอนจบรอบ' : `ตาของ ${currentPlayer(after).name}`} · ลบ ${pending.removed.length} คำหลังจากนั้น: ${pending.removed.map((e) => e.word).join(', ')}`,
    )
  }
  lines.push(...describeChanges(game, after).filter((c) => !c.startsWith('คำ “') && !c.startsWith('ตาต่อไป')))
  return lines
}

function WordList({
  round,
  game,
  onChange,
}: {
  round: Round
  game: GameState
  onChange: (round: Round) => void
}) {
  const [open, setOpen] = useState<{ index: number; kind: 'split' | 'judge' } | null>(null)
  const [draft, setDraft] = useState('')
  const [reason, setReason] = useState<JudgeReason>('not-connected')

  if (game.results.length === 0) {
    return <p className="note">ยังไม่มีคำในรอบนี้</p>
  }
  const nameOf = (id: string) => game.players.find((player) => player.id === id)?.name ?? ''
  const draftSyllables = parseSyllables(draft)

  let pending: Pending | null = null
  if (open?.kind === 'split' && draftSyllables.length > 0) pending = applyEdit(round, open.index, draftSyllables)
  if (open?.kind === 'judge') pending = applyJudge(round, open.index, reason)
  const canSave = Boolean(pending && pending.round !== round)
  const changes = summarize(round, game, pending)

  return (
    <section>
      <h2 className="small-heading">คำในรอบนี้ (นับ {game.words.length})</h2>
      <ol className="words" reversed>
        {[...game.results].reverse().map((result) => (
          <li
            key={result.index}
            className={result.status === 'counted' || result.status === 'judged' ? '' : 'not-counted'}
          >
            <span className="word">{result.word}</span>
            <span className="word-syllables">{result.syllables.join(' | ')}</span>
            {result.manual && <span className="tag">แยกเอง</span>}
            <span className="word-player">{nameOf(result.playerId)}</span>
            {result.status !== 'judged' && STATUS_LABEL[result.status] && (
              <span className="tag status">{STATUS_LABEL[result.status]}</span>
            )}
            {result.status === 'judged' && result.reason && (
              <span className="tag status">{JUDGE_REASON_LABEL[result.reason]}</span>
            )}
            {open?.index !== result.index && result.status !== 'judged' && (
              <button
                type="button"
                className="link"
                aria-label={`แก้การแยก ${result.word}`}
                onClick={() => {
                  setOpen({ index: result.index, kind: 'split' })
                  setDraft(result.syllables.join(' '))
                }}
              >
                แก้
              </button>
            )}
            {open?.index !== result.index && result.status === 'counted' && (
              <button
                type="button"
                className="link"
                aria-label={`ตัดสิน ${result.word}`}
                onClick={() => {
                  setOpen({ index: result.index, kind: 'judge' })
                  setReason(judgeReasonsAt(game, result.index)[0])
                }}
              >
                ตัดสิน
              </button>
            )}
            {open?.index === result.index && (
              <div className="stack edit-box">
                {open.kind === 'split' ? (
                  <>
                    <label htmlFor={`edit-${result.index}`}>
                      แก้การแยก “{result.word}” (เว้นวรรคระหว่างพยางค์)
                    </label>
                    <input
                      id={`edit-${result.index}`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                    />
                    <p className="syllables">{draftSyllables.join(' | ') || ' '}</p>
                  </>
                ) : (
                  <div className="row" role="group" aria-label={`ตัดสิน “${result.word}”`}>
                    {judgeReasonsAt(game, result.index).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={reason === option ? 'outline-danger selected' : 'secondary'}
                        aria-pressed={reason === option}
                        onClick={() => setReason(option)}
                      >
                        {JUDGE_REASON_LABEL[option]}
                      </button>
                    ))}
                  </div>
                )}
                <div role="status">
                  {pending &&
                    (changes.length > 0 ? (
                      <ul className="changes">
                        {changes.map((change) => (
                          <li key={change}>{change}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="note">ไม่มีผลต่อเกม</p>
                    ))}
                </div>
                <div className="row">
                  <button
                    type="button"
                    disabled={!canSave}
                    onClick={() => {
                      if (pending && canSave) onChange(pending.round)
                      setOpen(null)
                    }}
                  >
                    {open.kind === 'judge' ? 'ยืนยัน' : 'บันทึก'}
                  </button>
                  <button type="button" className="secondary" onClick={() => setOpen(null)}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

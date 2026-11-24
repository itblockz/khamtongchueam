import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SegmentError, segment } from './api'
import {
  addWord,
  currentPlayer,
  describeChanges,
  editWord,
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

export default function App() {
  const [namesText, setNamesText] = useState('')
  const [round, setRound] = useState<Round | null>(null)
  const game = useMemo(() => (round ? replay(round) : null), [round])

  if (!round || !game) {
    return (
      <Setup
        namesText={namesText}
        onNamesChange={setNamesText}
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

  return <Play round={round} game={game} onChange={setRound} undoButton={undoButton} />
}

function Setup({
  namesText,
  onNamesChange,
  onStart,
}: {
  namesText: string
  onNamesChange: (text: string) => void
  onStart: (names: string[]) => void
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
          placeholder={'ออย\nบีม\nเจ'}
        />
        <p className={duplicates.length > 0 ? 'note error' : 'note'} role="status">
          {duplicates.length > 0
            ? `ชื่อซ้ำ: ${duplicates.join(', ')}`
            : names.length < 2
              ? 'ต้องมีผู้เล่นอย่างน้อย 2 คน'
              : `ผู้เล่น ${names.length} คน`}
        </p>
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
}: {
  round: Round
  game: GameState
  onChange: (round: Round) => void
  undoButton: ReactNode
}) {
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
      <p>
        “{elimination.word}” ({elimination.syllables.join(' | ')})
      </p>
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

function WordList({
  round,
  game,
  onChange,
}: {
  round: Round
  game: GameState
  onChange: (round: Round) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  if (game.results.length === 0) {
    return <p className="note">ยังไม่มีคำในรอบนี้</p>
  }
  const nameOf = (id: string) => game.players.find((player) => player.id === id)?.name ?? ''
  const draftSyllables = parseSyllables(draft)
  const edited = editing !== null && draftSyllables.length > 0 ? editWord(round, editing, draftSyllables) : null
  const changes = edited ? describeChanges(game, replay(edited)) : []

  return (
    <section>
      <h2 className="small-heading">คำที่ใช้แล้ว ({game.words.length})</h2>
      <ol className="words" reversed>
        {[...game.results].reverse().map((result) => (
          <li key={result.index} className={result.status === 'counted' ? '' : 'not-counted'}>
            <span className="word">{result.word}</span>
            <span className="word-syllables">{result.syllables.join(' | ')}</span>
            {result.manual && <span className="tag">แยกเอง</span>}
            <span className="word-player">{nameOf(result.playerId)}</span>
            {STATUS_LABEL[result.status] && <span className="tag status">{STATUS_LABEL[result.status]}</span>}
            {editing !== result.index && (
              <button
                type="button"
                className="link"
                aria-label={`แก้การแยก ${result.word}`}
                onClick={() => {
                  setEditing(result.index)
                  setDraft(result.syllables.join(' '))
                }}
              >
                แก้
              </button>
            )}
            {editing === result.index && (
              <div className="stack edit-box">
                <label htmlFor={`edit-${result.index}`}>แก้การแยก “{result.word}” (เว้นวรรคระหว่างพยางค์)</label>
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
                <div role="status">
                  {edited &&
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
                    disabled={!edited}
                    onClick={() => {
                      if (edited) onChange(edited)
                      setEditing(null)
                    }}
                  >
                    บันทึก
                  </button>
                  <button type="button" className="secondary" onClick={() => setEditing(null)}>
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

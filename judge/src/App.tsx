import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SegmentError, segment } from './api'
import {
  currentPlayer,
  nextPlayer,
  parseNames,
  parseSyllables,
  startGame,
  submitWord,
  type GameState,
} from './game'

const PREVIEW_DELAY_MS = 250

export default function App() {
  const [namesText, setNamesText] = useState('')
  const [game, setGame] = useState<GameState | null>(null)

  if (!game) {
    return (
      <Setup
        namesText={namesText}
        onNamesChange={setNamesText}
        onStart={(names) => setGame(startGame(names))}
      />
    )
  }

  if (game.winnerId) {
    const winner = game.players.find((player) => player.id === game.winnerId)
    return (
      <main className="page">
        <EliminationNotice game={game} />
        <h1 className="winner">{winner?.name} ชนะ</h1>
        <WordList game={game} />
        <div className="row">
          <button type="button" onClick={() => setGame(startGame(game.players.map((p) => p.name)))}>
            เล่นอีกรอบ
          </button>
          <button type="button" className="secondary" onClick={() => setGame(null)}>
            แก้รายชื่อ
          </button>
        </div>
      </main>
    )
  }

  return <Play game={game} onChange={setGame} />
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

function Play({ game, onChange }: { game: GameState; onChange: (game: GameState) => void }) {
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
      onChange(submitWord(game, text, syllables, manual))
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
      <p className="turn">
        <span>
          ตาของ <strong>{player.name}</strong>
        </span>
        <span className="next">ถัดไป {next.name}</span>
      </p>

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

      <WordList game={game} />

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

function WordList({ game }: { game: GameState }) {
  if (game.words.length === 0) {
    return <p className="note">ยังไม่มีคำในรอบนี้</p>
  }
  const nameOf = (id: string) => game.players.find((player) => player.id === id)?.name ?? ''
  return (
    <section>
      <h2 className="small-heading">คำที่ใช้แล้ว ({game.words.length})</h2>
      <ol className="words" reversed>
        {[...game.words].reverse().map((entry, index) => (
          <li key={`${entry.word}-${index}`}>
            <span className="word">{entry.word}</span>
            <span className="word-syllables">{entry.syllables.join(' | ')}</span>
            {entry.manual && <span className="tag">แยกเอง</span>}
            <span className="word-player">{nameOf(entry.playerId)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

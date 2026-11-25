import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SegmentError, segment, uploadGame } from './api'
import {
  deleteAccount,
  pullGames,
  pushGames,
  signInWithGoogle,
  signOut,
  watchAccount,
  type Account,
} from './cloud'
import { applyRemote, reconcile } from './sync'
import {
  anonymize,
  exportGames,
  fingerprint,
  loadSent,
  askToKeepStorage,
  loadGames,
  loadSettings,
  loadNames,
  saveNames,
  declinedMerge,
  markOwnersAssigned,
  ownersAssigned,
  setDeclinedMerge,
  loadTombstones,
  mergeGames,
  newId,
  parseExport,
  saveSent,
  saveSettings,
  saveTombstones,
  storeGames,
  type SavedGame,
} from './storage'
import {
  addWord,
  JUDGE_REASON_LABEL,
  JUDGE_REASONS,
  judgeOut,
  judgedText,
  needsWord,
  type JudgeReason,
  applyEdit,
  applyJudge,
  applyChallenge,
  canChallenge,
  defaultChallenger,
  describeChallenge,
  currentPlayer,
  describeChanges,
  describeClash,
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
const UPLOAD_DELAY_MS = 1500
const BACKUP_DELAY_MS = 2000

type BackupState = { status: 'idle' | 'syncing' | 'error' } | { status: 'done'; at: number }

/** Pressing a timer button must not take focus from the word input, or the phone
 * keyboard closes and the judge loses a beat reopening it. */
function keepFocus(event: { preventDefault: () => void }) {
  event.preventDefault()
}

interface TimerSettings {
  /** Time allowed from the start of a turn to the player's first sound. */
  seconds: number
}
const DEFAULT_TIMER: TimerSettings = { seconds: 3 }

/** idle: not counting yet · counting: since startedAt · late: time ran out.
 * The timer only guides the judge; it never puts anyone out by itself. */
type TimerState = { phase: 'idle' } | { phase: 'counting'; startedAt: number } | { phase: 'late' }

export default function App() {
  const [settings] = useState(loadSettings)
  const [namesText, setNamesText] = useState(settings.namesText ?? '')
  const [timer, setTimer] = useState<TimerSettings>({ seconds: settings.seconds ?? DEFAULT_TIMER.seconds })
  const [games, setGames] = useState<SavedGame[]>([])
  const [currentId, setCurrentId] = useState<string | null>(settings.currentId ?? null)
  /** Games come from IndexedDB, which answers asynchronously. */
  const [loaded, setLoaded] = useState(false)
  /** Set when the browser will not store games (some private modes). */
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    let cancelled = false
    askToKeepStorage()
    loadGames()
      .then((all) => {
        if (cancelled) return
        setGames(all)
        // a game carried over from an older version may have been opened while loading
        const wanted = loadSettings().currentId ?? null
        setCurrentId((id) => {
          const open = id ?? wanted
          return open && all.some((g) => g.id === open) ? open : null
        })
      })
      .catch(() => {
        if (!cancelled) setStorageError(true)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    saveSettings({ namesText: '', seconds: timer.seconds, currentId })
  }, [timer.seconds, currentId])

  // Write only the games that changed (and drop deleted ones) once loading is done
  const stored = useRef<Map<string, SavedGame> | null>(null)
  useEffect(() => {
    if (!loaded || storageError) return
    if (stored.current === null) {
      stored.current = new Map(games.map((g) => [g.id, g]))
      return
    }
    const previous = stored.current
    const changed = games.filter((g) => previous.get(g.id) !== g)
    const current = new Set(games.map((g) => g.id))
    const removed = [...previous.keys()].filter((id) => !current.has(id))
    stored.current = new Map(games.map((g) => [g.id, g]))
    storeGames(changed, removed).catch(() => setStorageError(true))
  }, [games, loaded, storageError])

  // Send changed games for collection, anonymously, a moment after they settle.
  // What the server already has is remembered across visits, so a send that failed
  // or was cut off by closing the tab is retried on the next change or next open.
  const sent = useRef<Map<string, string> | null>(null)
  const sending = useRef(new Set<string>())
  if (sent.current === null) sent.current = loadSent()
  const gamesRef = useRef(games)
  useEffect(() => {
    gamesRef.current = games
    const timer = window.setTimeout(() => {
      for (const g of games) {
        if (g.round.events.length === 0) continue
        const data = anonymize(g)
        const print = fingerprint(JSON.stringify(data))
        const key = `${g.id}:${print}`
        if (sent.current?.get(g.id) === print || sending.current.has(key)) continue
        sending.current.add(key)
        void uploadGame(g.id, data).then((ok) => {
          sending.current.delete(key)
          if (!ok || !sent.current) return
          sent.current.set(g.id, print)
          saveSent(sent.current, gamesRef.current)
        })
      }
    }, UPLOAD_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [games])

  // Optional Google sign-in: a signed-in judge's games are backed up to their account
  // and brought together with every other device signed in to it.
  const [account, setAccount] = useState<Account | null>(null)
  /** Sign-in state is read asynchronously; games are shown once it is known. */
  const [accountKnown, setAccountKnown] = useState(false)
  const [backup, setBackup] = useState<BackupState>({ status: 'idle' })
  const tombstones = useRef(loadTombstones())
  useEffect(
    () =>
      watchAccount((next) => {
        setAccount((prev) => (prev?.id === next?.id ? prev : next))
        setAccountKnown(true)
      }),
    [],
  )

  // Each game belongs to whoever played it: an account (owner = user id) or nobody
  // (played signed out). Only the games of whoever is using the app are shown and
  // backed up, so two accounts on one device never see or take each other's games.
  const ownerId = account?.id
  const mine = useMemo(() => games.filter((g) => g.owner === ownerId), [games, ownerId])
  const mineRef = useRef(mine)
  useEffect(() => {
    mineRef.current = mine
  }, [mine])
  const guestGames = useMemo(() => games.filter((g) => g.owner === undefined), [games])

  // The player-names box follows whoever is using the app, like their games
  const namesKey = ownerId ?? 'guest'
  const namesFor = useRef<string | null>(null)
  useEffect(() => {
    if (!accountKnown || namesFor.current === namesKey) return
    const first = namesFor.current === null
    namesFor.current = namesKey
    // names typed before this was kept per account go to whoever is using it now
    const next = loadNames(namesKey) ?? (first ? (settings.namesText ?? '') : '')
    setNamesText(next)
  }, [accountKnown, namesKey, settings.namesText])
  useEffect(() => {
    if (namesFor.current === namesKey) saveNames(namesKey, namesText)
  }, [namesText, namesKey])

  // Games saved before accounts existed belong to whoever was signed in at the time
  useEffect(() => {
    if (!loaded || !accountKnown || ownersAssigned()) return
    markOwnersAssigned()
    if (account) {
      setGames((all) => all.map((g) => (g.owner === undefined ? { ...g, owner: account.id } : g)))
    }
  }, [loaded, accountKnown, account])

  // A game open from another owner (after signing in or out) is closed
  useEffect(() => {
    if (!loaded || !accountKnown || currentId === null) return
    if (!mine.some((g) => g.id === currentId) && games.some((g) => g.id === currentId)) {
      setCurrentId(null)
    }
  }, [loaded, accountKnown, currentId, mine, games])

  const syncing = useRef(false)
  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!account || syncing.current) return false
    syncing.current = true
    setBackup({ status: 'syncing' })
    try {
      const remote = await pullGames()
      const result = reconcile(mineRef.current, tombstones.current, remote)
      if (result.take.length > 0 || result.remove.length > 0) {
        const owner = account.id
        const take = result.take.map((g) => ({ ...g, owner }))
        setGames((all) => [
          ...all.filter((g) => g.owner !== owner),
          ...applyRemote(
            all.filter((g) => g.owner === owner),
            take,
            result.remove,
          ),
        ])
      }
      await pushGames(result.push)
      tombstones.current = result.tombstones
      saveTombstones(tombstones.current)
      setBackup({ status: 'done', at: Date.now() })
      return true
    } catch {
      setBackup({ status: 'error' })
      return false
    } finally {
      syncing.current = false
    }
  }, [account])

  // Back up a moment after games change, and catch up when the app comes back to view
  useEffect(() => {
    if (!account || !loaded || storageError) return
    const timer = window.setTimeout(() => void syncNow(), BACKUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [account, loaded, storageError, games, syncNow])
  useEffect(() => {
    if (!account) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [account, syncNow])

  function removeGame(id: string) {
    if (account) {
      // tell the account (and its other devices) this game is gone
      tombstones.current = { ...tombstones.current, [id]: Date.now() }
      saveTombstones(tombstones.current)
    }
    setGames((all) => all.filter((g) => g.id !== id))
  }

  /** Signed-out games join the account that just signed in, if the judge says yes. */
  const [mergeAnswered, setMergeAnswered] = useState(false)
  const askMerge =
    account !== null &&
    ownersAssigned() &&
    !mergeAnswered &&
    guestGames.length > 0 &&
    !declinedMerge(account.id)
  function answerMerge(yes: boolean) {
    if (!account) return
    if (yes) {
      setGames((all) => all.map((g) => (g.owner === undefined ? { ...g, owner: account.id } : g)))
    } else {
      setDeclinedMerge(account.id)
    }
    setMergeAnswered(true)
  }

  /** Sign out. Keeps the account's games on this device (hidden) unless asked not to. */
  async function leave(removeFromDevice: boolean): Promise<'done' | 'not-backed-up'> {
    if (!account) return 'done'
    const owner = account.id
    if (removeFromDevice && !(await syncNow())) return 'not-backed-up'
    await signOut()
    if (removeFromDevice) setGames((all) => all.filter((g) => g.owner !== owner))
    setMergeAnswered(false)
    return 'done'
  }

  async function removeAccount() {
    if (!account) return
    const owner = account.id
    await deleteAccount()
    setGames((all) => all.filter((g) => g.owner !== owner))
  }

  const round = mine.find((g) => g.id === currentId)?.round ?? null
  const game = useMemo(() => (round ? replay(round) : null), [round])

  function setRound(next: Round) {
    setGames((all) => all.map((g) => (g.id === currentId ? { ...g, round: next, updatedAt: Date.now() } : g)))
  }

  function startGame(names: string[]) {
    const now = Date.now()
    const created: SavedGame = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      round: startRound(names),
      ...(ownerId ? { owner: ownerId } : {}),
    }
    setGames((all) => [created, ...all])
    setCurrentId(created.id)
  }

  const home = (
    <button type="button" className="secondary" onClick={() => setCurrentId(null)}>
      หน้าแรก
    </button>
  )

  if (!loaded || !accountKnown) {
    return (
      <main className="page">
        <p className="note">กำลังโหลด…</p>
      </main>
    )
  }

  if (!round || !game) {
    return (
      <Setup
        namesText={namesText}
        onNamesChange={setNamesText}
        timer={timer}
        onTimerChange={setTimer}
        onStart={startGame}
        games={mine}
        onOpen={setCurrentId}
        onDelete={removeGame}
        onImport={(incoming) => {
          // imported games belong to whoever is using the app now
          const owned = incoming.map((g) => {
            const copy: SavedGame = { id: g.id, createdAt: g.createdAt, updatedAt: g.updatedAt, round: g.round }
            return ownerId ? { ...copy, owner: ownerId } : copy
          })
          const result = mergeGames(mine, owned)
          const ids = new Set(result.games.map((g) => g.id))
          setGames((all) => [...all.filter((g) => !ids.has(g.id)), ...result.games])
          return result
        }}
        storageError={storageError}
        account={account}
        backup={backup}
        onBackupNow={() => void syncNow()}
        askMerge={askMerge ? guestGames.length : 0}
        onAnswerMerge={answerMerge}
        onSignOut={leave}
        onDeleteAccount={removeAccount}
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
        <div className="turn">
          <h1 className="winner">{winner?.name} ชนะ</h1>
          {undoButton}
        </div>
        <button type="button" onClick={() => startGame(round.players.map((p) => p.name))}>
          เล่นอีกรอบ
        </button>
        <EliminationNotice game={game} />
        <WordList round={round} game={game} onChange={setRound} />
        <div className="row">{home}</div>
      </main>
    )
  }

  return (
    <Play
      round={round}
      game={game}
      onChange={setRound}
      undoButton={undoButton}
      timer={timer}
      homeButton={home}
    />
  )
}

function Setup({
  namesText,
  onNamesChange,
  onStart,
  timer,
  onTimerChange,
  games,
  onOpen,
  onDelete,
  onImport,
  storageError,
  account,
  backup,
  onBackupNow,
  askMerge,
  onAnswerMerge,
  onSignOut,
  onDeleteAccount,
}: {
  namesText: string
  onNamesChange: (text: string) => void
  onStart: (names: string[]) => void
  timer: TimerSettings
  onTimerChange: (timer: TimerSettings) => void
  games: SavedGame[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onImport: (games: SavedGame[]) => { added: number; updated: number }
  storageError: boolean
  account: Account | null
  backup: BackupState
  onBackupNow: () => void
  askMerge: number
  onAnswerMerge: (yes: boolean) => void
  onSignOut: (removeFromDevice: boolean) => Promise<'done' | 'not-backed-up'>
  onDeleteAccount: () => Promise<void>
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
      <p className="note">
        แอปเก็บคำ การแยกพยางค์ และผลการตัดสินแบบไม่ระบุตัวตน (ไม่เก็บชื่อผู้เล่น)
        เพื่อใช้พัฒนาระบบ
      </p>
      {askMerge > 0 && (
        <section className="stack edit-box" role="dialog" aria-label="เพิ่มเกมเข้าบัญชี">
          <p>มีเกมที่เล่นไว้ในเครื่องนี้ตอนยังไม่ได้เข้าสู่ระบบ {askMerge} เกม เพิ่มเข้าบัญชีนี้ไหม</p>
          <div className="row">
            <button type="button" onClick={() => onAnswerMerge(true)}>
              เพิ่มเข้าบัญชี
            </button>
            <button type="button" className="secondary" onClick={() => onAnswerMerge(false)}>
              ไม่ต้อง
            </button>
          </div>
        </section>
      )}
      <BackupPanel
        account={account}
        backup={backup}
        onBackupNow={onBackupNow}
        onSignOut={onSignOut}
        onDeleteAccount={onDeleteAccount}
      />
      <SavedGames games={games} onOpen={onOpen} onDelete={onDelete} />
      {storageError && (
        <p className="note error" role="alert">
          เบราว์เซอร์นี้ไม่ให้บันทึกเกมในเครื่อง (อาจเปิดแบบส่วนตัวอยู่) เกมจะหายเมื่อปิดหน้า
          ส่งออกเป็นไฟล์ไว้ก่อนปิด
        </p>
      )}
      <BackupFile games={games} onImport={onImport} />
    </main>
  )
}

function Play({
  round,
  game,
  onChange,
  undoButton,
  timer: settings,
  homeButton,
}: {
  round: Round
  game: GameState
  onChange: (round: Round) => void
  undoButton: ReactNode
  timer: TimerSettings
  homeButton: ReactNode
}) {
  const [timer, setTimer] = useState<TimerState>({ phase: 'idle' })
  const [now, setNow] = useState(() => Date.now())
  /** Set when this screen sends a word or a decision, so the next turn can start counting. */
  const turnEnded = useRef(false)
  const events = round.events

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
  }, [events])

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

  function startTimer() {
    setNow(Date.now())
    setTimer({ phase: 'counting', startedAt: Date.now() })
    inputRef.current?.focus() // keep the keyboard up so the judge can type straight away
  }

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
      onChange(addWord(round, text, syllables, manual, manual ? preview : undefined))
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
      <p className="note">
        ยังเล่นอยู่: {game.players.filter((p) => !p.out).map((p) => p.name).join(', ')}
        {game.players.some((p) => p.out) &&
          ` · ตกรอบ: ${game.players.filter((p) => p.out).map((p) => p.name).join(', ')}`}
      </p>

      <div className={`timer timer-${timer.phase}`} role="timer" aria-label="จับเวลา">
        {timer.phase === 'idle' && (
          <button
            type="button"
            className="big"
            onPointerDown={keepFocus}
            onClick={startTimer}
          >
            เริ่มจับเวลา ({settings.seconds} วิ)
          </button>
        )}
        {timer.phase === 'counting' && (
          <p className="countdown">{remaining.toFixed(1)}</p>
        )}
        {timer.phase === 'late' && <p className="late">หมดเวลา</p>}
        {timer.phase !== 'idle' && (
          <button
            type="button"
            className="secondary"
            onPointerDown={keepFocus}
            onClick={startTimer}
          >
            จับเวลาใหม่
          </button>
        )}
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
        {JUDGE_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            className={
              reason === 'too-slow' && timer.phase === 'late' ? 'outline-danger selected' : 'outline-danger'
            }
            disabled={needsWord(reason) && !word.trim()}
            onPointerDown={keepFocus}
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

      <div className="row">{homeButton}</div>
    </main>
  )
}

const DATE_FORMAT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** Games kept in this browser: carry on with one in progress or look back at a finished one. */
function SavedGames({
  games,
  onOpen,
  onDelete,
}: {
  games: SavedGame[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (games.length === 0) return null
  const sorted = [...games].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <section>
      <h2 className="small-heading">เกมที่บันทึกไว้ในเครื่องนี้</h2>
      <p className="note">
        เก็บไว้ในเบราว์เซอร์ของเครื่องนี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์ เกมทั้งหมดจะหาย
        ส่งออกเป็นไฟล์ไว้ได้ถ้าอยากเก็บถาวร
      </p>
      <ul className="games">
        {sorted.map((saved) => {
          const state = replay(saved.round)
          const winner = state.players.find((p) => p.id === state.winnerId)
          const names = saved.round.players.map((p) => p.name).join(', ')
          return (
            <li key={saved.id}>
              <div>
                <strong>{winner ? `${winner.name} ชนะ` : `กำลังเล่น · ตาของ ${currentPlayer(state).name}`}</strong>
              </div>
              <div className="note">
                {DATE_FORMAT.format(saved.updatedAt)} · {state.words.length} คำ · {names}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="secondary"
                  aria-label={`${winner ? 'ดู' : 'เล่นต่อ'} ${names}`}
                  onClick={() => onOpen(saved.id)}
                >
                  {winner ? 'ดู' : 'เล่นต่อ'}
                </button>
                <button
                  type="button"
                  className="link"
                  aria-label={`ลบเกม ${names}`}
                  onClick={() => {
                    if (window.confirm('ลบเกมนี้? กู้คืนไม่ได้')) onDelete(saved.id)
                  }}
                >
                  ลบ
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const TIME_FORMAT = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' })

/** Sign in with Google to back games up to an account; playing never needs it. */
function BackupPanel({
  account,
  backup,
  onBackupNow,
  onSignOut,
  onDeleteAccount,
}: {
  account: Account | null
  backup: BackupState
  onBackupNow: () => void
  onSignOut: (removeFromDevice: boolean) => Promise<'done' | 'not-backed-up'>
  onDeleteAccount: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [removeHere, setRemoveHere] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!account) {
    return (
      <section className="stack">
        <h2 className="small-heading">สำรองเกม</h2>
        <p className="note">
          เข้าสู่ระบบด้วย Google เพื่อสำรองเกมไว้ในบัญชี และเปิดได้จากหลายเครื่อง
          ไม่เข้าสู่ระบบก็เล่นได้ตามปกติ
        </p>
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError(null)
              signInWithGoogle().catch(() => setError('เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง'))
            }}
          >
            เข้าสู่ระบบด้วย Google
          </button>
        </div>
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="stack">
      <h2 className="small-heading">สำรองเกม</h2>
      <p className="note">
        เข้าสู่ระบบเป็น {account.email ?? 'บัญชี Google'} · เกมทั้งหมดรวมชื่อผู้เล่นสำรองไว้ในบัญชีนี้
        เห็นได้เฉพาะคุณ
      </p>
      <p className={backup.status === 'error' ? 'note error' : 'note'} role="status">
        {backup.status === 'syncing'
          ? 'กำลังสำรอง…'
          : backup.status === 'done'
            ? `สำรองล่าสุด ${TIME_FORMAT.format(backup.at)}`
            : backup.status === 'error'
              ? 'สำรองไม่สำเร็จ (จะลองใหม่เองเมื่อเกมเปลี่ยนหรือเปิดแอปครั้งถัดไป)'
              : 'รอสำรอง'}
      </p>
      <div className="row">
        {backup.status === 'error' && (
          <button type="button" className="secondary" onClick={onBackupNow}>
            ลองอีกครั้ง
          </button>
        )}
        <button
          type="button"
          className="secondary"
          aria-expanded={leaving}
          onClick={() => {
            setLeaving(!leaving)
            setError(null)
          }}
        >
          ออกจากระบบ
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            if (
              window.confirm(
                'ลบบัญชีและเกมที่สำรองไว้ทั้งหมด? เกมที่อยู่ในเครื่องนี้ยังอยู่ แต่ข้อมูลในบัญชีจะกู้คืนไม่ได้',
              )
            ) {
              onDeleteAccount().catch(() => setError('ลบบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง'))
            }
          }}
        >
          ลบบัญชี
        </button>
      </div>
      {leaving && (
        <div className="stack edit-box">
          <label className="check">
            <input type="checkbox" checked={removeHere} onChange={(e) => setRemoveHere(e.target.checked)} />
            ลบเกมของบัญชีนี้ออกจากเครื่องนี้ด้วย (ถ้าใช้เครื่องคนอื่น)
          </label>
          <p className="note">
            {removeHere
              ? 'จะสำรองให้ครบก่อนลบ เข้าสู่ระบบอีกครั้งแล้วเกมจะกลับมา'
              : 'เกมของบัญชีนี้ยังอยู่ในเครื่องแต่จะไม่แสดง เข้าสู่ระบบอีกครั้งแล้วเห็นทันที'}
          </p>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError(null)
                void onSignOut(removeHere)
                  .then((result) => {
                    if (result === 'not-backed-up') {
                      setError('สำรองไม่สำเร็จ จึงยังไม่ได้ออกจากระบบ ลองใหม่เมื่อมีเน็ต หรือออกโดยไม่ลบเกม')
                    }
                  })
                  .finally(() => setBusy(false))
              }}
            >
              ยืนยันออกจากระบบ
            </button>
            <button type="button" className="secondary" onClick={() => setLeaving(false)}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** Keep games in a file, or bring them back (also moves games between devices). */
function BackupFile({
  games,
  onImport,
}: {
  games: SavedGame[]
  onImport: (games: SavedGame[]) => { added: number; updated: number }
}) {
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function download() {
    const blob = new Blob([JSON.stringify(exportGames(games))], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `khamtongchueam-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function read(file: File) {
    const incoming = parseExport(await file.text())
    if (!incoming) {
      setMessage('ไฟล์นี้ไม่ใช่ไฟล์เกมที่ส่งออกจากแอปนี้')
      return
    }
    const { added, updated } = onImport(incoming)
    setMessage(
      added + updated === 0
        ? 'ไม่มีเกมใหม่ในไฟล์นี้'
        : `นำเข้า ${added} เกมใหม่${updated > 0 ? ` · อัปเดต ${updated} เกม` : ''}`,
    )
  }

  return (
    <section className="stack">
      <div className="row">
        <button type="button" className="secondary" onClick={download} disabled={games.length === 0}>
          ส่งออกเกมทั้งหมด
        </button>
        <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
          นำเข้า
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="ไฟล์เกมที่จะนำเข้า"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void read(file)
          }}
        />
      </div>
      {message && (
        <p className="note" role="status">
          {message}
        </p>
      )}
    </section>
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
      {elimination.lostChallengeAt !== undefined ? (
        <p>{describeChallenge(elimination.word, elimination.lostChallengeAt)} ไม่สำเร็จ</p>
      ) : elimination.reason ? (
        <p>
          {judgedText(elimination.word, elimination.reason)}
          {elimination.challengerId && ` (ชาเลนจ์โดย ${game.players.find((p) => p.id === elimination.challengerId)?.name})`}
        </p>
      ) : (
        <p>
          “{elimination.word}” ({elimination.syllables.join(' | ')})
        </p>
      )}
      <ul>
        {elimination.clashes.map((clash) => (
          <li key={clash.syllable}>
            {describeClash(clash, game.players)}
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
  const [open, setOpen] = useState<{ index: number; kind: 'split' | 'judge' | 'challenge' } | null>(null)
  const [draft, setDraft] = useState('')
  /** No reason is picked in advance: the judge chooses each time. */
  const [reason, setReason] = useState<JudgeReason | null>(null)
  const [challengerId, setChallengerId] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState<boolean | null>(null)

  if (game.results.length === 0) {
    return <p className="note">ยังไม่มีคำในรอบนี้</p>
  }
  const nameOf = (id: string) => game.players.find((player) => player.id === id)?.name ?? ''
  const draftSyllables = parseSyllables(draft)

  let pending: Pending | null = null
  if (open?.kind === 'split' && draftSyllables.length > 0) pending = applyEdit(round, open.index, draftSyllables)
  if (open?.kind === 'judge' && reason) pending = applyJudge(round, open.index, reason)
  if (open?.kind === 'challenge' && challengerId && succeeded !== null) {
    pending = applyChallenge(round, open.index, challengerId, succeeded)
  }
  const canSave = Boolean(pending && pending.round !== round)
  const changes = summarize(round, game, pending)

  return (
    <section>
      <h2 className="small-heading">คำในรอบนี้ (นับ {game.words.length})</h2>
      <ol className="words" reversed>
        {[...game.results].reverse().map((result) => (
          <li
            key={result.index}
            className={
              ['counted', 'judged', 'challenge-lost'].includes(result.status) ? '' : 'not-counted'
            }
          >
            {result.status === 'challenge-lost' && result.targetIndex !== undefined ? (
              <div className="challenge-line">
                {describeChallenge(result.word, result.targetIndex)}
              </div>
            ) : (
              <div>
                <span className="word">{result.word}</span>
                <span className="word-syllables">{result.syllables.join(' | ')}</span>
              </div>
            )}
            {result.status === 'duplicate' && (
              <div className="clash-ref">
                {result.clashes.map((clash) => describeClash(clash, game.players)).join(', ')}
              </div>
            )}
            <div className="word-meta">
              <span className="word-player">{nameOf(result.playerId)}</span>
              {result.manual && <span className="tag">แยกเอง</span>}
              {result.status !== 'judged' && STATUS_LABEL[result.status] && (
                <span className="tag status">{STATUS_LABEL[result.status]}</span>
              )}
              {result.status === 'judged' && result.reason && (
                <span className="tag status">{JUDGE_REASON_LABEL[result.reason]}</span>
              )}
              {result.status === 'judged' && result.challengerId && (
                <span className="tag">ชาเลนจ์โดย {nameOf(result.challengerId)}</span>
              )}
              {open?.index !== result.index && result.status !== 'judged' && result.status !== 'challenge-lost' && (
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
                    setReason(null)
                  }}
                >
                  ตัดสิน
                </button>
              )}
              {open?.index !== result.index && canChallenge(game, result.index) && (
                <button
                  type="button"
                  className="link"
                  aria-label={`ชาเลนจ์ ${result.word}`}
                  onClick={() => {
                    setOpen({ index: result.index, kind: 'challenge' })
                    setChallengerId(defaultChallenger(game, result.index))
                    setSucceeded(null)
                  }}
                >
                  ชาเลนจ์
                </button>
              )}
            </div>
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
                ) : open.kind === 'challenge' ? (
                  <>
                    <p className="note">ชาเลนจ์ว่า “{result.word}” ไม่เชื่อม · ใครชาเลนจ์</p>
                    <div className="row" role="group" aria-label="คนชาเลนจ์">
                      {game.players
                        .filter((p) => !p.out && p.id !== result.playerId)
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={challengerId === p.id ? 'selected-choice' : 'secondary'}
                            aria-pressed={challengerId === p.id}
                            onClick={() => setChallengerId(p.id)}
                          >
                            {p.name}
                          </button>
                        ))}
                    </div>
                    <p className="note">ผล</p>
                    <div className="row" role="group" aria-label="ผลชาเลนจ์">
                      <button
                        type="button"
                        className={succeeded === true ? 'selected-choice' : 'secondary'}
                        aria-pressed={succeeded === true}
                        onClick={() => setSucceeded(true)}
                      >
                        สำเร็จ ({nameOf(result.playerId)} ตก)
                      </button>
                      <button
                        type="button"
                        className={succeeded === false ? 'selected-choice' : 'secondary'}
                        aria-pressed={succeeded === false}
                        onClick={() => setSucceeded(false)}
                      >
                        ไม่สำเร็จ{challengerId ? ` (${nameOf(challengerId)} ตก)` : ''}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="row" role="group" aria-label={`ตัดสิน “${result.word}”`}>
                    {JUDGE_REASONS.map((option) => (
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
                    {open.kind === 'split' ? 'บันทึก' : 'ยืนยัน'}
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

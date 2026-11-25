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
import { groupMatches, matchOf, viewMatch, type MatchView } from './match'
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
  type MatchInfo,
  type SavedGame,
} from './storage'
import {
  addOpening,
  MATCH_ROUNDS,
  nextRoundOrder,
  roundPoints,
  addWord,
  JUDGE_ID,
  MODE_LABEL,
  type GameMode,
  type RoundCell,
  type RoundEvent,
  JUDGE_REASON_LABEL,
  JUDGE_REASONS,
  judgeOut,
  judgedWithoutSplit,
  fillJudgedSplits,
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

type SignOutResult = { done: true } | { done: false; notBackedUp: number }

type BackupState = { status: 'idle' | 'syncing' | 'error' } | { status: 'done'; at: number }

/** Pressing a timer button must not take focus from the word input, or the phone
 * keyboard closes and the judge loses a beat reopening it. */
function keepFocus(event: { preventDefault: () => void }) {
  event.preventDefault()
}

interface TimerSettings {
  /** The mode new games start in (kept with the other setup choices). */
  mode: GameMode
  /** Rounds in a new match. */
  rounds: number
  /** Time allowed from the start of a turn to the player's first sound. */
  seconds: number
}
const DEFAULT_TIMER = { seconds: 3 }

/** idle: not counting yet · counting: since startedAt · late: time ran out.
 * The timer only guides the judge; it never puts anyone out by itself. */
type TimerState = { phase: 'idle' } | { phase: 'counting'; startedAt: number } | { phase: 'late' }

export default function App() {
  const [settings] = useState(loadSettings)
  const [namesText, setNamesText] = useState(settings.namesText ?? '')
  const [timer, setTimer] = useState<TimerSettings>({
    seconds: settings.seconds ?? DEFAULT_TIMER.seconds,
    mode: settings.mode ?? 'normal',
    rounds: settings.rounds ?? MATCH_ROUNDS[settings.mode ?? 'normal'],
  })
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
    saveSettings({ namesText: '', seconds: timer.seconds, mode: timer.mode, rounds: timer.rounds, currentId })
  }, [timer.seconds, timer.mode, timer.rounds, currentId])

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

  // Older games kept no split for words that were put out: work it out once and
  // write it back, so the word list shows it (and the change syncs like any edit).
  const splitTried = useRef(new Set<string>())
  useEffect(() => {
    if (!loaded) return
    const words = [
      ...new Set(games.flatMap((g) => judgedWithoutSplit(g.round))),
    ].filter((w) => !splitTried.current.has(w))
    if (words.length === 0) return
    for (const w of words) splitTried.current.add(w)
    void Promise.all(
      words.map((w) =>
        segment(w)
          .then((syllables): [string, string[]] => [w, syllables])
          .catch((): [string, string[]] => [w, []]),
      ),
    ).then((found) => {
      const splits = new Map(found.filter(([, syllables]) => syllables.length > 0))
      if (splits.size === 0) return
      const now = Date.now()
      setGames((all) =>
        all.map((g) => {
          const round = fillJudgedSplits(g.round, splits)
          return round === g.round ? g : { ...g, round, updatedAt: now }
        }),
      )
    })
  }, [games, loaded])

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
  /** Game id → the version (updatedAt) the account is known to have. */
  const backedUp = useRef(new Map<string, number>())
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
      const sentNow = mineRef.current
      await pushGames(result.push)
      // the account now has these versions: remember them to tell what is not backed up
      for (const g of [...sentNow, ...result.take]) {
        if ((backedUp.current.get(g.id) ?? -1) < g.updatedAt) backedUp.current.set(g.id, g.updatedAt)
      }
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
  // On signing in (or opening the app signed in), fetch the account's games at once
  useEffect(() => {
    if (!account || !loaded || storageError || !accountKnown) return
    void syncNow()
  }, [account, loaded, storageError, accountKnown, syncNow])
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

  /**
   * Sign out and remove the account's games from this device, after making sure the
   * account has them all ('backup-first'). If that backup fails, nothing happens and
   * the number of games not backed up is returned, so the judge can wait and retry,
   * or sign out anyway and give those up ('discard').
   */
  async function leave(how: 'backup-first' | 'discard'): Promise<SignOutResult> {
    if (!account) return { done: true }
    const owner = account.id
    if (how === 'backup-first' && !(await syncNow())) {
      const notBackedUp = mineRef.current.filter((g) => backedUp.current.get(g.id) !== g.updatedAt).length
      return { done: false, notBackedUp }
    }
    await signOut()
    setGames((all) => all.filter((g) => g.owner !== owner))
    backedUp.current = new Map()
    setMergeAnswered(false)
    return { done: true }
  }

  async function removeAccount() {
    if (!account) return
    const owner = account.id
    await deleteAccount()
    setGames((all) => all.filter((g) => g.owner !== owner))
  }

  const round = mine.find((g) => g.id === currentId)?.round ?? null
  const game = useMemo(() => (round ? replay(round) : null), [round])

  function storeRound(next: Round) {
    setGames((all) => all.map((g) => (g.id === currentId ? { ...g, round: next, updatedAt: Date.now() } : g)))
  }

  // Entries taken back with 'ย้อนกลับ', per game, newest last, so 'ทำซ้ำ' can put
  // them back. Any other change to the round makes them stale, so it clears them.
  const [redo, setRedo] = useState<Record<string, RoundEvent[]>>({})
  function setRound(next: Round) {
    if (currentId && redo[currentId]?.length) setRedo((all) => ({ ...all, [currentId]: [] }))
    storeRound(next)
  }

  /** Start a round: round 1 of a new match, or the next round of `match`. */
  function startGame(names: string[], mode: GameMode = timer.mode, match?: MatchInfo) {
    const now = Date.now()
    const created: SavedGame = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      round: startRound(names, mode),
      match: match ?? { id: newId(), round: 1, rounds: timer.rounds },
      ...(ownerId ? { owner: ownerId } : {}),
    }
    setGames((all) => [created, ...all])
    setCurrentId(created.id)
  }

  /** End a match early: it becomes as long as the rounds already played. */
  function endMatch(view: MatchView) {
    const played = matchOf(view.latest).round
    const ids = new Set(view.rounds.map((g) => g.id))
    const now = Date.now()
    setGames((all) =>
      all.map((g) => (ids.has(g.id) ? { ...g, match: { ...matchOf(g), rounds: played }, updatedAt: now } : g)),
    )
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
          // Imported games belong to whoever is using the app now. Importing is a
          // deliberate act, so a game not on this device counts as changed now: it
          // wins over an older deletion in the account instead of being removed again.
          const here = new Set(mine.map((g) => g.id))
          const now = Date.now()
          const owned = incoming.map((g) => {
            const copy: SavedGame = {
              id: g.id,
              createdAt: g.createdAt,
              updatedAt: here.has(g.id) ? g.updatedAt : Math.max(g.updatedAt, now),
              round: g.round,
              ...(g.match ? { match: g.match } : {}),
            }
            return ownerId ? { ...copy, owner: ownerId } : copy
          })
          const restored = owned.filter((g) => !here.has(g.id)).map((g) => g.id)
          if (restored.some((id) => id in tombstones.current)) {
            tombstones.current = Object.fromEntries(
              Object.entries(tombstones.current).filter(([id]) => !restored.includes(id)),
            )
            saveTombstones(tombstones.current)
          }
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

  const lastEvent = round.events.at(-1)
  const redoStack = (currentId && redo[currentId]) || []
  const toRedo = redoStack.at(-1)
  const undoButton = (
    <span className="undo-redo">
      <button
        type="button"
        className="secondary compact"
        aria-label={lastEvent ? `ย้อนกลับ: ${describeEntry(lastEvent)}` : 'ย้อนกลับ'}
        onClick={() => {
          if (!lastEvent || !currentId) return
          setRedo((all) => ({ ...all, [currentId]: [...(all[currentId] ?? []), lastEvent] }))
          storeRound(undo(round))
        }}
        disabled={!lastEvent}
      >
        <span aria-hidden="true">↶</span> {lastEvent ? describeEntry(lastEvent) : 'ย้อนกลับ'}
      </button>
      {toRedo && (
        <button
          type="button"
          className="secondary compact"
          aria-label={`ทำซ้ำ: ${describeEntry(toRedo)}`}
          onClick={() => {
            if (!currentId) return
            setRedo((all) => ({ ...all, [currentId]: redoStack.slice(0, -1) }))
            storeRound({ ...round, events: [...round.events, toRedo] })
          }}
        >
          <span aria-hidden="true">↷</span> {describeEntry(toRedo)}
        </button>
      )}
    </span>
  )

  if (game.winnerId) {
    const winner = game.players.find((player) => player.id === game.winnerId)
    const current = mine.find((g) => g.id === currentId)!
    const match = matchOf(current)
    const view = viewMatch(mine.filter((g) => matchOf(g).id === match.id))
    const mode = round.mode ?? 'normal'
    const names = round.players.map((p) => p.name)
    const nextRound = view.rounds.find((g) => matchOf(g).round === match.round + 1)
    const matchOver = match.round >= match.rounds
    const placings = roundPoints(game)
    const placed = (place: string) => [...placings.values()].find((p) => p.why.includes(place))?.name
    const runnersUp = [placed('ที่ 2') && `${placed('ที่ 2')} ที่ 2`, placed('ที่ 3') && `${placed('ที่ 3')} ที่ 3`]
      .filter(Boolean)
      .join(' · ')
    return (
      <main className="page">
        <div className="topbar">
          <span className="chip blue">
            {match.rounds > 1 ? `รอบ ${match.round}/${match.rounds} จบแล้ว` : 'จบเกม'}
          </span>
          {undoButton}
        </div>
        <section className="card result">
          <p className="note">{match.rounds > 1 ? 'ผู้ชนะรอบนี้' : 'ผู้ชนะ'}</p>
          <h1 className="winner">{winner?.name} ชนะ</h1>
          {runnersUp && <p className="note">{runnersUp}</p>}
          {nextRound ? (
            <button type="button" className="big" onClick={() => setCurrentId(nextRound.id)}>
              ไปรอบ {match.round + 1}
            </button>
          ) : matchOver ? (
            <button
              type="button"
              className="big"
              // a new match starts over in round 1's order, as the judge typed it
              onClick={() => startGame(view.rounds[0].round.players.map((p) => p.name), mode)}
            >
              เริ่มแมตช์ใหม่
            </button>
          ) : (
            <>
              <button
                type="button"
                className="big"
                onClick={() =>
                  startGame(nextRoundOrder(names, winner?.name ?? names[0]), mode, {
                    ...match,
                    round: match.round + 1,
                  })
                }
              >
                รอบถัดไป ({match.round + 1}/{match.rounds}) · {winner?.name} เริ่ม
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  if (window.confirm(`จบแมตช์ที่รอบ ${match.round}? คะแนนนับเฉพาะรอบที่เล่นแล้ว`)) endMatch(view)
                }}
              >
                จบแมตช์ตอนนี้
              </button>
            </>
          )}
        </section>
        <section className="card">
          <MatchTable view={view} currentId={currentId} onOpenRound={setCurrentId} />
        </section>
        <EliminationNotice game={game} />
        <section className="card">
          <WordList round={round} game={game} onChange={setRound} />
        </section>
        <div className="row">{home}</div>
      </main>
    )
  }

  const playing = matchOf(mine.find((g) => g.id === currentId)!)
  const playingView = viewMatch(mine.filter((g) => matchOf(g).id === playing.id))
  return (
    <Play
      matchLabel={playing.rounds > 1 ? `รอบ ${playing.round}/${playing.rounds}` : null}
      matchView={playingView}
      currentId={currentId}
      onOpenRound={setCurrentId}
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
  onSignOut: (how: 'backup-first' | 'discard') => Promise<SignOutResult>
  onDeleteAccount: () => Promise<void>
}) {
  const { names, duplicates, canStart } = parseNames(namesText)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (canStart) {
      onStart(names)
    }
  }

  const stepRounds = (by: number) =>
    onTimerChange({ ...timer, rounds: Math.min(20, Math.max(1, timer.rounds + by)) })
  const stepSeconds = (by: number) =>
    onTimerChange({ ...timer, seconds: Math.min(30, Math.max(1, timer.seconds + by)) })

  return (
    <main className="page">
      <div className="topbar">
        <h1>คำต้องเชื่อม</h1>
      </div>
      {askMerge > 0 && (
        <section className="card" role="dialog" aria-label="เพิ่มเกมเข้าบัญชี">
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
      <SavedGames games={games} onOpen={onOpen} onDelete={onDelete} part="continue" />

      <form className="card" onSubmit={handleSubmit}>
        <h2>เกมใหม่</h2>
        <div className="stack">
          <div className="card-head">
            <label htmlFor="names" className="label">
              ผู้เล่น
            </label>
            <span className={duplicates.length > 0 ? 'note error' : 'note'} role="status">
              {duplicates.length > 0
                ? `ชื่อซ้ำ: ${duplicates.join(', ')}`
                : names.length < 2
                  ? 'ต้องมีอย่างน้อย 2 คน'
                  : `${names.length} คน`}
            </span>
          </div>
          <textarea
            id="names"
            rows={4}
            value={namesText}
            onChange={(event) => onNamesChange(event.target.value)}
            placeholder="ใส่ชื่อผู้เล่นบรรทัดละคน"
          />
          <p className="note">บรรทัดละคน เรียงตามลำดับการเล่น</p>
        </div>
        <div className="stack">
          <span className="label">โหมด</span>
          <div className="segmented" role="group" aria-label="โหมด">
            {(['normal', 'competition'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={timer.mode === mode}
                onClick={() => onTimerChange({ ...timer, mode, rounds: MATCH_ROUNDS[mode] })}
              >
                {MODE_LABEL[mode]}
              </button>
            ))}
          </div>
          <p className="note">
            {timer.mode === 'normal'
              ? 'คนแรกพูดคำอะไรก็ได้ · มีคนตกรอบแล้วเริ่มคำใหม่'
              : 'กรรมการเลือกคำเปิด · มีคนตกรอบแล้วต้องเชื่อมกับคำล่าสุดต่อ'}
          </p>
        </div>
        <div className="card-head">
          <span className="label" id="rounds-label">
            จำนวนรอบ
          </span>
          <div className="stepper" role="group" aria-labelledby="rounds-label">
            <button type="button" aria-label="ลดจำนวนรอบ" onClick={() => stepRounds(-1)} disabled={timer.rounds <= 1}>
              −
            </button>
            <output aria-live="polite">{timer.rounds}</output>
            <button type="button" aria-label="เพิ่มจำนวนรอบ" onClick={() => stepRounds(1)} disabled={timer.rounds >= 20}>
              +
            </button>
          </div>
        </div>
        <div className="card-head">
          <span className="label" id="seconds-label">
            เวลาต่อตา
          </span>
          <div className="stepper" role="group" aria-labelledby="seconds-label">
            <button type="button" aria-label="ลดเวลาต่อตา" onClick={() => stepSeconds(-0.5)} disabled={timer.seconds <= 1}>
              −
            </button>
            <output aria-live="polite">{timer.seconds} วิ</output>
            <button type="button" aria-label="เพิ่มเวลาต่อตา" onClick={() => stepSeconds(0.5)} disabled={timer.seconds >= 30}>
              +
            </button>
          </div>
        </div>
        <button type="submit" className="big" disabled={!canStart}>
          เริ่มเกม
        </button>
      </form>

      <SavedGames games={games} onOpen={onOpen} onDelete={onDelete} part="history" />

      <section className="card">
        <h2>บัญชีและข้อมูล</h2>
        <BackupPanel
          account={account}
          backup={backup}
          onBackupNow={onBackupNow}
          onSignOut={onSignOut}
          onDeleteAccount={onDeleteAccount}
        />
        {storageError && (
          <p className="note error" role="alert">
            เบราว์เซอร์นี้ไม่ให้บันทึกเกมในเครื่อง (อาจเปิดแบบส่วนตัวอยู่) เกมจะหายเมื่อปิดหน้า
            ส่งออกเป็นไฟล์ไว้ก่อนปิด
          </p>
        )}
        <BackupFile games={games} onImport={onImport} />
        <p className="note">
          เกมเก็บในเบราว์เซอร์ของเครื่องนี้ ถ้าล้างข้อมูลเบราว์เซอร์จะหาย (ส่งออกเป็นไฟล์ หรือเข้าสู่ระบบเพื่อสำรอง)
        </p>
        <p className="note">
          แอปเก็บคำ การแยกพยางค์ และผลการตัดสินแบบไม่ระบุตัวตน (ไม่เก็บชื่อผู้เล่น) เพื่อใช้พัฒนาระบบ
        </p>
      </section>
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
  matchLabel,
  matchView,
  currentId,
  onOpenRound,
}: {
  round: Round
  game: GameState
  onChange: (round: Round) => void
  undoButton: ReactNode
  timer: TimerSettings
  homeButton: ReactNode
  matchLabel: string | null
  matchView: MatchView
  currentId: string | null
  onOpenRound: (id: string) => void
}) {
  const [showScores, setShowScores] = useState(false)
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
      onChange(
        game.needsOpening
          ? addOpening(round, text, syllables, manual, manual ? preview : undefined)
          : addWord(round, text, syllables, manual, manual ? preview : undefined),
      )
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
      <div className="topbar">
        <div className="row tight">
          {matchLabel && <span className="chip blue">{matchLabel}</span>}
          {game.mode === 'competition' && <span className="chip">โหมด{MODE_LABEL.competition}</span>}
          <button
            type="button"
            className="link"
            aria-expanded={showScores}
            onClick={() => setShowScores(!showScores)}
          >
            คะแนน
          </button>
        </div>
        {undoButton}
      </div>
      {showScores && (
        <section className="card">
          <MatchTable view={matchView} currentId={currentId} onOpenRound={onOpenRound} />
        </section>
      )}
      <div className="turn-head">
        {game.needsOpening ? (
          <>
            <div className="who">
              <strong>คำเปิด</strong>
            </div>
            <div className="next">กรรมการเลือก แล้ว {player.name} เริ่ม</div>
          </>
        ) : (
          <>
            <div className="who">
              ตาของ <strong>{player.name}</strong>
            </div>
            <div className="next">ถัดไป {next.name}</div>
          </>
        )}
      </div>
      <ul className="players" aria-label="ผู้เล่นในรอบนี้">
        {game.players.map((p) => (
          <li
            key={p.id}
            className={p.out ? 'out' : !game.needsOpening && p.id === player.id ? 'now' : undefined}
            aria-label={p.out ? `${p.name} (ตกรอบ)` : undefined}
          >
            {p.name}
          </li>
        ))}
      </ul>

      <section className="card">

      {!game.needsOpening && <div className={`timer timer-${timer.phase}`} role="timer" aria-label="จับเวลา">
        {timer.phase === 'idle' && (
          <button
            type="button"
            className="big"
            onPointerDown={keepFocus}
            onClick={startTimer}
          >
            เริ่มจับเวลา · {settings.seconds} วิ
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
      </div>}

      <form className="row" onSubmit={handleSubmit}>
        <label htmlFor="word" className="visually-hidden">
          {game.needsOpening ? 'คำเปิดของกรรมการ' : `คำของ ${player.name}`}
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
          placeholder={game.needsOpening ? 'พิมพ์คำเปิด' : 'พิมพ์คำที่ผู้เล่นพูด'}
        />
        <button type="submit" disabled={!word.trim() || isSubmitting}>
          ส่ง
        </button>
      </form>
      {manualSplit === null ? (
        word.trim() !== '' && <div className="split-row">
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
      {!game.needsOpening && <p className="note">ให้ตกรอบเพราะ</p>}
      {!game.needsOpening && (
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
                onChange(
                  judgeOut(round, reason, word, manualSplit !== null ? parseSyllables(manualSplit) : preview),
                )
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
      )}
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
      </section>

      <EliminationNotice game={game} />

      <section className="card">
        <WordList round={round} game={game} onChange={onChange} />
      </section>

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
/**
 * Saved matches. part 'continue' is a card for the most recent unfinished match;
 * part 'history' lists every other match.
 */
function SavedGames({
  games,
  onOpen,
  onDelete,
  part,
}: {
  games: SavedGame[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  part: 'continue' | 'history'
}) {
  const all = groupMatches(games)
  const resume = all.find((view) => !view.over)
  const matches = part === 'continue' ? (resume ? [resume] : []) : all.filter((view) => view !== resume)
  if (matches.length === 0) return null
  return (
    <section className={part === 'continue' ? 'card resume' : 'card'}>
      <h2>{part === 'continue' ? 'เล่นต่อ' : 'ประวัติเกม'}</h2>
      <ul className="games">
        {matches.map((view) => {
          const state = view.latestState
          const info = matchOf(view.latest)
          const names = view.rounds[0].round.players.map((p) => p.name).join(', ')
          const roundLabel = view.length > 1 ? `รอบ ${info.round}/${view.length} · ` : ''
          const status = view.over
            ? view.winners.length > 1
              ? `เสมอ: ${view.winners.join(', ')}`
              : `${view.winners[0]} ชนะ${view.length > 1 ? 'แมตช์' : ''}`
            : state.winnerId
              ? `${roundLabel}จบรอบแล้ว · รอรอบถัดไป`
              : state.needsOpening
                ? `${roundLabel}รอคำเปิด`
                : `${roundLabel}กำลังเล่น · ตาของ ${currentPlayer(state).name}`
          const scores = view.table
            .filter((row) => row.total > 0)
            .map((row) => `${row.name} ${row.total}`)
            .join(' · ')
          const updated = Math.max(...view.rounds.map((g) => g.updatedAt))
          return (
            <li key={view.id}>
              <div>
                <strong>{status}</strong>
              </div>
              {scores && <div className="note">คะแนน: {scores}</div>}
              <div className="note">
                {state.mode === 'competition' && `โหมด${MODE_LABEL.competition} · `}
                {DATE_FORMAT.format(updated)} · {names}
              </div>
              <div className="row">
                <button
                  type="button"
                  className={part === 'continue' ? undefined : 'secondary'}
                  aria-label={`${view.over ? 'ดู' : 'เล่นต่อ'} ${names}`}
                  onClick={() => onOpen(view.latest.id)}
                >
                  {view.over ? 'ดู' : 'เล่นต่อ'}
                </button>
                <button
                  type="button"
                  className="link"
                  aria-label={`ลบเกม ${names}`}
                  onClick={() => {
                    const what = view.rounds.length > 1 ? `แมตช์นี้ (${view.rounds.length} รอบ)` : 'เกมนี้'
                    if (window.confirm(`ลบ${what}? กู้คืนไม่ได้`)) {
                      for (const g of view.rounds) onDelete(g.id)
                    }
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
  onSignOut: (how: 'backup-first' | 'discard') => Promise<SignOutResult>
  onDeleteAccount: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  /** Set when the backup before signing out failed: how many games it would lose. */
  const [notBackedUp, setNotBackedUp] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  function leave(how: 'backup-first' | 'discard') {
    setBusy(true)
    setError(null)
    void onSignOut(how)
      .then((result) => setNotBackedUp(result.done ? null : result.notBackedUp))
      .catch(() => setError('ออกจากระบบไม่สำเร็จ ลองใหม่อีกครั้ง'))
      .finally(() => setBusy(false))
  }


  if (!account) {
    return (
      <section className="stack">
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
        {backup.status === 'error' && !leaving && (
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
            setNotBackedUp(null)
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
          <p className="note">
            เกมของบัญชีนี้จะถูกสำรองให้ครบ แล้วลบออกจากเครื่องนี้ เข้าสู่ระบบอีกครั้งแล้วเกมจะกลับมา
          </p>
          {notBackedUp !== null && (
            <p className="note error" role="alert">
              สำรองไม่สำเร็จ จึงยังไม่ได้ออกจากระบบ
              {notBackedUp > 0 ? ` มี ${notBackedUp} เกมที่ยังไม่ได้สำรอง` : ''} รอมีเน็ตแล้วลองอีกครั้ง
              หรือออกเลยโดยทิ้งเกมที่ยังไม่ได้สำรอง
            </p>
          )}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => leave('backup-first')}>
              {notBackedUp !== null ? 'ลองอีกครั้ง' : 'ยืนยันออกจากระบบ'}
            </button>
            {notBackedUp !== null && (
              <button
                type="button"
                className="outline-danger"
                disabled={busy}
                onClick={() => {
                  const lose = notBackedUp > 0 ? `${notBackedUp} เกมที่ยังไม่ได้สำรองจะหายถาวร` : 'เกมที่ยังไม่ได้สำรองจะหายถาวร'
                  if (window.confirm(`ออกจากระบบโดยไม่สำรอง? ${lose} ส่วนเกมที่สำรองแล้วยังอยู่ในบัญชี`)) {
                    leave('discard')
                  }
                }}
              >
                ออกและทิ้งเกมที่ยังไม่ได้สำรอง
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setLeaving(false)
                setNotBackedUp(null)
              }}
            >
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
          ส่งออกเป็นไฟล์
        </button>
        <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
          นำเข้าจากไฟล์
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

/** One round's points: placing, then '+N' for challenges in that round. */
function RoundScore({ cell }: { cell: RoundCell }) {
  return (
    <>
      {cell.placing ?? '–'}
      {cell.challenge > 0 && <span className="challenge-points"> +{cell.challenge}</span>}
    </>
  )
}

/** Points per round and the running total of a match (a tie when totals are equal). */
function MatchTable({
  view,
  currentId,
  onOpenRound,
}: {
  view: MatchView
  currentId?: string | null
  onOpenRound?: (id: string) => void
}) {
  return (
    <section>
      <h2 className="small-heading">
        {view.over && view.length > 1
          ? view.winners.length > 1
            ? `จบแมตช์ · เสมอ: ${view.winners.join(', ')}`
            : `จบแมตช์ · ${view.winners[0]} ชนะแมตช์`
          : 'คะแนน'}
      </h2>
      <table className="scores">
        <thead>
          <tr>
            <th scope="col">ผู้เล่น</th>
            {view.length === 1 && <th scope="col">คะแนน</th>}
            {view.length > 1 &&
              Array.from({ length: view.length }, (_, i) => {
                const played = view.rounds.find((g) => matchOf(g).round === i + 1)
                return (
                  <th scope="col" key={i}>
                    {played && onOpenRound && played.id !== currentId ? (
                      <button
                        type="button"
                        className="link"
                        aria-label={`ดูรอบ ${i + 1}`}
                        onClick={() => onOpenRound(played.id)}
                      >
                        {i + 1}
                      </button>
                    ) : (
                      <span className={played?.id === currentId ? 'current-round' : undefined}>{i + 1}</span>
                    )}
                  </th>
                )
              })}
            <th scope="col">รวม</th>
          </tr>
        </thead>
        <tbody>
          {view.table.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              {view.length === 1 && (
                <td>
                  <RoundScore cell={row.rounds[0]} />
                </td>
              )}
              {view.length > 1 &&
                row.rounds.map((cell, i) => (
                  <td key={i}>
                    <RoundScore cell={cell} />
                  </td>
                ))}
              <td>
                <strong>{row.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        ตัวเลข = อันดับ (ชนะ 3 · ที่ 2 และที่ 3 ได้ 1) · <span className="challenge-points">+N</span> =
        ชาเลนจ์สำเร็จในรอบนั้น (ครั้งละ 2)
      </p>
    </section>
  )
}

/** A short name for a log entry, for the undo and redo buttons. */
function describeEntry(event: RoundEvent): string {
  if (event.type === 'challenge-lost') return `ชาเลนจ์ “${event.word}”`
  if (event.type === 'judge') return event.word ? `“${event.word}” ${JUDGE_REASON_LABEL[event.reason]}` : JUDGE_REASON_LABEL[event.reason]
  return event.word
}

function EliminationNotice({ game }: { game: GameState }) {
  const elimination = game.lastElimination
  if (!elimination) {
    return null
  }
  const name = game.players.find((player) => player.id === elimination.playerId)?.name
  return (
    <section className="banner" role="status">
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
  const [open, setOpen] = useState<{ index: number; kind: 'split' | 'judge' | 'challenge'; word?: string } | null>(
    null,
  )
  const [draft, setDraft] = useState('')
  /** The spelling being corrected, and what the segmenter gives for it. */
  const [draftWord, setDraftWord] = useState('')
  const [autoSplit, setAutoSplit] = useState<string[] | null>(null)
  const [splitTouched, setSplitTouched] = useState(false)

  // A corrected spelling gets the segmenter's split, until the judge edits the split
  const wordChanged = open?.kind === 'split' && draftWord.trim() !== '' && draftWord.trim() !== open.word
  useEffect(() => {
    if (!wordChanged) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      segment(draftWord.trim(), controller.signal)
        .then((split) => {
          setAutoSplit(split)
          if (!splitTouched) setDraft(split.join(' '))
        })
        .catch(() => {
          /* keep whatever split is there */
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [wordChanged, draftWord, splitTouched])
  /** No reason is picked in advance: the judge chooses each time. */
  const [reason, setReason] = useState<JudgeReason | null>(null)
  const [challengerId, setChallengerId] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState<boolean | null>(null)
  /** The word whose ⋯ menu is open. */
  const [menuIndex, setMenuIndex] = useState<number | null>(null)

  if (game.results.length === 0) {
    return <p className="note">ยังไม่มีคำในรอบนี้</p>
  }
  const nameOf = (id: string) =>
    id === JUDGE_ID ? 'กรรมการ (คำเปิด)' : (game.players.find((player) => player.id === id)?.name ?? '')
  const draftSyllables = parseSyllables(draft)

  let pending: Pending | null = null
  if (open?.kind === 'split' && draftSyllables.length > 0) {
    const manual = !autoSplit || draftSyllables.join(' ') !== autoSplit.join(' ')
    pending = applyEdit(
      round,
      open.index,
      draftSyllables,
      wordChanged ? { word: draftWord, manual, ...(manual && autoSplit ? { segmented: autoSplit } : {}) } : {},
    )
  }
  if (open?.kind === 'judge' && reason) pending = applyJudge(round, open.index, reason)
  if (open?.kind === 'challenge' && challengerId && succeeded !== null) {
    pending = applyChallenge(round, open.index, challengerId, succeeded)
  }
  const canSave = Boolean(pending && pending.round !== round)
  const changes = summarize(round, game, pending)

  /** What the judge can do to an entry from its ⋯ menu. */
  const actionsFor = (result: GameState['results'][number]) => {
    const actions: ('split' | 'judge' | 'challenge')[] = []
    if (result.status !== 'judged' && result.status !== 'challenge-lost') actions.push('split')
    if (result.status === 'counted' && result.playerId !== JUDGE_ID) actions.push('judge')
    if (canChallenge(game, result.index)) actions.push('challenge')
    return actions
  }

  return (
    <>
      <div className="card-head">
        <h2>คำในรอบนี้</h2>
        <span className="note">นับ {game.words.length} คำ</span>
      </div>
      <ol className="words" reversed aria-label="คำในรอบนี้">
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
                {result.word ? (
                  <>
                    <span className="word">{result.word}</span>
                    <span className="word-syllables">{result.syllables.join(' | ')}</span>
                  </>
                ) : (
                  <span className="no-word">(ไม่ได้พูดคำ)</span>
                )}
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
            </div>
            {open?.index !== result.index && actionsFor(result).length > 0 && (
              <button
                type="button"
                className="more"
                aria-label={`ตัวเลือก ${result.word || nameOf(result.playerId)}`}
                aria-expanded={menuIndex === result.index}
                onClick={() => setMenuIndex(menuIndex === result.index ? null : result.index)}
              >
                ⋯
              </button>
            )}
            {menuIndex === result.index && open?.index !== result.index && (
              <div className="row menu">
                {actionsFor(result).includes('split') && (
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`แก้คำ ${result.word}`}
                    onClick={() => {
                      setMenuIndex(null)
                      setOpen({ index: result.index, kind: 'split', word: result.word })
                      setDraft(result.syllables.join(' '))
                      setDraftWord(result.word)
                      setAutoSplit(null)
                      setSplitTouched(false)
                    }}
                  >
                    แก้คำ
                  </button>
                )}
                {actionsFor(result).includes('judge') && (
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`ตัดสิน ${result.word}`}
                    onClick={() => {
                      setMenuIndex(null)
                      setOpen({ index: result.index, kind: 'judge' })
                      setReason(null)
                    }}
                  >
                    ตัดสิน
                  </button>
                )}
                {actionsFor(result).includes('challenge') && (
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`ชาเลนจ์ ${result.word}`}
                    onClick={() => {
                      setMenuIndex(null)
                      setOpen({ index: result.index, kind: 'challenge' })
                      setChallengerId(defaultChallenger(game, result.index))
                      setSucceeded(null)
                    }}
                  >
                    ชาเลนจ์
                  </button>
                )}
              </div>
            )}
            {open?.index === result.index && (
              <div className="stack edit-box">
                {open.kind === 'split' ? (
                  <>
                    <label htmlFor={`word-${result.index}`}>คำ (แก้ถ้าพิมพ์ผิด)</label>
                    <input
                      id={`word-${result.index}`}
                      value={draftWord}
                      onChange={(event) => {
                        setDraftWord(event.target.value)
                        setSplitTouched(false)
                      }}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <label htmlFor={`edit-${result.index}`}>
                      แก้การแยก “{wordChanged ? draftWord.trim() : result.word}” (เว้นวรรคระหว่างพยางค์)
                    </label>
                    <input
                      id={`edit-${result.index}`}
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value)
                        setSplitTouched(true)
                      }}
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
                    <p className="note">ผลตัดสิน</p>
                    <div className="row" role="group" aria-label="ผลตัดสิน">
                      <button
                        type="button"
                        className={succeeded === true ? 'selected-choice' : 'secondary'}
                        aria-pressed={succeeded === true}
                        onClick={() => setSucceeded(true)}
                      >
                        ไม่เชื่อม ({nameOf(result.playerId)} ตก)
                      </button>
                      <button
                        type="button"
                        className={succeeded === false ? 'selected-choice' : 'secondary'}
                        aria-pressed={succeeded === false}
                        onClick={() => setSucceeded(false)}
                      >
                        เชื่อม{challengerId ? ` (${nameOf(challengerId)} ตก)` : ''}
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
    </>
  )
}

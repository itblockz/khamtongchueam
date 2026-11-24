import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import App from './App'

const MATCH_ROUNDS_PER_MATCH = 3
const SEGMENTATION_DEBOUNCE_MS = 250
const CHALLENGE_SEGMENT_MS = 15000
const SEGMENTATION_ERROR_TEXT = 'ระบบแยกพยางค์ไม่พร้อมใช้งาน'
const GM_OPENING_WORD_STORAGE_KEY = 'khamtongchueam:gm-opening-word-enabled'

const mockSyllablesByText: Record<string, string[]> = {
  ก: ['ก'],
  กา: ['กา'],
  แฟ: ['แฟ'],
  กาแฟ: ['กา', 'แฟ'],
  กากี: ['กา', 'กี'],
  กล้วย: ['กล้วย'],
  สับปะรด: ['สับ', 'ปะ', 'รด'],
  ลำไย: ['ลำ', 'ไย'],
  เกา: ['เกา'],
  เก่า: ['เก่า'],
  คำตอบ: ['คำ', 'ตอบ'],
  ต้นไม้: ['ต้น', 'ไม้'],
  แกง: ['แกง'],
}

function getSetupEditorView() {
  const editorElement = document.querySelector('.cm-editor')
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error('Player name editor not found')
  }

  const view = EditorView.findFromDOM(editorElement)
  if (!view) {
    throw new Error('Player name editor view not found')
  }

  return view
}

/** Replace the player list editor's text (one name per line), as a GM typing or pasting. */
function setSetupText(text: string) {
  const view = getSetupEditorView()
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    })
  })
}

function fillSetupNames(playerNames: string[]) {
  setSetupText(playerNames.join('\n'))
}

function startTwoPlayerGame(firstPlayer: string, secondPlayer: string) {
  render(<App />)
  fillSetupNames([firstPlayer, secondPlayer])
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
  fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
}

function toggleSyllableDebug() {
  const settingsButton = screen.getByRole('button', { name: 'ตั้งค่าเกม' })
  fireEvent.click(settingsButton)
  const toggleButton = screen.queryByRole('button', { name: 'แสดงการแยกพยางค์' })

  expect(toggleButton).not.toBeNull()
  fireEvent.click(toggleButton!)
}

function getSettingsItem(name: string) {
  const item = screen.queryByRole('button', { name })
  if (item) {
    return item
  }
  fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าเกม' }))
  return screen.getByRole('button', { name })
}

function toggleGmOpeningWord() {
  const settingsButton = screen.getByRole('button', { name: 'ตั้งค่าเกม' })
  fireEvent.click(settingsButton)
  fireEvent.click(screen.getByRole('button', { name: 'พิธีกรเริ่ม' }))
}

function expectLeaderboardRow(
  playerName: string,
  expectedRoundScores: Array<number | string>,
  expectedTotal: number,
) {
  const leaderboard = within(screen.getByLabelText('ตารางคะแนนสะสม'))
  const row = leaderboard.getByLabelText(`คะแนนสะสมของ ${playerName}`)
  const cells = within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent?.trim())

  expect(cells).toEqual([
    ...expectedRoundScores.map((score) => String(score)),
    String(expectedTotal),
  ])
}

function getPlayerListItems(listLabel: string) {
  return within(screen.getByLabelText(listLabel)).getAllByRole('listitem')
}

function expectPlayerListOrder(listLabel: string, expectedNames: string[]) {
  const items = getPlayerListItems(listLabel)

  expect(
    items.map((item) => item.querySelector('strong')?.textContent?.trim()),
  ).toEqual(expectedNames)
}

function expectEliminatedPlayers(expectedNames: string[]) {
  const eliminated = getPlayerListItems('ลำดับผู้เล่น')
    .filter((item) => within(item).queryByText('ตกรอบ'))
    .map((item) => item.querySelector('strong')?.textContent?.trim())

  expect(eliminated).toEqual(expectedNames)
}

function expectCurrentTurnPlayer(listLabel: string, currentPlayerName: string) {
  const items = getPlayerListItems(listLabel)

  items.forEach((item) => {
    const playerName = item.querySelector('strong')?.textContent?.trim()

    if (playerName === currentPlayerName) {
      expect(within(item).getByText('ตอนนี้')).toBeInTheDocument()
      return
    }

    expect(within(item).queryByText('ตอนนี้')).not.toBeInTheDocument()
  })
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advanceTimers(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

async function flushSegmentationDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(SEGMENTATION_DEBOUNCE_MS)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function resumeChallengeSegmentIfNeeded() {
  const resumeButton =
    screen.queryByRole('button', { name: 'เริ่ม' }) ??
    screen.queryByRole('button', { name: 'ต่อ' })
  if (resumeButton) {
    fireEvent.click(resumeButton)
    await flushAsyncWork()
  }
}

/** Each debate segment waits for the host to press เริ่ม/ต่อ before its timer runs. */
async function advanceChallengeDebateToJudging() {
  for (let segment = 0; segment < 4; segment += 1) {
    await resumeChallengeSegmentIfNeeded()
    await advanceTimers(CHALLENGE_SEGMENT_MS)
  }
}

/** Enter first starts a waiting segment (เริ่ม/ต่อ), then a second Enter ends it. */
async function skipChallengeDebateSegments(segmentCount: number) {
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const isAwaitingStart =
      screen.queryByRole('button', { name: 'เริ่ม' }) ??
      screen.queryByRole('button', { name: 'ต่อ' })
    if (isAwaitingStart) {
      fireEvent.keyDown(window, { key: 'Enter' })
      await flushAsyncWork()
    }
    fireEvent.keyDown(window, { key: 'Enter' })
    await flushAsyncWork()
  }
}

async function typeChallengeChallengerKeys(keys: string) {
  const challengerInput = getChallengeChallengerInput()

  let nextValue = challengerInput.value

  for (const key of Array.from(keys)) {
    nextValue += key
    fireEvent.change(challengerInput, {
      target: { value: nextValue },
    })
    await flushAsyncWork()
  }

  return challengerInput
}

function getChallengeChallengerInput() {
  return screen.getByRole('combobox', {
    name: 'พิมพ์ชื่อผู้ชาเลนจ์',
  }) as HTMLInputElement
}

function getActiveChallengeChallengerOption() {
  const activeOptionId =
    getChallengeChallengerInput().getAttribute('aria-activedescendant')

  if (activeOptionId) {
    return document.getElementById(activeOptionId) as HTMLElement
  }

  const selectedOption = within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .find(
      (option) =>
        option.getAttribute('aria-selected') === 'true' ||
        option.getAttribute('data-selected') !== null,
    )

  expect(selectedOption).toBeDefined()

  return selectedOption as HTMLElement
}

function expectSelectedChallengeChallenger(playerName: string) {
  expect(getActiveChallengeChallengerOption().textContent?.trim()).toBe(
    playerName,
  )
}

function getChallengeChallengerOptionLabels() {
  return within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent?.trim())
}

// While the challenger combobox popover is open, react-aria hides the rest of
// the page from assistive tech (aria-hidden), so look up hidden elements too.
function getChallengeTargetGroup() {
  return screen.getByRole('group', { name: 'คำที่ถูกชาเลนจ์', hidden: true })
}

function getSelectedChallengeTarget() {
  return within(getChallengeTargetGroup())
    .getAllByRole('button', { hidden: true })
    .find((button) => button.getAttribute('aria-pressed') === 'true')
    ?.textContent?.trim()
}

function selectChallengeTarget(answerText: string) {
  fireEvent.click(
    within(getChallengeTargetGroup()).getByRole('button', {
      name: answerText,
      hidden: true,
    }),
  )
}

async function waitForTurn(playerName: string) {
  await flushAsyncWork()
  expect(
    screen.getByRole('heading', { name: `ถึงตา ${playerName}` }),
  ).toBeInTheDocument()
}

async function waitForLeaderboard() {
  await flushAsyncWork()
  expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
}

async function acknowledgeEliminationIfNeeded() {
  const continueButton = screen.queryByRole('button', { name: 'ไปต่อ' })
  if (continueButton) {
    fireEvent.click(continueButton)
    await flushAsyncWork()
  }
}

async function announceWinnerIfNeeded() {
  const announceButton = screen.queryByRole('button', { name: 'ประกาศผู้ชนะ' })
  if (announceButton) {
    fireEvent.click(announceButton)
    await flushAsyncWork()
  }
}

async function openRoundSummary() {
  await announceWinnerIfNeeded()
  fireEvent.click(screen.getByRole('button', { name: 'สรุปรอบ' }))
  await flushAsyncWork()
}

async function submitAnswer(playerName: string, answer: string) {
  fireEvent.change(screen.getByLabelText(`คำตอบของ ${playerName}`), {
    target: { value: answer },
  })
  fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))
  await flushAsyncWork()
}

function getUndoButton() {
  return screen.getByRole('button', { name: 'ย้อนกลับ' })
}

function getRedoButton() {
  return screen.getByRole('button', { name: 'ทำซ้ำ' })
}

async function triggerUndoShortcut(target: Element | Document | Window = window) {
  fireEvent.keyDown(target, { key: 'z', ctrlKey: true })
  await flushAsyncWork()
}

async function triggerRedoShortcut(target: Element | Document | Window = window) {
  fireEvent.keyDown(target, { key: 'Z', ctrlKey: true, shiftKey: true })
  await flushAsyncWork()
}

describe('คำต้องเชื่อม', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00.000Z'))
    window.localStorage.clear()
    window.localStorage.setItem(GM_OPENING_WORD_STORAGE_KEY, 'false')

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const payload =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as { text?: string })
            : {}
        const text = payload.text?.trim() ?? ''

        if (text === 'ปิดระบบ') {
          return {
            ok: false,
            status: 503,
            json: async () => ({ detail: SEGMENTATION_ERROR_TEXT }),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            syllables: mockSyllablesByText[text] ?? [text],
            engine: 'han_solo',
            mode: 'written',
            modelVersion: 'pythainlp-test; engine=han_solo',
          }),
        }
      }),
    )
  })

  afterEach(async () => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('requires at least two non-blank names and trims each line', () => {
    render(<App />)
    const confirmButton = screen.getByRole('button', { name: 'ยืนยันผู้เล่น' })

    expect(confirmButton).toBeDisabled()
    expect(screen.getByText('ต้องมีผู้เล่นอย่างน้อย 2 คน')).toBeInTheDocument()

    setSetupText('ออย\n\n   \n')
    expect(confirmButton).toBeDisabled()

    setSetupText('  ออย  \n\nบีม\n')
    expect(confirmButton).toBeEnabled()
    expect(screen.getByText('พร้อมยืนยันผู้เล่น 2 คน')).toBeInTheDocument()

    fireEvent.click(confirmButton)

    expect(screen.getByRole('heading', { name: 'ถึงตา ออย' })).toBeInTheDocument()
  })

  it('blocks confirming when two names are the same after trimming', () => {
    render(<App />)
    const confirmButton = screen.getByRole('button', { name: 'ยืนยันผู้เล่น' })

    setSetupText('ออย\nบีม\n  ออย ')

    expect(confirmButton).toBeDisabled()
    expect(screen.getByText('ชื่อซ้ำ: ออย แก้ให้ไม่ซ้ำก่อนยืนยัน')).toBeInTheDocument()

    setSetupText('ออย\nบีม\nออย 2')

    expect(confirmButton).toBeEnabled()
    expect(screen.getByText('พร้อมยืนยันผู้เล่น 3 คน')).toBeInTheDocument()
  })

  it('shows the word collection notice on setup and lets the host turn it off', () => {
    render(<App />)

    expect(
      screen.getByText(/คำที่ส่งเป็นคำตอบจะถูกเก็บแบบไม่ระบุตัวตน/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ปิดการเก็บคำ' }))

    expect(
      screen.getByText(/ปิดการเก็บคำเพื่อปรับปรุงการแยกพยางค์อยู่/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เปิดการเก็บคำ' })).toBeInTheDocument()
    expect(
      window.localStorage.getItem('khamtongchueam:syllable-feedback-enabled'),
    ).toBe('false')
  })

  it('confirms players without starting the first timer immediately', async () => {
    render(<App />)
    fillSetupNames(['ออย', 'บีม'])

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ออย')).toBeDisabled()

    await advanceTimers(5000)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ออย')).toBeDisabled()
  })

  it('focuses the first-turn start button and lets Enter start the first round', async () => {
    render(<App />)
    fillSetupNames(['ออย', 'บีม'])

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    const startFirstTurnButton = screen.getByRole('button', {
      name: 'เริ่มรอบแรก',
    })

    expect(startFirstTurnButton).toHaveFocus()

    fireEvent.keyDown(startFirstTurnButton, { key: 'Enter', code: 'Enter' })

    expect(screen.getByLabelText('คำตอบของ ออย')).toBeEnabled()

    await advanceTimers(3100)

    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toHaveFocus()
    await openRoundSummary()
    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
  })

  it('keeps the GM opening word toggle on by default and respects localStorage', () => {
    window.localStorage.removeItem(GM_OPENING_WORD_STORAGE_KEY)

    const firstRender = render(<App />)
    fillSetupNames(['ออย', 'บีม'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าเกม' }))
    const toggleButton = screen.getByRole('button', { name: 'พิธีกรเริ่ม' })

    expect(toggleButton).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem(GM_OPENING_WORD_STORAGE_KEY)).toBe('true')
    expect(screen.getByLabelText('คำแรกจากพิธีกร')).toBeEnabled()

    fireEvent.click(toggleButton)

    expect(toggleButton).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem(GM_OPENING_WORD_STORAGE_KEY)).toBe('false')

    firstRender.unmount()

    render(<App />)
    fillSetupNames(['ออย', 'บีม'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าเกม' }))
    expect(
      screen.getByRole('button', { name: 'พิธีกรเริ่ม' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('คำตอบของ ออย')).toBeDisabled()
  })

  it('lets the GM submit an opening word before the first turn and starts the round immediately', async () => {
    window.localStorage.removeItem(GM_OPENING_WORD_STORAGE_KEY)

    render(<App />)
    fillSetupNames(['ออย', 'บีม'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    const gmOpeningInput = screen.getByLabelText('คำแรกจากพิธีกร')

    expect(gmOpeningInput).toBeEnabled()
    expect(screen.getByRole('button', { name: 'เริ่มด้วยคำนี้' })).toBeInTheDocument()
    expect(screen.getByText('รอคำแรก')).toBeInTheDocument()

    fireEvent.change(gmOpeningInput, { target: { value: 'กาแฟ' } })
    await flushSegmentationDebounce()
    toggleSyllableDebug()

    fireEvent.submit(gmOpeningInput.closest('form')!)
    await flushAsyncWork()

    expect(screen.queryByRole('button', { name: 'เริ่มรอบแรก' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ออย')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeDisabled()

    const usedSyllablesDebug = within(
      screen.getByLabelText('พยางค์ที่บันทึกในรอบนี้'),
    )

    expect(usedSyllablesDebug.getByText('กา')).toBeInTheDocument()
    expect(usedSyllablesDebug.getByText('แฟ')).toBeInTheDocument()
  })

  it('shows a backend segmentation error for the GM opening word without starting the round', async () => {
    window.localStorage.removeItem(GM_OPENING_WORD_STORAGE_KEY)

    render(<App />)
    fillSetupNames(['เอ', 'บี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    const gmOpeningInput = screen.getByLabelText('คำแรกจากพิธีกร')

    fireEvent.change(gmOpeningInput, { target: { value: 'ปิดระบบ' } })
    fireEvent.submit(gmOpeningInput.closest('form')!)
    await flushAsyncWork()

    expect(screen.getByRole('alert')).toHaveTextContent(SEGMENTATION_ERROR_TEXT)
    expect(screen.getByRole('heading', { name: 'ถึงตา เอ' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำแรกจากพิธีกร')).toHaveValue('ปิดระบบ')
    expect(screen.getByRole('button', { name: 'เริ่มด้วยคำนี้' })).toBeEnabled()
  })

  it('clears the GM opening word draft when the toggle is turned off before the round starts', async () => {
    window.localStorage.removeItem(GM_OPENING_WORD_STORAGE_KEY)

    render(<App />)
    fillSetupNames(['เอ', 'บี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    const gmOpeningInput = screen.getByLabelText('คำแรกจากพิธีกร')

    fireEvent.change(gmOpeningInput, { target: { value: 'กาแฟ' } })
    await flushSegmentationDebounce()
    toggleGmOpeningWord()

    expect(getSettingsItem('พิธีกรเริ่ม')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ เอ')).toHaveValue('')
    expect(screen.getByLabelText('คำตอบของ เอ')).toBeDisabled()
    expect(screen.queryByText('รอคำแรก')).not.toBeInTheDocument()
  })

  it('keeps the GM opening word toggle enabled across replay and asks for a fresh opening word next round', async () => {
    window.localStorage.removeItem(GM_OPENING_WORD_STORAGE_KEY)

    render(<App />)
    fillSetupNames(['ออย', 'บีม'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    const gmOpeningInput = screen.getByLabelText('คำแรกจากพิธีกร')

    fireEvent.change(gmOpeningInput, { target: { value: 'กาแฟ' } })
    fireEvent.submit(gmOpeningInput.closest('form')!)
    await flushAsyncWork()
    await advanceTimers(3100)
    await openRoundSummary()

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าเกม' }))
    expect(
      screen.getByRole('button', { name: 'พิธีกรเริ่ม' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('คำแรกจากพิธีกร')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'เริ่มด้วยคำนี้' })).toBeInTheDocument()
  })

  it('eliminates the current player when no input is started within 3 seconds', async () => {
    startTwoPlayerGame('ออย', 'บีม')

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()

    await advanceTimers(3100)

    expect(screen.getByRole('heading', { name: 'ถึงตา บีม' })).toBeInTheDocument()
    expect(screen.getByText('ออย ตกรอบเพราะไม่ทันเวลา')).toBeInTheDocument()
    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    await openRoundSummary()
    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
    expectLeaderboardRow('บีม', [3, '-', '-'], 3)
    expectLeaderboardRow('ออย', [1, '-', '-'], 1)
  })

  it('focuses the summary button before showing the leaderboard and then focuses the leaderboard action', async () => {
    startTwoPlayerGame('ออย', 'บีม')

    await advanceTimers(3100)

    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toHaveFocus()
    await openRoundSummary()
    expect(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    ).toHaveFocus()
  })

  it('starts the second match round from the last player and the third from the first again', async () => {
    startTwoPlayerGame('ออย', 'บีม')

    await advanceTimers(3100)
    await openRoundSummary()

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา บีม' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
    await advanceTimers(3100)
    await openRoundSummary()

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา ออย' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
  })

  it('keeps the same player active after typing starts in time until the host submits', async () => {
    startTwoPlayerGame('ก้อย', 'จูน')

    await advanceTimers(1000)

    const answerInput = screen.getByLabelText('คำตอบของ ก้อย')

    fireEvent.change(answerInput, { target: { value: 'ก' } })
    await advanceTimers(5000)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ก้อย' }),
    ).toBeInTheDocument()
    expect(screen.getByText(`รอบ 1/${MATCH_ROUNDS_PER_MATCH}`)).toBeInTheDocument()
    expect(screen.queryByLabelText('สถานะการแยกพยางค์')).not.toBeInTheDocument()

    fireEvent.change(answerInput, { target: { value: 'กาแฟ' } })
    await flushSegmentationDebounce()
    toggleSyllableDebug()

    const currentInputDebug = within(
      screen.getByLabelText('พยางค์ของคำปัจจุบัน'),
    )

    expect(currentInputDebug.getByText('กา')).toBeInTheDocument()
    expect(currentInputDebug.getByText('แฟ')).toBeInTheDocument()

    fireEvent.submit(answerInput.closest('form')!)
    await waitForTurn('จูน')

    const usedSyllablesDebug = within(
      screen.getByLabelText('พยางค์ที่บันทึกในรอบนี้'),
    )

    expect(usedSyllablesDebug.getByText('กา')).toBeInTheDocument()
    expect(usedSyllablesDebug.getByText('แฟ')).toBeInTheDocument()
  })

  it('uses backend syllables in the debug panel for words the old heuristic split badly', async () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    fireEvent.change(screen.getByLabelText('คำตอบของ ต้น'), {
      target: { value: 'กล้วย' },
    })
    await flushSegmentationDebounce()
    toggleSyllableDebug()

    const currentInputDebug = within(
      screen.getByLabelText('พยางค์ของคำปัจจุบัน'),
    )

    expect(currentInputDebug.getByText('กล้วย')).toBeInTheDocument()
    expect(currentInputDebug.queryByText('กล้ว')).not.toBeInTheDocument()
    expect(currentInputDebug.queryByText('ย')).not.toBeInTheDocument()
  })

  it('keeps the syllable debug panel hidden by default and toggles it on demand', () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าเกม' }))
    const showButton = screen.getByRole('button', {
      name: 'แสดงการแยกพยางค์',
    })

    expect(showButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('สถานะการแยกพยางค์')).not.toBeInTheDocument()

    fireEvent.click(showButton)

    expect(getSettingsItem('แสดงการแยกพยางค์')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('สถานะการแยกพยางค์')).toBeInTheDocument()
    expect(
      window.localStorage.getItem('khamtongchueam:show-syllable-debug'),
    ).toBe('true')

    fireEvent.click(getSettingsItem('แสดงการแยกพยางค์'))

    expect(getSettingsItem('แสดงการแยกพยางค์')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('สถานะการแยกพยางค์')).not.toBeInTheDocument()
    expect(
      window.localStorage.getItem('khamtongchueam:show-syllable-debug'),
    ).toBe('false')
  })

  it('restores the syllable debug visibility preference from localStorage', () => {
    window.localStorage.setItem('khamtongchueam:show-syllable-debug', 'true')

    startTwoPlayerGame('ต้น', 'แพรว')

    expect(getSettingsItem('แสดงการแยกพยางค์')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('สถานะการแยกพยางค์')).toBeInTheDocument()
  })

  it('falls back to hidden when the saved syllable debug preference is false', () => {
    window.localStorage.setItem('khamtongchueam:show-syllable-debug', 'false')

    startTwoPlayerGame('ต้น', 'แพรว')

    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าเกม' }))
    expect(
      screen.getByRole('button', { name: 'แสดงการแยกพยางค์' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('สถานะการแยกพยางค์')).not.toBeInTheDocument()
  })

  it('does not open challenge selection with F2 before there is a valid answer to challenge', () => {
    startTwoPlayerGame('เอ', 'บี')

    fireEvent.keyDown(window, { key: 'F2' })

    expect(
      screen.queryByLabelText('การชาเลนจ์คำไม่เชื่อม'),
    ).not.toBeInTheDocument()
  })

  it('opens challenge selection with F2, focuses the challenger field, preselects the latest answer, and cancels with Escape', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.keyDown(window, { key: 'F2' })

    const challengerInput = screen.getByRole('combobox', {
      name: 'พิมพ์ชื่อผู้ชาเลนจ์',
    })
    expect(screen.getByLabelText('การชาเลนจ์คำไม่เชื่อม')).toBeInTheDocument()
    expect(challengerInput).toHaveFocus()
    expect(getSelectedChallengeTarget()).toBe('สับปะรด')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(
      screen.queryByLabelText('การชาเลนจ์คำไม่เชื่อม'),
    ).not.toBeInTheDocument()
  })

  it('starts a challenge with Enter from the challenger field when the latest answer is preselected', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.keyDown(window, { key: 'F2' })
    await typeChallengeChallengerKeys('เ')
    fireEvent.keyDown(
      screen.getByRole('combobox', { name: 'พิมพ์ชื่อผู้ชาเลนจ์' }),
      { key: 'Enter' },
    )

    expect(screen.getByRole('status')).toHaveTextContent('เอ กำลังพูด')
  })

  it('auto-selects the challenger by typed prefix when the selector is opened from the button', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์' }))

    await typeChallengeChallengerKeys('เ')
    expectSelectedChallengeChallenger('เอ')

    fireEvent.keyDown(
      screen.getByRole('combobox', { name: 'พิมพ์ชื่อผู้ชาเลนจ์' }),
      { key: 'Enter' },
    )

    expect(screen.getByRole('status')).toHaveTextContent('เอ กำลังพูด')
  })

  it('filters challenger options, selects the best match, and lets ArrowDown move focus to the list', async () => {
    render(<App />)
    fillSetupNames(['บอส', 'บอม', 'เอ', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('บอส', 'alpha')
    await waitForTurn('บอม')
    await submitAnswer('บอม', 'bravo')
    await waitForTurn('เอ')
    await submitAnswer('เอ', 'charlie')
    await waitForTurn('ซี')
    await submitAnswer('ซี', 'delta')
    await waitForTurn('ดี')

    fireEvent.keyDown(window, { key: 'F2' })

    await typeChallengeChallengerKeys('บอ')
    expectSelectedChallengeChallenger('บอส')
    expect(getChallengeChallengerOptionLabels()).toEqual(['บอส', 'บอม'])

    const challengerInput = screen.getByRole('combobox', {
      name: 'พิมพ์ชื่อผู้ชาเลนจ์',
    })

    fireEvent.keyDown(challengerInput, { key: 'ArrowDown' })
    await flushAsyncWork()
    expect(challengerInput).toHaveFocus()
    expectSelectedChallengeChallenger('บอม')

    fireEvent.change(
      challengerInput,
      {
        target: { value: 'บอม' },
      },
    )
    await flushAsyncWork()
    expectSelectedChallengeChallenger('บอม')
    expect(getChallengeChallengerOptionLabels()).toEqual(['บอม'])
  })

  it('keeps the typed challenger filter while the selector stays open and resets it after Escape', async () => {
    render(<App />)
    fillSetupNames(['บอส', 'บอม', 'เอ', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('บอส', 'alpha')
    await waitForTurn('บอม')
    await submitAnswer('บอม', 'bravo')
    await waitForTurn('เอ')
    await submitAnswer('เอ', 'charlie')
    await waitForTurn('ซี')
    await submitAnswer('ซี', 'delta')
    await waitForTurn('ดี')

    fireEvent.keyDown(window, { key: 'F2' })

    const challengerInput = await typeChallengeChallengerKeys('บอม')
    expectSelectedChallengeChallenger('บอม')
    expect(challengerInput).toHaveValue('บอม')

    await advanceTimers(801)
    expect(challengerInput).toHaveValue('บอม')
    expectSelectedChallengeChallenger('บอม')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      screen.queryByLabelText('การชาเลนจ์คำไม่เชื่อม'),
    ).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'F2' })
    expect(
      screen.getByRole('combobox', { name: 'พิมพ์ชื่อผู้ชาเลนจ์' }),
    ).toHaveValue('')
    await typeChallengeChallengerKeys('บ')
    expectSelectedChallengeChallenger('บอส')
  })

  it('shows a no-results state and does not confirm a challenger when the search has no matches', async () => {
    render(<App />)
    fillSetupNames(['บอส', 'บอม', 'เอ', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('บอส', 'alpha')
    await waitForTurn('บอม')
    await submitAnswer('บอม', 'bravo')
    await waitForTurn('เอ')
    await submitAnswer('เอ', 'charlie')
    await waitForTurn('ซี')

    fireEvent.keyDown(window, { key: 'F2' })
    const challengerInput = await typeChallengeChallengerKeys('zzz')

    expect(
      screen.getByText('ไม่พบผู้ชาเลนจ์ที่ตรงกัน'),
    ).toBeInTheDocument()
    expect(challengerInput.getAttribute('aria-activedescendant')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: 'ยืนยันการชาเลนจ์',
        hidden: true,
      }),
    ).toBeDisabled()

    fireEvent.keyDown(challengerInput, { key: 'Enter' })

    expect(
      screen.getByLabelText('การชาเลนจ์คำไม่เชื่อม'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/กำลังพูด/)).not.toBeInTheDocument()
  })

  it('starts a challenge with Enter from the challenger field after changing the target', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'alpha')
    await waitForTurn('บี')
    await submitAnswer('บี', 'bravo')
    await waitForTurn('ซี')
    await submitAnswer('ซี', 'charlie')
    await waitForTurn('ดี')

    fireEvent.keyDown(window, { key: 'F2' })
    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('bravo')
    await flushAsyncWork()

    expect(getSelectedChallengeTarget()).toBe('bravo')

    fireEvent.keyDown(getChallengeChallengerInput(), { key: 'Enter' })
    await flushAsyncWork()

    expect(screen.getByRole('status')).toHaveTextContent('เอ กำลังพูด')
    expect(screen.getByText(/bravo/)).toBeInTheDocument()
  })

  it('advances challenge debate segments with Enter and focuses the first judgement button', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.keyDown(window, { key: 'F2' })
    const challengerInput = await typeChallengeChallengerKeys('เ')
    fireEvent.keyDown(challengerInput, { key: 'Enter' })

    await flushAsyncWork()
    expect(screen.getByRole('status')).toHaveTextContent('เอ กำลังพูด')

    await skipChallengeDebateSegments(1)
    expect(screen.getByRole('status')).toHaveTextContent('บี กำลังพูด')

    await skipChallengeDebateSegments(3)

    const connectsButton = screen.getByRole('button', {
      name: 'ตัดสินว่าเชื่อม',
    })

    expect(connectsButton).toHaveFocus()
    fireEvent.keyDown(connectsButton, { key: 'Enter' })

    expect(
      screen.getByText('เอ ตกรอบเพราะชาเลนจ์คำ "สับปะรด" ไม่สำเร็จ'),
    ).toBeInTheDocument()
  })

  it('opens the challenge selector and reaches judgement after four debate segments', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์' }))

    expect(screen.getByLabelText('การชาเลนจ์คำไม่เชื่อม')).toBeInTheDocument()

    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('สับปะรด')
    await flushAsyncWork()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'ยืนยันการชาเลนจ์',
        hidden: true,
      }),
    )

    expect(screen.getByRole('status')).toHaveTextContent('เอ กำลังพูด')

    await advanceChallengeDebateToJudging()

    expect(
      screen.getByRole('button', { name: 'ตัดสินว่าเชื่อม' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'ตัดสินว่าไม่เชื่อม' }),
    ).toBeInTheDocument()
  })

  it('returns to the paused next turn after a successful challenge and adds the bonus to the leaderboard', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์' }))
    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('สับปะรด')
    await flushAsyncWork()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'ยืนยันการชาเลนจ์',
        hidden: true,
      }),
    )

    await advanceChallengeDebateToJudging()
    fireEvent.click(screen.getByRole('button', { name: 'ตัดสินว่าไม่เชื่อม' }))

    expect(
      screen.getByText('บี ตกรอบเพราะคำ "สับปะรด" ไม่เชื่อมกับคำ "กาแฟ"'),
    ).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()

    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))
    await advanceTimers(3100)
    await openRoundSummary()

    expectLeaderboardRow('เอ', ['3 +2', '-', '-'], 5)
    expectLeaderboardRow('ซี', [1, '-', '-'], 1)
    expectLeaderboardRow('บี', [1, '-', '-'], 1)
  })

  it('shows round summary when a failed challenge leaves one winner', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('เอ')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์' }))
    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('สับปะรด')
    await flushAsyncWork()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'ยืนยันการชาเลนจ์',
        hidden: true,
      }),
    )

    await advanceChallengeDebateToJudging()
    fireEvent.click(screen.getByRole('button', { name: 'ตัดสินว่าเชื่อม' }))

    expect(
      screen.getByText('เอ ตกรอบเพราะชาเลนจ์คำ "สับปะรด" ไม่สำเร็จ'),
    ).toBeInTheDocument()
    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()

    await openRoundSummary()
    expectLeaderboardRow('บี', [3, '-', '-'], 3)
    expectLeaderboardRow('เอ', [1, '-', '-'], 1)
  })

  it('reverses active player order on even-numbered match rounds', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await advanceTimers(3100)

    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeEnabled()

    await submitAnswer('ซี', 'สับปะรด')
    await waitForTurn('เอ')

    await advanceTimers(3100)
    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    await openRoundSummary()
    await waitForLeaderboard()

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    // The player list keeps roster order; only the turn order is reversed.
    expectPlayerListOrder('ลำดับผู้เล่น', ['เอ', 'บี', 'ซี'])
    expectCurrentTurnPlayer('ลำดับผู้เล่น', 'ซี')
  })

  it('pauses the timer for the next player after someone is eliminated', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    expectEliminatedPlayers([])

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await advanceTimers(3100)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ซี' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('บี ตกรอบเพราะไม่ทันเวลา'),
    ).toBeInTheDocument()
    expectEliminatedPlayers(['บี'])
    expectPlayerListOrder('ลำดับผู้เล่น', ['เอ', 'บี', 'ซี'])
    expectCurrentTurnPlayer('ลำดับผู้เล่น', 'ซี')
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()

    await advanceTimers(5000)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ซี' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()

    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    expect(screen.getByLabelText('คำตอบของ ซี')).toBeEnabled()

    await submitAnswer('ซี', 'สับปะรด')
    await waitForTurn('เอ')

    expectPlayerListOrder('ลำดับผู้เล่น', ['เอ', 'บี', 'ซี'])
    expectCurrentTurnPlayer('ลำดับผู้เล่น', 'เอ')
  })

  it('awards leaderboard points to only the last three players', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await advanceTimers(3100)
    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    await submitAnswer('ซี', 'สับปะรด')
    await waitForTurn('ดี')

    await advanceTimers(3100)
    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    await submitAnswer('เอ', 'ลำไย')
    await waitForTurn('ซี')

    await advanceTimers(3100)
    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    await openRoundSummary()
    await waitForLeaderboard()

    for (let roundNumber = 1; roundNumber <= MATCH_ROUNDS_PER_MATCH; roundNumber += 1) {
      expect(
        screen.getByRole('columnheader', { name: `รอบที่ ${roundNumber}` }),
      ).toBeInTheDocument()
    }
    expect(screen.getByRole('columnheader', { name: 'คะแนนรวม' })).toBeInTheDocument()
    const remainingRoundPlaceholders = Array.from(
      { length: MATCH_ROUNDS_PER_MATCH - 1 },
      () => '-',
    )
    expectLeaderboardRow('เอ', [3, ...remainingRoundPlaceholders], 3)
    expectLeaderboardRow('ซี', [1, ...remainingRoundPlaceholders], 1)
    expectLeaderboardRow('ดี', [1, ...remainingRoundPlaceholders], 1)
    expectLeaderboardRow('บี', [0, ...remainingRoundPlaceholders], 0)
  })

  it('keeps eliminated players in roster order even when they are eliminated later', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    await advanceTimers(3100)
    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    await submitAnswer('ดี', 'ลำไย')
    await waitForTurn('เอ')

    await advanceTimers(3100)
    expect(screen.queryByRole('button', { name: 'สรุปรอบ' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ถึงตา บี' })).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()

    expectEliminatedPlayers(['เอ', 'ซี'])
  })

  it('shows a duplicate-syllable pause message and requires manually starting the next turn', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await submitAnswer('บี', 'กากี')
    await waitForTurn('ซี')

    const duplicateStatus = screen.getByRole('status')
    expect(duplicateStatus).toHaveTextContent(
      'บี ตกรอบเพราะคำตอบ "กากี" ซ้ำกับคำ "กาแฟ"',
    )
    expect(within(duplicateStatus).getAllByText('กา')).toHaveLength(2)
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()
  })

  it('keeps duplicate-syllable tracking across a full player cycle within the same match round', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    await submitAnswer('ซี', 'ลำไย')
    await waitForTurn('เอ')

    await submitAnswer('เอ', 'กากี')
    await waitForTurn('บี')

    const duplicateStatus = screen.getByRole('status')
    expect(duplicateStatus).toHaveTextContent(
      'เอ ตกรอบเพราะคำตอบ "กากี" ซ้ำกับคำ "กาแฟ"',
    )
    expect(within(duplicateStatus).getAllByText('กา')).toHaveLength(2)
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
  })

  it('shows a backend segmentation error and does not silently fall back', async () => {
    startTwoPlayerGame('เอ', 'บี')

    fireEvent.change(screen.getByLabelText('คำตอบของ เอ'), {
      target: { value: 'ปิดระบบ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    await flushAsyncWork()

    expect(screen.getByRole('alert')).toHaveTextContent(SEGMENTATION_ERROR_TEXT)
    expect(screen.getByRole('heading', { name: 'ถึงตา เอ' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ เอ')).toHaveValue('ปิดระบบ')
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeEnabled()
  })

  it('accumulates leaderboard scores across replay with the same roster', async () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    await advanceTimers(3100)
    await openRoundSummary()

    expectLeaderboardRow('แพรว', [3, '-', '-'], 3)
    expectLeaderboardRow('ต้น', [1, '-', '-'], 1)

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา แพรว' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ แพรว')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
    await advanceTimers(3100)

    await openRoundSummary()
    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
    expectLeaderboardRow('ต้น', [1, 3, '-'], 4)
    expectLeaderboardRow('แพรว', [3, 1, '-'], 4)
  })

  it('supports replaying with the same roster and resetting everything', async () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    await advanceTimers(3100)

    await openRoundSummary()
    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา แพรว' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ แพรว')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
    expect(
      screen.getByRole('heading', { name: 'ถึงตา แพรว' }),
    ).toBeInTheDocument()

    await submitAnswer('แพรว', 'กล้วย')
    await waitForTurn('ต้น')

    await advanceTimers(3100)
    await openRoundSummary()
    await waitForLeaderboard()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใหม่' }))

    // Back on setup with the same names kept in the editor, ready to confirm again.
    expect(getSetupEditorView().state.doc.toString()).toBe('ต้น\nแพรว')
    expect(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' })).toBeEnabled()
  })

  it('starts a new match and resets leaderboard scores after a full match', async () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    for (let round = 1; round <= MATCH_ROUNDS_PER_MATCH; round += 1) {
      await advanceTimers(3100)

      await openRoundSummary()

      const expectedSecondPlayer = round % 2 === 1 ? 'แพรว' : 'ต้น'
      const expectedFirstPlayerTotal =
        Math.ceil(round / 2) * 1 + Math.floor(round / 2) * 3
      const expectedSecondPlayerTotal =
        Math.ceil(round / 2) * 3 + Math.floor(round / 2) * 1

      expectLeaderboardRow(
        'แพรว',
        Array.from({ length: MATCH_ROUNDS_PER_MATCH }, (_, index) =>
          index < round ? (index % 2 === 0 ? 3 : 1) : '-',
        ),
        expectedSecondPlayerTotal,
      )
      expectLeaderboardRow(
        'ต้น',
        Array.from({ length: MATCH_ROUNDS_PER_MATCH }, (_, index) =>
          index < round ? (index % 2 === 0 ? 1 : 3) : '-',
        ),
        expectedFirstPlayerTotal,
      )

      if (round < MATCH_ROUNDS_PER_MATCH) {
        fireEvent.click(
          screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
        )

        expect(
          screen.getByRole('heading', { name: `ถึงตา ${expectedSecondPlayer}` }),
        ).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
        expect(
          screen.getByLabelText(`คำตอบของ ${expectedSecondPlayer}`),
        ).toBeDisabled()

        fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
      }
    }

    fireEvent.click(
      screen.getByRole('button', { name: 'เริ่มแมตช์ใหม่ด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา ต้น' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ ต้น')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
    expect(screen.getByText(`รอบ 1/${MATCH_ROUNDS_PER_MATCH}`)).toBeInTheDocument()

    await advanceTimers(3100)

    await openRoundSummary()
    expectLeaderboardRow('แพรว', [3, '-', '-'], 3)
    expectLeaderboardRow('ต้น', [1, '-', '-'], 1)
  })

  it('pauses running first turn without reverting, undo disabled at round start', async () => {
    render(<App />)

    expect(screen.queryByRole('button', { name: 'ย้อนกลับ' })).not.toBeInTheDocument()
    fillSetupNames(['เอ', 'บี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    expect(getUndoButton()).toBeDisabled()
    expect(getRedoButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
    expect(getUndoButton()).toBeEnabled()

    await advanceTimers(1200)

    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(screen.getByRole('heading', { name: 'ถึงตา เอ' })).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
    expect(getRedoButton()).toBeDisabled()
  })

  it('pauses current turn when undo pressed during running timer', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(screen.getByRole('heading', { name: 'ถึงตา บี' })).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
    expect(getRedoButton()).toBeDisabled()

    await triggerRedoShortcut()
    await flushAsyncWork()

    expect(screen.getByRole('heading', { name: 'ถึงตา บี' })).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
  })

  it('grants safe-to-finish immediately when typing after resuming an undo-restored turn', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ บี')).toBeDisabled()

    await acknowledgeEliminationIfNeeded()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    expect(screen.getByLabelText('คำตอบของ บี')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('คำตอบของ บี'), {
      target: { value: 'ส' },
    })

    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeEnabled()
  })


  it('allows undoing a timeout and redoing to summary', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await advanceTimers(3100)
    expect(screen.getByRole('button', { name: 'ประกาศผู้ชนะ' })).toBeInTheDocument()

    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(screen.getByRole('heading', { name: 'ถึงตา เอ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
    expect(getRedoButton()).toBeEnabled()

    fireEvent.click(getRedoButton())
    await flushAsyncWork()

    expect(screen.getByRole('button', { name: 'ประกาศผู้ชนะ' })).toBeInTheDocument()
    await announceWinnerIfNeeded()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
  })


  it('allows undoing a resolved challenge and redoing it back', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('ซี')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์' }))
    await typeChallengeChallengerKeys('เ')
    fireEvent.keyDown(getChallengeChallengerInput(), { key: 'Enter' })
    await flushAsyncWork()
    await advanceChallengeDebateToJudging()

    fireEvent.click(screen.getByRole('button', { name: 'ตัดสินว่าไม่เชื่อม' }))
    await flushAsyncWork()

    // The challenged player is out; the game pauses on the elimination.
    expect(screen.getByRole('heading', { name: 'ถึงตา ซี' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ไปต่อ' })).toBeInTheDocument()

    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(
      screen.getByRole('button', { name: 'ตัดสินว่าไม่เชื่อม' }),
    ).toBeInTheDocument()
    expect(getRedoButton()).toBeEnabled()

    fireEvent.click(getRedoButton())
    await flushAsyncWork()

    expect(screen.getByRole('heading', { name: 'ถึงตา ซี' })).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
  })

  it('allows undoing from leaderboard to summary and to pre-timeout turn', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await advanceTimers(3100)
    await openRoundSummary()
    await waitForLeaderboard()

    // leaderboard -> winner announced (round summary button)
    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    expect(getRedoButton()).toBeEnabled()

    // winner announced -> timeout result, before announcing
    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(screen.getByRole('button', { name: 'ประกาศผู้ชนะ' })).toBeInTheDocument()

    // timeout result -> the turn before the timeout
    fireEvent.click(getUndoButton())
    await flushAsyncWork()

    expect(screen.getByRole('heading', { name: 'ถึงตา เอ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
  })


  it('triggers app undo when pressing Ctrl+Z inside a text input', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    const answerInput = screen.getByLabelText('คำตอบของ บี')

    fireEvent.change(answerInput, { target: { value: 'สับปะรด' } })
    await triggerUndoShortcut(answerInput)

    expect(screen.getByRole('heading', { name: 'ถึงตา บี' })).toBeInTheDocument()
    await acknowledgeEliminationIfNeeded()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
  })

  it('clears undo and redo history when replaying the same players or resetting everything', async () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    await advanceTimers(3100)
    await openRoundSummary()
    await waitForLeaderboard()

    fireEvent.click(screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }))

    expect(getUndoButton()).toBeDisabled()
    expect(getRedoButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
    await advanceTimers(3100)
    await openRoundSummary()
    await waitForLeaderboard()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใหม่' }))

    expect(screen.queryByRole('button', { name: 'ย้อนกลับ' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' })).toBeInTheDocument()
  })
})

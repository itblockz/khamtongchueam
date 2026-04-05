import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

const MATCH_ROUNDS_PER_MATCH = 4
const SEGMENTATION_DEBOUNCE_MS = 250
const CHALLENGE_SEGMENT_MS = 15000
const SEGMENTATION_ERROR_TEXT = 'ระบบแยกพยางค์ไม่พร้อมใช้งาน'

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

function fillSetupNames(playerNames: string[]) {
  playerNames.forEach((playerName, index) => {
    fireEvent.change(screen.getByLabelText(`ชื่อผู้เล่น ${index + 1}`), {
      target: { value: playerName },
    })
  })
}

function createMockDataTransfer() {
  let storedData = ''

  return {
    effectAllowed: 'all',
    dropEffect: 'move',
    setData: (_type: string, value: string) => {
      storedData = value
    },
    getData: () => storedData,
  }
}

function startTwoPlayerGame(firstPlayer: string, secondPlayer: string) {
  render(<App />)
  fillSetupNames([firstPlayer, secondPlayer])
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
  fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
}

function toggleSyllableDebug() {
  const toggleButton =
    screen.queryByRole('button', { name: 'แสดงการแยกพยางค์' }) ??
    screen.queryByRole('button', { name: 'ซ่อนการแยกพยางค์' })

  expect(toggleButton).not.toBeNull()
  fireEvent.click(toggleButton!)
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

async function advanceChallengeDebateToJudging() {
  for (let segment = 0; segment < 4; segment += 1) {
    await advanceTimers(CHALLENGE_SEGMENT_MS)
  }
}

async function skipChallengeDebateSegments(segmentCount: number) {
  for (let segment = 0; segment < segmentCount; segment += 1) {
    fireEvent.keyDown(window, { key: 'Enter' })
    await flushAsyncWork()
  }
}

async function typeChallengeChallengerKeys(keys: string) {
  const challengerInput = screen.getByLabelText(
    'พิมพ์ชื่อผู้ชาเล้นจ์',
  ) as HTMLInputElement

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

function expectSelectedChallengeChallenger(playerName: string) {
  const challengerSelect = screen.getByLabelText(
    'ผู้ชาเล้นจ์',
  ) as HTMLSelectElement
  const selectedOption = Array.from(challengerSelect.options).find(
    (option) => option.selected,
  )

  expect(selectedOption?.textContent?.trim()).toBe(playerName)
}

function getChallengeChallengerOptionLabels() {
  const challengerSelect = screen.getByLabelText(
    'ผู้ชาเล้นจ์',
  ) as HTMLSelectElement

  return Array.from(challengerSelect.options).map((option) =>
    option.textContent?.trim(),
  )
}

function selectChallengeTarget(answerText: string) {
  const challengedAnswerSelect = screen.getByLabelText(
    'คำที่ถูกชาเล้นจ์',
  ) as HTMLSelectElement
  const option = within(challengedAnswerSelect)
    .getAllByRole('option')
    .find((candidate) =>
      candidate.textContent?.trim().startsWith(`"${answerText}"`),
    ) as HTMLOptionElement | undefined

  expect(option).toBeDefined()

  fireEvent.change(challengedAnswerSelect, {
    target: { value: option!.value },
  })
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

async function openRoundSummary() {
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

describe('คำต้องเชื่อม', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00.000Z'))
    window.localStorage.clear()

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

  it('starts setup with one focused blank row and adds a new blank row when typing in the last slot', () => {
    render(<App />)

    const firstInput = screen.getByLabelText('ชื่อผู้เล่น 1')

    expect(firstInput).toHaveFocus()
    expect(firstInput).toHaveValue('')
    expect(screen.queryByLabelText('ชื่อผู้เล่น 2')).not.toBeInTheDocument()

    fireEvent.change(firstInput, {
      target: { value: 'มีน' },
    })

    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 2'), {
      target: { value: 'มายด์' },
    })

    expect(screen.getByLabelText('ชื่อผู้เล่น 3')).toHaveValue('')
  })

  it('requires at least two unique trimmed names before starting', () => {
    render(<App />)

    const startButton = screen.getByRole('button', { name: 'ยืนยันผู้เล่น' })

    expect(startButton).toBeDisabled()

    fillSetupNames(['มีน', ' มีน '])

    expect(
      screen.getByText('ชื่อผู้เล่นห้ามซ้ำหลังตัดช่องว่างหน้า-ท้าย'),
    ).toBeInTheDocument()
    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 2'), {
      target: { value: 'มายด์' },
    })

    expect(startButton).toBeEnabled()
  })

  it('moves with Enter and confirms players from the trailing blank row', () => {
    render(<App />)

    const firstInput = screen.getByLabelText('ชื่อผู้เล่น 1')

    fireEvent.change(firstInput, {
      target: { value: 'มีน' },
    })
    fireEvent.keyDown(firstInput, { key: 'Enter' })

    const secondInput = screen.getByLabelText('ชื่อผู้เล่น 2')

    expect(secondInput).toHaveFocus()

    fireEvent.change(secondInput, {
      target: { value: 'มายด์' },
    })
    fireEvent.keyDown(secondInput, { key: 'Enter' })

    const thirdInput = screen.getByLabelText('ชื่อผู้เล่น 3')

    expect(thirdInput).toHaveFocus()

    fireEvent.keyDown(thirdInput, { key: 'Enter' })

    expect(
      screen.getByRole('heading', { name: 'ถึงตา มีน' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ มีน')).toBeDisabled()
  })

  it('removes a cleared blank row with Backspace and moves focus to the previous row', () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])

    const secondInput = screen.getByLabelText('ชื่อผู้เล่น 2')

    fireEvent.change(secondInput, {
      target: { value: '' },
    })

    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('')
    expect(screen.getByLabelText('ชื่อผู้เล่น 3')).toHaveValue('ซี')

    fireEvent.keyDown(screen.getByLabelText('ชื่อผู้เล่น 2'), {
      key: 'Backspace',
    })

    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveFocus()
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('ซี')
    expect(screen.getByLabelText('ชื่อผู้เล่น 3')).toHaveValue('')
    expect(screen.queryByLabelText('ชื่อผู้เล่น 4')).not.toBeInTheDocument()
  })

  it('keeps row action buttons out of the Tab order', () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี'])

    expect(screen.getByRole('button', { name: 'ลบผู้เล่น 1' }).tabIndex).toBe(-1)
    expect(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }).tabIndex).toBe(0)
  })

  it('reorders setup rows by dragging a player to a new position', () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])

    const dataTransfer = createMockDataTransfer()
    const draggedRow = screen.getByLabelText('ชื่อผู้เล่น 3').closest('li')
    const firstRow = screen.getByLabelText('ชื่อผู้เล่น 1').closest('li')

    expect(draggedRow).not.toBeNull()
    expect(firstRow).not.toBeNull()

    fireEvent.dragStart(draggedRow!, { dataTransfer })
    fireEvent.dragOver(firstRow!, { dataTransfer })

    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('ซี')
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('เอ')
    expect(screen.getByLabelText('ชื่อผู้เล่น 3')).toHaveValue('บี')

    fireEvent.drop(firstRow!, { dataTransfer })
    fireEvent.dragEnd(draggedRow!, { dataTransfer })

    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('ซี')
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('เอ')
    expect(screen.getByLabelText('ชื่อผู้เล่น 3')).toHaveValue('บี')
  })

  it('supports pasting multiple lines and still flags duplicate names', () => {
    render(<App />)

    fireEvent.paste(screen.getByLabelText('ชื่อผู้เล่น 1'), {
      clipboardData: {
        getData: () => 'มีน\nมายด์\nมีน',
      },
    })

    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('มีน')
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('มายด์')
    expect(screen.getByLabelText('ชื่อผู้เล่น 3')).toHaveValue('มีน')
    expect(screen.getByLabelText('ชื่อผู้เล่น 4')).toHaveValue('')
    expect(screen.getByLabelText('ชื่อผู้เล่น 4')).toHaveFocus()
    expect(
      screen.getByText('ชื่อผู้เล่นห้ามซ้ำหลังตัดช่องว่างหน้า-ท้าย'),
    ).toBeInTheDocument()
  })

  it('moves focus to the next blank row after pasting a single name', () => {
    render(<App />)

    fireEvent.paste(screen.getByLabelText('ชื่อผู้เล่น 1'), {
      clipboardData: {
        getData: () => 'มีน',
      },
    })

    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('มีน')
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('')
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveFocus()
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

    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toHaveFocus()
    await openRoundSummary()
    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
  })

  it('eliminates the current player when no input is started within 3 seconds', async () => {
    startTwoPlayerGame('ออย', 'บีม')

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()

    await advanceTimers(3100)

    expect(screen.getByRole('heading', { name: 'ถึงตา บีม' })).toBeInTheDocument()
    expect(screen.getByText('ออย ตกรอบเพราะไม่ทันเวลา')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    await openRoundSummary()
    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
    expectLeaderboardRow('บีม', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ออย', [1, '-', '-', '-'], 1)
  })

  it('focuses the summary button before showing the leaderboard and then focuses the leaderboard action', async () => {
    startTwoPlayerGame('ออย', 'บีม')

    await advanceTimers(3100)

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
    expect(screen.getByText('รอบ 1/4')).toBeInTheDocument()
    expect(screen.queryByLabelText('การแยกพยางค์')).not.toBeInTheDocument()

    fireEvent.change(answerInput, { target: { value: 'กาแฟ' } })
    await flushSegmentationDebounce()
    toggleSyllableDebug()

    const currentInputDebug = within(
      screen.getByLabelText('พยางค์ของคำปัจจุบัน'),
    )

    expect(currentInputDebug.getByText('กา')).toBeInTheDocument()
    expect(currentInputDebug.getByText('แฟ')).toBeInTheDocument()
    expect(currentInputDebug.getByText(/han_solo/)).toBeInTheDocument()

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

    const showButton = screen.getByRole('button', {
      name: 'แสดงการแยกพยางค์',
    })

    expect(showButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('การแยกพยางค์')).not.toBeInTheDocument()

    fireEvent.click(showButton)

    expect(
      screen.getByRole('button', { name: 'ซ่อนการแยกพยางค์' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('การแยกพยางค์')).toBeInTheDocument()
    expect(
      window.localStorage.getItem('khamtongchueam:show-syllable-debug'),
    ).toBe('true')

    fireEvent.click(
      screen.getByRole('button', { name: 'ซ่อนการแยกพยางค์' }),
    )

    expect(
      screen.getByRole('button', { name: 'แสดงการแยกพยางค์' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('การแยกพยางค์')).not.toBeInTheDocument()
    expect(
      window.localStorage.getItem('khamtongchueam:show-syllable-debug'),
    ).toBe('false')
  })

  it('restores the syllable debug visibility preference from localStorage', () => {
    window.localStorage.setItem('khamtongchueam:show-syllable-debug', 'true')

    startTwoPlayerGame('ต้น', 'แพรว')

    expect(
      screen.getByRole('button', { name: 'ซ่อนการแยกพยางค์' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('การแยกพยางค์')).toBeInTheDocument()
  })

  it('falls back to hidden when the saved syllable debug preference is false', () => {
    window.localStorage.setItem('khamtongchueam:show-syllable-debug', 'false')

    startTwoPlayerGame('ต้น', 'แพรว')

    expect(
      screen.getByRole('button', { name: 'แสดงการแยกพยางค์' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('การแยกพยางค์')).not.toBeInTheDocument()
  })

  it('does not open challenge selection with F2 before there is a valid answer to challenge', () => {
    startTwoPlayerGame('เอ', 'บี')

    fireEvent.keyDown(window, { key: 'F2' })

    expect(
      screen.queryByLabelText('การชาเล้นจ์คำไม่เชื่อม'),
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

    const challengerInput = screen.getByRole('textbox', {
      name: 'พิมพ์ชื่อผู้ชาเล้นจ์',
    })
    const challengedAnswerSelect = screen.getByLabelText(
      'คำที่ถูกชาเล้นจ์',
    ) as HTMLSelectElement
    const latestOption = within(challengedAnswerSelect)
      .getAllByRole('option')
      .find(
        (option) => (option as HTMLOptionElement).value !== '',
      ) as HTMLOptionElement | undefined

    expect(screen.getByLabelText('การชาเล้นจ์คำไม่เชื่อม')).toBeInTheDocument()
    expect(challengerInput).toHaveFocus()
    expect(latestOption).toBeDefined()
    expect(challengedAnswerSelect).toHaveValue(latestOption!.value)
    expect(latestOption).toHaveTextContent('สับปะรด')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(
      screen.queryByLabelText('การชาเล้นจ์คำไม่เชื่อม'),
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
      screen.getByRole('textbox', { name: 'พิมพ์ชื่อผู้ชาเล้นจ์' }),
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

    fireEvent.click(screen.getByRole('button', { name: 'ชาเล้นจ์' }))

    await typeChallengeChallengerKeys('เ')
    expectSelectedChallengeChallenger('เอ')

    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'พิมพ์ชื่อผู้ชาเล้นจ์' }),
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

    const challengerInput = screen.getByRole('textbox', {
      name: 'พิมพ์ชื่อผู้ชาเล้นจ์',
    })
    const challengerSelect = screen.getByLabelText(
      'ผู้ชาเล้นจ์',
    ) as HTMLSelectElement

    fireEvent.keyDown(challengerInput, { key: 'ArrowDown' })
    expect(challengerSelect).toHaveFocus()

    fireEvent.change(challengerSelect, {
      target: { value: challengerSelect.options[1]?.value ?? '' },
    })
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
      screen.queryByLabelText('การชาเล้นจ์คำไม่เชื่อม'),
    ).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'F2' })
    expect(
      screen.getByRole('textbox', { name: 'พิมพ์ชื่อผู้ชาเล้นจ์' }),
    ).toHaveValue('')
    await typeChallengeChallengerKeys('บ')
    expectSelectedChallengeChallenger('บอส')
  })

  it('starts a challenge with Enter from the answer field after changing the target', async () => {
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

    const challengedAnswerSelect = screen.getByLabelText(
      'คำที่ถูกชาเล้นจ์',
    ) as HTMLSelectElement

    fireEvent.keyDown(challengedAnswerSelect, { key: 'Enter' })

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
    fireEvent.keyDown(challengerInput, { key: 'ArrowDown' })
    expect(screen.getByLabelText('ผู้ชาเล้นจ์')).toHaveFocus()
    fireEvent.keyDown(screen.getByLabelText('ผู้ชาเล้นจ์'), {
      key: 'Enter',
    })

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
      screen.getByText('เอ ตกรอบเพราะชาเล้นจ์คำ "สับปะรด" ไม่สำเร็จ'),
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

    fireEvent.click(screen.getByRole('button', { name: 'ชาเล้นจ์' }))

    expect(screen.getByLabelText('การชาเล้นจ์คำไม่เชื่อม')).toBeInTheDocument()

    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('สับปะรด')
    await flushAsyncWork()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มการชาเล้นจ์' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'ชาเล้นจ์' }))
    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('สับปะรด')
    await flushAsyncWork()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มการชาเล้นจ์' }))

    await advanceChallengeDebateToJudging()
    fireEvent.click(screen.getByRole('button', { name: 'ตัดสินว่าไม่เชื่อม' }))

    expect(
      screen.getByText('บี ตกรอบเพราะคำ "สับปะรด" ไม่เชื่อมกับคำ "กาแฟ"'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))
    await advanceTimers(3100)
    await openRoundSummary()

    expectLeaderboardRow('เอ', ['3 +2', '-', '-', '-'], 5)
    expectLeaderboardRow('ซี', [1, '-', '-', '-'], 1)
    expectLeaderboardRow('บี', [1, '-', '-', '-'], 1)
  })

  it('shows round summary when a failed challenge leaves one winner', async () => {
    startTwoPlayerGame('เอ', 'บี')

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')
    await submitAnswer('บี', 'สับปะรด')
    await waitForTurn('เอ')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเล้นจ์' }))
    await typeChallengeChallengerKeys('เ')
    selectChallengeTarget('สับปะรด')
    await flushAsyncWork()
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มการชาเล้นจ์' }))

    await advanceChallengeDebateToJudging()
    fireEvent.click(screen.getByRole('button', { name: 'ตัดสินว่าเชื่อม' }))

    expect(
      screen.getByText('เอ ตกรอบเพราะชาเล้นจ์คำ "สับปะรด" ไม่สำเร็จ'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()

    await openRoundSummary()
    expectLeaderboardRow('บี', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('เอ', [1, '-', '-', '-'], 1)
  })

  it('reverses active player order on even-numbered match rounds', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await advanceTimers(3100)

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeEnabled()

    await submitAnswer('ซี', 'สับปะรด')
    await waitForTurn('เอ')

    await advanceTimers(3100)
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    await openRoundSummary()
    await waitForLeaderboard()

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    expectPlayerListOrder('ผู้เล่นที่ยังไม่ตกรอบ', ['ซี', 'บี', 'เอ'])
    expectCurrentTurnPlayer('ผู้เล่นที่ยังไม่ตกรอบ', 'ซี')
  })

  it('pauses the timer for the next player after someone is eliminated', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    expect(
      screen.getByRole('heading', { name: 'ผู้เล่นที่ตกรอบ' }).closest('section'),
    ).toHaveClass('is-empty-collapsed')

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await advanceTimers(3100)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ซี' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('บี ตกรอบเพราะไม่ทันเวลา'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'ผู้เล่นที่ตกรอบ' }).closest('section'),
    ).not.toHaveClass('is-empty-collapsed')
    expectPlayerListOrder('ผู้เล่นที่ยังไม่ตกรอบ', ['เอ', 'ซี'])
    expectCurrentTurnPlayer('ผู้เล่นที่ยังไม่ตกรอบ', 'ซี')
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()

    await advanceTimers(5000)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ซี' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ซี')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    expect(screen.getByLabelText('คำตอบของ ซี')).toBeEnabled()

    await submitAnswer('ซี', 'สับปะรด')
    await waitForTurn('เอ')

    expectPlayerListOrder('ผู้เล่นที่ยังไม่ตกรอบ', ['เอ', 'ซี'])
    expectCurrentTurnPlayer('ผู้เล่นที่ยังไม่ตกรอบ', 'เอ')
  })

  it('awards leaderboard points to only the last three players', async () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    await submitAnswer('เอ', 'กาแฟ')
    await waitForTurn('บี')

    await advanceTimers(3100)
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    await submitAnswer('ซี', 'สับปะรด')
    await waitForTurn('ดี')

    await advanceTimers(3100)
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    await submitAnswer('เอ', 'ลำไย')
    await waitForTurn('ซี')

    await advanceTimers(3100)
    expect(screen.getByRole('button', { name: 'สรุปรอบ' })).toBeInTheDocument()
    await openRoundSummary()
    await waitForLeaderboard()

    expect(screen.getByRole('columnheader', { name: 'รอบที่ 1' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'รอบที่ 2' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'รอบที่ 3' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'รอบที่ 4' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'คะแนนรวม' })).toBeInTheDocument()
    expectLeaderboardRow('เอ', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ซี', [1, '-', '-', '-'], 1)
    expectLeaderboardRow('ดี', [1, '-', '-', '-'], 1)
    expectLeaderboardRow('บี', [0, '-', '-', '-'], 0)
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
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตาถัดไป' }))

    await submitAnswer('ดี', 'ลำไย')
    await waitForTurn('เอ')

    await advanceTimers(3100)
    expect(screen.queryByRole('button', { name: 'สรุปรอบ' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ถึงตา บี' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มตาถัดไป' })).toBeInTheDocument()

    expectPlayerListOrder('ผู้เล่นที่ตกรอบ', ['เอ', 'ซี'])
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

    expectLeaderboardRow('แพรว', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ต้น', [1, '-', '-', '-'], 1)

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
    expectLeaderboardRow('ต้น', [1, 3, '-', '-'], 4)
    expectLeaderboardRow('แพรว', [3, 1, '-', '-'], 4)
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

    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('')
    expect(screen.queryByLabelText('ชื่อผู้เล่น 2')).not.toBeInTheDocument()
  })

  it('starts a new match and resets leaderboard scores after four rounds', async () => {
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
    expectLeaderboardRow('แพรว', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ต้น', [1, '-', '-', '-'], 1)
  })
})

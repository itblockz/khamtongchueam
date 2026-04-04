import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

const MATCH_ROUNDS_PER_MATCH = 4

function fillSetupNames(playerNames: string[]) {
  playerNames.forEach((playerName, index) => {
    fireEvent.change(screen.getByLabelText(`ชื่อผู้เล่น ${index + 1}`), {
      target: { value: playerName },
    })
  })
}

function startTwoPlayerGame(firstPlayer: string, secondPlayer: string) {
  render(<App />)
  fillSetupNames([firstPlayer, secondPlayer])
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
  fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))
}

function expectLeaderboardRow(
  playerName: string,
  expectedRoundScores: Array<number | '-'>,
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

describe('คำต้องเชื่อม', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
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

    expect(screen.getByRole('button', { name: 'เพิ่มรายชื่อผู้เล่น' }).tabIndex).toBe(-1)
    expect(
      screen.getByRole('button', { name: 'เลื่อนผู้เล่น 1 ขึ้น' }).tabIndex,
    ).toBe(-1)
    expect(
      screen.getByRole('button', { name: 'เลื่อนผู้เล่น 1 ลง' }).tabIndex,
    ).toBe(-1)
    expect(
      screen.getByRole('button', { name: 'ลบผู้เล่น 1' }).tabIndex,
    ).toBe(-1)
    expect(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }).tabIndex).toBe(0)
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

  it('confirms players without starting the first timer immediately', () => {
    render(<App />)
    fillSetupNames(['ออย', 'บีม'])

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ออย')).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toBeInTheDocument()
    expect(screen.getByLabelText('คำตอบของ ออย')).toBeDisabled()
  })

  it('focuses the first-turn start button and lets Enter start the first round', () => {
    render(<App />)
    fillSetupNames(['ออย', 'บีม'])

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))

    const startFirstTurnButton = screen.getByRole('button', {
      name: 'เริ่มรอบแรก',
    })

    expect(startFirstTurnButton).toHaveFocus()

    fireEvent.keyDown(startFirstTurnButton, { key: 'Enter', code: 'Enter' })

    expect(screen.getByLabelText('คำตอบของ ออย')).toBeEnabled()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
  })

  it('eliminates the current player when no input is started within 3 seconds', () => {
    startTwoPlayerGame('ออย', 'บีม')

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
    expectLeaderboardRow('บีม', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ออย', [1, '-', '-', '-'], 1)
  })

  it('focuses the primary action button when the leaderboard screen opens', () => {
    startTwoPlayerGame('ออย', 'บีม')

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    ).toHaveFocus()
  })

  it('starts the second match round from the last player and the third from the first again', () => {
    startTwoPlayerGame('ออย', 'บีม')

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา บีม' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา ออย' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
  })

  it('keeps the same player active after typing starts in time until the host submits', () => {
    startTwoPlayerGame('ก้อย', 'จูน')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    const answerInput = screen.getByLabelText('คำตอบของ ก้อย')

    fireEvent.change(answerInput, { target: { value: 'ก' } })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ก้อย' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'รอบ 1/4 ของแมตช์นี้ • เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ',
      ),
    ).toBeInTheDocument()

    fireEvent.change(answerInput, { target: { value: 'กาแฟ' } })
    fireEvent.submit(answerInput.closest('form')!)

    expect(
      screen.getByRole('heading', { name: 'ถึงตา จูน' }),
    ).toBeInTheDocument()
  })

  it('pauses the timer for the next player after someone is eliminated', () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    expect(
      screen.getByRole('heading', { name: 'ผู้เล่นที่ตกรอบ' }).closest('section'),
    ).toHaveClass('is-empty-collapsed')

    fireEvent.change(screen.getByLabelText('คำตอบของ เอ'), {
      target: { value: 'คำแรก' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา บี' }),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ซี' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ยังไม่เริ่มจับเวลา')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'ผู้เล่นที่ตกรอบ' }).closest('section'),
    ).not.toHaveClass('is-empty-collapsed')
    expect(screen.getByLabelText('ผู้เล่นที่ตกรอบ')).not.toHaveClass('is-two-column')

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ซี' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ยังไม่เริ่มจับเวลา')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('คำตอบของ ซี'), {
      target: { value: 'คำต่อไป' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา เอ' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('ผู้เล่นที่ตกรอบ')).not.toHaveClass('is-two-column')
  })

  it('awards leaderboard points to only the last three players', () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    fireEvent.change(screen.getByLabelText('คำตอบของ เอ'), {
      target: { value: 'คำแรก' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    fireEvent.change(screen.getByLabelText('คำตอบของ ซี'), {
      target: { value: 'คำสอง' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    fireEvent.change(screen.getByLabelText('คำตอบของ เอ'), {
      target: { value: 'คำสาม' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()
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

  it('switches the eliminated board to two columns after two players are out', () => {
    render(<App />)
    fillSetupNames(['เอ', 'บี', 'ซี', 'ดี'])
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผู้เล่น' }))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    fireEvent.change(screen.getByLabelText('คำตอบของ เอ'), {
      target: { value: 'คำแรก' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ผู้เล่นที่ตกรอบ')).not.toHaveClass('is-two-column')

    fireEvent.change(screen.getByLabelText('คำตอบของ ซี'), {
      target: { value: 'คำสอง' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ผู้เล่นที่ตกรอบ')).toHaveClass('is-two-column')
  })

  it('accumulates leaderboard scores across replay with the same roster', () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expectLeaderboardRow('แพรว', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ต้น', [1, '-', '-', '-'], 1)

    fireEvent.click(
      screen.getByRole('button', { name: 'เล่นรอบถัดไปด้วยรายชื่อเดิม' }),
    )

    expect(screen.getByRole('heading', { name: 'ถึงตา แพรว' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มรอบแรก' })).toHaveFocus()
    expect(screen.getByLabelText('คำตอบของ แพรว')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มรอบแรก' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()

    expectLeaderboardRow('ต้น', [1, 3, '-', '-'], 4)
    expectLeaderboardRow('แพรว', [3, 1, '-', '-'], 4)
  })

  it('supports replaying with the same roster and resetting everything', () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    act(() => {
      vi.advanceTimersByTime(3100)
    })

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

    fireEvent.change(screen.getByLabelText('คำตอบของ แพรว'), {
      target: { value: 'กล้วย' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ต้น' }),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByLabelText('ตารางคะแนนสะสม')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใหม่' }))

    expect(
      screen.getByRole('heading', { name: 'จัดรายชื่อผู้เล่น' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('')
    expect(screen.queryByLabelText('ชื่อผู้เล่น 2')).not.toBeInTheDocument()
  })

  it('starts a new match and resets leaderboard scores after four rounds', () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    for (let round = 1; round <= MATCH_ROUNDS_PER_MATCH; round += 1) {
      act(() => {
        vi.advanceTimersByTime(3100)
      })

      const expectedSecondPlayer = round % 2 === 1 ? 'แพรว' : 'ต้น'
      const expectedFirstPlayerTotal = Math.ceil(round / 2) * 1 + Math.floor(round / 2) * 3
      const expectedSecondPlayerTotal = Math.ceil(round / 2) * 3 + Math.floor(round / 2) * 1

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

    expect(
      screen.getByText(
        `รอบ 1/${MATCH_ROUNDS_PER_MATCH} ของแมตช์นี้ • เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ`,
      ),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expectLeaderboardRow('แพรว', [3, '-', '-', '-'], 3)
    expectLeaderboardRow('ต้น', [1, '-', '-', '-'], 1)
  })
})

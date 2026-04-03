import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

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
    expect(
      screen.getByText('ชื่อผู้เล่นห้ามซ้ำหลังตัดช่องว่างหน้า-ท้าย'),
    ).toBeInTheDocument()
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

    expect(
      screen.getByRole('heading', { name: 'ผู้ชนะคือ บีม' }),
    ).toBeInTheDocument()
  })

  it('eliminates the current player when no input is started within 3 seconds', () => {
    startTwoPlayerGame('ออย', 'บีม')

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ออย' }),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(
      screen.getByRole('heading', { name: 'ผู้ชนะคือ บีม' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ตกรอบในรอบ 1')).toBeInTheDocument()
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
        'เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ',
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

    expect(
      screen.getByRole('heading', { name: 'ผู้ชนะคือ เอ' }),
    ).toBeInTheDocument()

    const leaderboard = within(screen.getByLabelText('ตารางคะแนนสะสม'))

    expect(
      leaderboard.getByLabelText('อันดับ 1 เอ 3 คะแนน ได้เพิ่ม 3 คะแนนรอบนี้'),
    ).toBeInTheDocument()
    expect(
      leaderboard.getByLabelText('อันดับ 2 ซี 1 คะแนน ได้เพิ่ม 1 คะแนนรอบนี้'),
    ).toBeInTheDocument()
    expect(
      leaderboard.getByLabelText('อันดับ 3 ดี 1 คะแนน ได้เพิ่ม 1 คะแนนรอบนี้'),
    ).toBeInTheDocument()
    expect(
      leaderboard.getByLabelText('อันดับ 4 บี 0 คะแนน'),
    ).toBeInTheDocument()
  })

  it('accumulates leaderboard scores across replay with the same roster', () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    let leaderboard = within(screen.getByLabelText('ตารางคะแนนสะสม'))

    expect(
      leaderboard.getByLabelText('อันดับ 1 แพรว 3 คะแนน ได้เพิ่ม 3 คะแนนรอบนี้'),
    ).toBeInTheDocument()
    expect(
      leaderboard.getByLabelText('อันดับ 2 ต้น 1 คะแนน ได้เพิ่ม 1 คะแนนรอบนี้'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'เล่นใหม่ด้วยรายชื่อเดิม' }))

    fireEvent.change(screen.getByLabelText('คำตอบของ ต้น'), {
      target: { value: 'กล้วย' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(
      screen.getByRole('heading', { name: 'ผู้ชนะคือ ต้น' }),
    ).toBeInTheDocument()

    leaderboard = within(screen.getByLabelText('ตารางคะแนนสะสม'))

    expect(
      leaderboard.getByLabelText('อันดับ 1 ต้น 4 คะแนน ได้เพิ่ม 3 คะแนนรอบนี้'),
    ).toBeInTheDocument()
    expect(
      leaderboard.getByLabelText('อันดับ 2 แพรว 4 คะแนน ได้เพิ่ม 1 คะแนนรอบนี้'),
    ).toBeInTheDocument()
  })

  it('supports replaying with the same roster and resetting everything', () => {
    startTwoPlayerGame('ต้น', 'แพรว')

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(
      screen.getByRole('heading', { name: 'ผู้ชนะคือ แพรว' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'เล่นใหม่ด้วยรายชื่อเดิม' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา ต้น' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('คำตอบของ ต้น'), {
      target: { value: 'กล้วย' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }))

    expect(
      screen.getByRole('heading', { name: 'ถึงตา แพรว' }),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })

    expect(
      screen.getByRole('heading', { name: 'ผู้ชนะคือ ต้น' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใหม่ทั้งหมด' }))

    expect(
      screen.getByRole('heading', { name: 'จัดรายชื่อผู้เล่น' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('')
    expect(screen.queryByLabelText('ชื่อผู้เล่น 2')).not.toBeInTheDocument()
  })
})

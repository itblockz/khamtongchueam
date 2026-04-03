import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'

function startTwoPlayerGame(firstPlayer: string, secondPlayer: string) {
  render(<App />)

  fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 1'), {
    target: { value: firstPlayer },
  })
  fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 2'), {
    target: { value: secondPlayer },
  })
  fireEvent.click(screen.getByRole('button', { name: 'เริ่มเกม' }))
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

  it('requires at least two unique trimmed names before starting', () => {
    render(<App />)

    const startButton = screen.getByRole('button', { name: 'เริ่มเกม' })

    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 1'), {
      target: { value: 'มีน' },
    })
    fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 2'), {
      target: { value: ' มีน ' },
    })

    expect(
      screen.getByText('ชื่อผู้เล่นห้ามซ้ำหลังตัดช่องว่างหน้า-ท้าย'),
    ).toBeInTheDocument()
    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('ชื่อผู้เล่น 2'), {
      target: { value: 'มายด์' },
    })

    expect(startButton).toBeEnabled()
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
      screen.getByRole('heading', { name: 'เพิ่มผู้เล่น' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('ชื่อผู้เล่น 1')).toHaveValue('')
    expect(screen.getByLabelText('ชื่อผู้เล่น 2')).toHaveValue('')
  })
})

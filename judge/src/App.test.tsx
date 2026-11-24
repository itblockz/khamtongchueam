import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'

const SYLLABLES: Record<string, string[]> = {
  มหา: ['ม', 'หา'],
  หาดทราย: ['หาด', 'ทราย'],
  ทรายทอง: ['ทราย', 'ทอง'],
  กาแฟ: ['กา', 'แฟ'],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { text } = JSON.parse(String(init?.body)) as { text: string }
      return {
        ok: true,
        json: async () => ({ syllables: SYLLABLES[text] ?? [text] }),
      }
    }),
  )
})

function startWith(names: string) {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/รายชื่อผู้เล่น/), { target: { value: names } })
  fireEvent.click(screen.getByRole('button', { name: 'เริ่มเกม' }))
}

async function submit(word: string) {
  fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: word } })
  fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
  await waitFor(() => expect(screen.getByLabelText(/^คำของ/)).toHaveValue(''))
}

describe('judge app', () => {
  it('blocks starting with repeated names', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText(/รายชื่อผู้เล่น/), { target: { value: 'ออย\nบีม\nออย' } })

    expect(screen.getByText('ชื่อซ้ำ: ออย')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มเกม' })).toBeDisabled()
  })

  it('moves the turn after a word and lists it with its syllables', async () => {
    startWith('ออย\nบีม')
    expect(screen.getByText('ออย', { selector: 'strong' })).toBeInTheDocument()

    await submit('มหา')

    expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('ม | หา')).toBeInTheDocument()
  })

  it('puts the player out straight away on a repeated syllable and says why', async () => {
    startWith('ออย\nบีม\nเจ')
    await submit('หาดทราย')
    await submit('ทรายทอง')

    const notice = screen.getByRole('status', { name: '' })
    expect(within(notice).getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()
    expect(within(notice).getByText('“ทราย” ซ้ำกับคำ “หาดทราย”')).toBeInTheDocument()
    expect(screen.getByText('เจ', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('คำที่ใช้แล้ว (1)')).toBeInTheDocument()

    await submit('กาแฟ')
    expect(screen.queryByRole('heading', { name: 'บีม ตกรอบ' })).not.toBeInTheDocument()
  })

  it('shows the winner with the reason for the last elimination', async () => {
    startWith('ออย\nบีม')
    await submit('หาดทราย')
    // the last word ends the game, so the input disappears instead of clearing
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ทรายทอง' } })
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))

    expect(await screen.findByRole('heading', { name: 'ออย ชนะ' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'เล่นอีกรอบ' }))
    expect(screen.getByText('ยังไม่มีคำในรอบนี้')).toBeInTheDocument()
  })
})

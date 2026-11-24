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

  it('asks the judge about a duplicate and lets the word pass when overruled', async () => {
    startWith('ออย\nบีม')
    await submit('หาดทราย')
    await submit('ทรายทอง')

    const dialog = screen.getByRole('alertdialog', { name: 'พยางค์ซ้ำ?' })
    expect(within(dialog).getByText('“ทราย” ซ้ำกับคำ “หาดทราย”')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'ไม่ซ้ำ ให้ผ่าน' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('ออย', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('คำที่ใช้แล้ว (2)')).toBeInTheDocument()
  })

  it('eliminates on a confirmed duplicate and shows the winner', async () => {
    startWith('ออย\nบีม')
    await submit('หาดทราย')
    await submit('ทรายทอง')

    fireEvent.click(screen.getByRole('button', { name: 'บีม ตกรอบ' }))

    expect(screen.getByRole('heading', { name: 'ออย ชนะ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'เล่นอีกรอบ' }))
    expect(screen.getByText('ยังไม่มีคำในรอบนี้')).toBeInTheDocument()
  })
})

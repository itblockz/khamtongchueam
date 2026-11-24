import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'

const SYLLABLES: Record<string, string[]> = {
  อาหาร: ['อา', 'หาร'],
  อารบิก: ['อาร', 'บิก'],
  บิกินี: ['บิ', 'กิ', 'นี'],
  ไปรษณีย์: ['ไป', 'รษ', 'ณีย์'],
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
    expect(screen.getByText('คำในรอบนี้ (นับ 1)')).toBeInTheDocument()

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

  it('lets the judge correct the split before sending', async () => {
    startWith('ออย\nบีม')
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ไปรษณีย์' } })
    expect(await screen.findByText('ไป | รษ | ณีย์')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'แก้การแยก' }))
    const splitInput = screen.getByLabelText(/แก้การแยกพยางค์/)
    expect(splitInput).toHaveValue('ไป รษ ณีย์')

    fireEvent.change(splitInput, { target: { value: 'ไปร ษ ณีย์' } })
    expect(screen.getByText('ไปร | ษ | ณีย์')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))

    const list = await screen.findByRole('list')
    expect(within(list).getByText('ไปร | ษ | ณีย์')).toBeInTheDocument()
    expect(within(list).getByText('แยกเอง')).toBeInTheDocument()
    expect(screen.queryByLabelText(/แก้การแยกพยางค์/)).not.toBeInTheDocument()
  })

  it('drops a correction when the word itself changes', async () => {
    startWith('ออย\nบีม')
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ไปรษณีย์' } })
    await screen.findByText('ไป | รษ | ณีย์')
    fireEvent.click(screen.getByRole('button', { name: 'แก้การแยก' }))

    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'กาแฟ' } })

    expect(screen.queryByLabelText(/แก้การแยกพยางค์/)).not.toBeInTheDocument()
  })

  it('undoes the last word, bringing back a player who went out on it', async () => {
    startWith('ออย\nบีม\nเจ')
    expect(screen.getByRole('button', { name: 'ย้อนกลับ' })).toBeDisabled()
    await submit('หาดทราย')
    await submit('ทรายทอง')
    expect(screen.getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))

    expect(screen.queryByRole('heading', { name: 'บีม ตกรอบ' })).not.toBeInTheDocument()
    expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText(/ยังเล่นอยู่: ออย, บีม, เจ/)).toBeInTheDocument()
  })

  it('can undo from the winner screen back into the round', async () => {
    startWith('ออย\nบีม')
    await submit('หาดทราย')
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ทรายทอง' } })
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
    await screen.findByRole('heading', { name: 'ออย ชนะ' })

    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))

    expect(screen.queryByRole('heading', { name: 'ออย ชนะ' })).not.toBeInTheDocument()
    expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
  })

  it('corrects an earlier word, shows what changes, then applies it', async () => {
    startWith('ชช\nลล\nมม')
    await submit('อาหาร')
    await submit('อารบิก')
    await submit('บิกินี')

    fireEvent.click(screen.getByRole('button', { name: 'แก้การแยก อารบิก' }))
    const field = screen.getByLabelText(/แก้การแยก “อารบิก”/)
    expect(field).toHaveValue('อาร บิก')

    fireEvent.change(field, { target: { value: 'อา ร บิก' } })
    expect(screen.getByText('ลล ตกรอบที่คำ “อารบิก” (“อา” ซ้ำกับ “อาหาร”)')).toBeInTheDocument()
    expect(screen.getByText('ย้อนกลับไปตาของ มม · ลบ 1 คำหลังจากนั้น: บิกินี')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    expect(screen.getByRole('heading', { name: 'ลล ตกรอบ' })).toBeInTheDocument()
    expect(screen.getByText('มม', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('พยางค์ซ้ำ')).toBeInTheDocument()
    expect(screen.queryByText('บิกินี')).not.toBeInTheDocument()
  })

  it('lets the judge put the current player out as not a noun, and undo it', async () => {
    startWith('ออย\nบีม\nเจ')
    await submit('กาแฟ')
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'วิ่ง' } })

    fireEvent.click(screen.getByRole('button', { name: 'ไม่ใช่คำนาม' }))

    expect(screen.getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()
    expect(screen.getByText('“วิ่ง” ไม่ใช่คำนาม')).toBeInTheDocument()
    expect(screen.getByText('เจ', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^คำของ/)).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'แก้การแยก วิ่ง' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))
    expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
  })

  it('needs a typed word before the judge can decide', () => {
    startWith('ออย\nบีม')
    expect(screen.getByRole('button', { name: 'คำต้องห้าม' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'คำหยาบ' } })
    fireEvent.click(screen.getByRole('button', { name: 'คำต้องห้าม' }))

    expect(screen.getByRole('heading', { name: 'บีม ชนะ' })).toBeInTheDocument()
    expect(screen.getByText('“คำหยาบ” คำต้องห้าม')).toBeInTheDocument()
  })

})

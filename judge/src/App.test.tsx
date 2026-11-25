import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import type { RemoteGame } from './cloud'

// Stand-in for Google sign-in and the account backup (no network in tests)
const cloud = vi.hoisted(() => ({
  account: null as { id: string; email: string | null } | null,
  remote: [] as RemoteGame[],
  pushed: [] as RemoteGame[][],
}))
vi.mock('./cloud', () => ({
  watchAccount: (listener: (a: typeof cloud.account) => void) => {
    listener(cloud.account)
    return () => {}
  },
  signInWithGoogle: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => {}),
  pullGames: vi.fn(async () => cloud.remote),
  pushGames: vi.fn(async (games: RemoteGame[]) => {
    cloud.pushed.push(games)
  }),
}))
import { resetDbForTests } from './storage'

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

beforeEach(async () => {
  localStorage.clear()
  cloud.account = null
  cloud.remote = []
  cloud.pushed = []
  resetDbForTests()
  globalThis.indexedDB = new IDBFactory()
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

/** Render the app and wait until it has loaded the saved games. */
async function renderApp() {
  const view = render(<App />)
  await waitFor(() => expect(screen.queryByText('กำลังโหลด…')).not.toBeInTheDocument())
  return view
}

async function startWith(names: string) {
  await renderApp()
  fireEvent.change(screen.getByLabelText(/รายชื่อผู้เล่น/), { target: { value: names } })
  fireEvent.click(screen.getByRole('button', { name: 'เริ่มเกม' }))
}

async function submit(word: string) {
  fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: word } })
  fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
  await waitFor(() => expect(screen.getByLabelText(/^คำของ/)).toHaveValue(''))
}

describe('judge app', () => {
  it('blocks starting with repeated names', async () => {
    await renderApp()
    fireEvent.change(screen.getByLabelText(/รายชื่อผู้เล่น/), { target: { value: 'ออย\nบีม\nออย' } })

    expect(screen.getByText('ชื่อซ้ำ: ออย')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เริ่มเกม' })).toBeDisabled()
  })

  it('moves the turn after a word and lists it with its syllables', async () => {
    await startWith('ออย\nบีม')
    expect(screen.getByText('ออย', { selector: 'strong' })).toBeInTheDocument()

    await submit('มหา')

    expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('ม | หา')).toBeInTheDocument()
  })

  it('puts the player out straight away on a repeated syllable and says why', async () => {
    await startWith('ออย\nบีม\nเจ')
    await submit('หาดทราย')
    await submit('ทรายทอง')

    const notice = screen.getByRole('status', { name: '' })
    expect(within(notice).getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()
    expect(within(notice).getByText('“ทราย” ซ้ำกับ คำที่ 1 “หาดทราย” ของ ออย')).toBeInTheDocument()
    expect(screen.getByText('เจ', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('คำในรอบนี้ (นับ 1)')).toBeInTheDocument()
    // once in the notice, once in the word list
    expect(screen.getAllByText('“ทราย” ซ้ำกับ คำที่ 1 “หาดทราย” ของ ออย')).toHaveLength(2)

    await submit('กาแฟ')
    expect(screen.queryByRole('heading', { name: 'บีม ตกรอบ' })).not.toBeInTheDocument()
  })

  it('shows the winner with the reason for the last elimination', async () => {
    await startWith('ออย\nบีม')
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
    await startWith('ออย\nบีม')
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
    await startWith('ออย\nบีม')
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ไปรษณีย์' } })
    await screen.findByText('ไป | รษ | ณีย์')
    fireEvent.click(screen.getByRole('button', { name: 'แก้การแยก' }))

    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'กาแฟ' } })

    expect(screen.queryByLabelText(/แก้การแยกพยางค์/)).not.toBeInTheDocument()
  })

  it('undoes the last word, bringing back a player who went out on it', async () => {
    await startWith('ออย\nบีม\nเจ')
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
    await startWith('ออย\nบีม')
    await submit('หาดทราย')
    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ทรายทอง' } })
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
    await screen.findByRole('heading', { name: 'ออย ชนะ' })

    fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))

    expect(screen.queryByRole('heading', { name: 'ออย ชนะ' })).not.toBeInTheDocument()
    expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
  })

  it('corrects an earlier word, shows what changes, then applies it', async () => {
    await startWith('ชช\nลล\nมม')
    await submit('อาหาร')
    await submit('อารบิก')
    await submit('บิกินี')

    fireEvent.click(screen.getByRole('button', { name: 'แก้การแยก อารบิก' }))
    const field = screen.getByLabelText(/แก้การแยก “อารบิก”/)
    expect(field).toHaveValue('อาร บิก')

    fireEvent.change(field, { target: { value: 'อา ร บิก' } })
    expect(screen.getByText('ลล ตกรอบที่คำ “อารบิก” (“อา” ซ้ำกับ คำที่ 1 “อาหาร” ของ ชช)')).toBeInTheDocument()
    expect(screen.getByText('ย้อนกลับไปตาของ มม · ลบ 1 คำหลังจากนั้น: บิกินี')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    expect(screen.getByRole('heading', { name: 'ลล ตกรอบ' })).toBeInTheDocument()
    expect(screen.getByText('มม', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('พยางค์ซ้ำ')).toBeInTheDocument()
    expect(screen.queryByText('บิกินี')).not.toBeInTheDocument()
  })

  it('lets the judge put the current player out as not a noun, and undo it', async () => {
    await startWith('ออย\nบีม\nเจ')
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

  it('needs a typed word before the judge can decide', async () => {
    await startWith('ออย\nบีม')
    expect(screen.getByRole('button', { name: 'คำต้องห้าม' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'คำหยาบ' } })
    fireEvent.click(screen.getByRole('button', { name: 'คำต้องห้าม' }))

    expect(screen.getByRole('heading', { name: 'บีม ชนะ' })).toBeInTheDocument()
    expect(screen.getByText('“คำหยาบ” คำต้องห้าม')).toBeInTheDocument()
  })

  it('rules an earlier word out and rewinds to it after confirming', async () => {
    await startWith('ชช\nลล\nมม')
    await submit('อาหาร')
    await submit('บิกินี')
    await submit('กาแฟ')

    fireEvent.click(screen.getByRole('button', { name: 'ตัดสิน บิกินี' }))
    expect(screen.getByRole('button', { name: 'ยืนยัน' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'คำต้องห้าม' , pressed: false }))
    expect(screen.getByText('ย้อนกลับไปตาของ มม · ลบ 1 คำหลังจากนั้น: กาแฟ')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }))

    expect(screen.getByRole('heading', { name: 'ลล ตกรอบ' })).toBeInTheDocument()
    expect(screen.getByText('“บิกินี” คำต้องห้าม')).toBeInTheDocument()
    expect(screen.getByText('มม', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText('กาแฟ')).not.toBeInTheDocument()
  })

  it('has no judge button for not connecting: that is left to challenges', async () => {
    await startWith('ออย\nบีม\nเจ')
    await submit('กาแฟ')
    expect(screen.queryByRole('button', { name: 'ไม่เชื่อม' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ตัดสิน กาแฟ' }))
    const ruling = screen.getByRole('group', { name: 'ตัดสิน “กาแฟ”' })
    expect(within(ruling).queryByRole('button', { name: 'ไม่เชื่อม' })).not.toBeInTheDocument()
  })


  describe('turn timer', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits for the judge on the first turn, then runs out of time', async () => {
      await startWith('ออย\nบีม\nเจ')
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: /เริ่มจับเวลา/ }))
      expect(screen.getByRole('button', { name: 'จับเวลาใหม่' })).toBeInTheDocument()
      expect(screen.getByLabelText(/^คำของ/)).toHaveFocus()

      act(() => vi.advanceTimersByTime(3100))
      expect(screen.getByText('หมดเวลา')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'ไม่ทันเวลา' }))
      expect(screen.getByRole('heading', { name: 'ออย ตกรอบ' })).toBeInTheDocument()
      expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
    })

    it('can restart the count at any time', async () => {
      await startWith('ออย\nบีม')
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: /เริ่มจับเวลา/ }))
      act(() => vi.advanceTimersByTime(2000))
      fireEvent.click(screen.getByRole('button', { name: 'จับเวลาใหม่' }))
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.queryByText('หมดเวลา')).not.toBeInTheDocument()

      act(() => vi.advanceTimersByTime(1100))
      expect(screen.getByText('หมดเวลา')).toBeInTheDocument()
    })

    it('starts counting on its own after a word is sent', async () => {
      await startWith('ออย\nบีม\nเจ')
      await submit('กาแฟ')
      expect(await screen.findByRole('button', { name: 'จับเวลาใหม่' })).toBeInTheDocument()
    })

    it('counts on its own after a word, but waits for the judge after someone goes out', async () => {
      await renderApp()
      fireEvent.change(screen.getByLabelText(/รายชื่อผู้เล่น/), { target: { value: 'ออย\nบีม\nเจ' } })
      fireEvent.change(screen.getByLabelText(/เวลาต่อตา/), { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'เริ่มเกม' }))

      await submit('หาดทราย')
      expect(await screen.findByRole('button', { name: 'จับเวลาใหม่' })).toBeInTheDocument()

      await submit('ทรายทอง')
      expect(screen.getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: 'เริ่มจับเวลา (5 วิ)' })).toBeInTheDocument()
    })
  })

  describe('saved game', () => {
    it('picks the round back up after a reload', async () => {
      const { unmount } = await renderApp()
      fireEvent.change(screen.getByLabelText(/รายชื่อผู้เล่น/), { target: { value: 'ออย\nบีม\nเจ' } })
      fireEvent.change(screen.getByLabelText(/เวลาต่อตา/), { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'เริ่มเกม' }))
      await submit('กาแฟ')
      unmount()

      await renderApp()
      expect(screen.getByText('บีม', { selector: 'strong' })).toBeInTheDocument()
      expect(screen.getByText('กา | แฟ')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))
      fireEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))
      expect(screen.getByRole('button', { name: 'เริ่มจับเวลา (5 วิ)' })).toBeInTheDocument()
    })

    it('keeps a game in progress across a remount', async () => {
      await startWith('ออย\nบีม')
      await cleanupAndRender()
      expect(screen.getByText('ออย', { selector: 'strong' })).toBeInTheDocument()
    })

    it('ignores saved data it cannot read', async () => {
      localStorage.setItem('khamtongchueam.judge.v2', '{"games":[{"id":"x","round":{"players":"oops"}}]')
      await renderApp()
      expect(screen.getByLabelText(/รายชื่อผู้เล่น/)).toHaveValue('')
    })
  })

  it('goes back to the first page and carries on with the same game', async () => {
    await startWith('ออย\nบีม')
    await submit('กาแฟ')
    fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))

    expect(screen.getByLabelText(/รายชื่อผู้เล่น/)).toHaveValue('ออย\nบีม')
    expect(screen.getByText('กำลังเล่น · ตาของ บีม')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'เล่นต่อ ออย, บีม' }))
    expect(screen.getByText('กา | แฟ')).toBeInTheDocument()
  })


  describe('saved games', () => {
    it('keeps a finished game when playing again, and lists both', async () => {
      await startWith('ออย\nบีม')
      await submit('หาดทราย')
      fireEvent.change(screen.getByLabelText(/^คำของ/), { target: { value: 'ทรายทอง' } })
      fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
      await screen.findByRole('heading', { name: 'ออย ชนะ' })

      fireEvent.click(screen.getByRole('button', { name: 'เล่นอีกรอบ' }))
      fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))

      expect(screen.getByText('ออย ชนะ')).toBeInTheDocument()
      expect(screen.getByText('กำลังเล่น · ตาของ ออย')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'ดู ออย, บีม' }))
      expect(screen.getByRole('heading', { name: 'ออย ชนะ' })).toBeInTheDocument()
    })

    it('deletes a game after asking', async () => {
      await startWith('ออย\nบีม')
      fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: 'ลบเกม ออย, บีม' }))
      expect(screen.queryByText('เกมที่บันทึกไว้ในเครื่องนี้')).not.toBeInTheDocument()
    })

    it('carries over a game saved by the previous version', async () => {
      localStorage.setItem(
        'khamtongchueam.judge.v1',
        JSON.stringify({
          namesText: 'ออย\nบีม',
          seconds: 4,
          round: {
            players: [
              { id: 'p1', name: 'ออย' },
              { id: 'p2', name: 'บีม' },
            ],
            events: [{ type: 'word', playerId: 'p1', word: 'กาแฟ', syllables: ['กา', 'แฟ'] }],
          },
        }),
      )
      await renderApp()
      expect(screen.getByText('กา | แฟ')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'เริ่มจับเวลา (4 วิ)' })).toBeInTheDocument()
    })
  })

  it('records a lost challenge against an earlier word', async () => {
    await startWith('ออย\nบีม\nเจ')
    await submit('อาหาร')
    await submit('กาแฟ')

    // the first word has nothing before it, so it cannot be challenged
    expect(screen.queryByRole('button', { name: 'ชาเลนจ์ อาหาร' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์ กาแฟ' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'คนชาเลนจ์' })).getByRole('button', { name: 'เจ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ไม่สำเร็จ (เจ ตก)' }))
    expect(screen.getByText('เจ ตกรอบ')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }))

    expect(screen.getByRole('heading', { name: 'เจ ตกรอบ' })).toBeInTheDocument()
    expect(screen.getAllByText(/ชาเลนจ์ คำที่ 2 “กาแฟ” ว่าไม่เชื่อม/)).toHaveLength(2)
    // it was เจ's turn, so the turn moves on
    expect(screen.getByText('ออย', { selector: 'strong' })).toBeInTheDocument()
  })

  it('a successful challenge puts the speaker out and goes back to that word', async () => {
    await startWith('ออย\nบีม\nเจ')
    await submit('อาหาร')
    await submit('กาแฟ')
    await submit('บิกินี')

    fireEvent.click(screen.getByRole('button', { name: 'ชาเลนจ์ กาแฟ' }))
    // ออย said the word before, so ออย is picked already
    expect(within(screen.getByRole('group', { name: 'คนชาเลนจ์' })).getByRole('button', { name: 'ออย' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'สำเร็จ (บีม ตก)' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }))

    expect(screen.getByRole('heading', { name: 'บีม ตกรอบ' })).toBeInTheDocument()
    expect(screen.getByText('“กาแฟ” ไม่เชื่อม (ชาเลนจ์โดย ออย)')).toBeInTheDocument()
    expect(screen.queryByText('บิกินี')).not.toBeInTheDocument()
  })

  it('sends the game without names a moment after it changes', async () => {
    await startWith('ออย\nบีม')
    await submit('กาแฟ')
    const fetchMock = vi.mocked(fetch)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/judge/games')).toBe(true),
      { timeout: 3000 },
    )
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/judge/games')!
    const body = String(init?.body)
    expect(body).toContain('กาแฟ')
    expect(body).not.toMatch(/ออย|บีม/)
  })

  it('imports games from an exported file', async () => {
    await renderApp()
    const file = new File(
      [
        JSON.stringify({
          app: 'khamtongchueam-judge',
          version: 1,
          exportedAt: 1,
          games: [
            {
              id: 'imported1',
              createdAt: 1,
              updatedAt: 1,
              round: {
                players: [
                  { id: 'p1', name: 'ออย' },
                  { id: 'p2', name: 'บีม' },
                ],
                events: [{ type: 'word', playerId: 'p1', word: 'กาแฟ', syllables: ['กา', 'แฟ'] }],
              },
            },
          ],
        }),
      ],
      'games.json',
      { type: 'application/json' },
    )
    fireEvent.change(screen.getByLabelText('ไฟล์เกมที่จะนำเข้า'), { target: { files: [file] } })
    expect(await screen.findByText('นำเข้า 1 เกมใหม่')).toBeInTheDocument()
    expect(screen.getByText('กำลังเล่น · ตาของ บีม')).toBeInTheDocument()
  })

  it('retries a failed send on the next open, and does not resend what arrived', async () => {
    const fetchMock = vi.mocked(fetch)
    let serverUp = false
    const uploads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/judge/games').length
    fetchMock.mockImplementation(async (url, init) => {
      if (url === '/api/judge/games') return { ok: serverUp, json: async () => ({}) } as Response
      const { text } = JSON.parse(String(init?.body)) as { text: string }
      return { ok: true, json: async () => ({ syllables: SYLLABLES[text] ?? [text] }) } as Response
    })

    await startWith('ออย\nบีม')
    await submit('กาแฟ')
    await waitFor(() => expect(uploads()).toBe(1), { timeout: 3000 })
    cleanup()

    serverUp = true
    await renderApp()
    await waitFor(() => expect(uploads()).toBe(2), { timeout: 3000 })
    cleanup()

    await renderApp()
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(uploads()).toBe(2)
  }, 10000)

  describe('account backup', () => {
    it('offers Google sign-in but plays without it', async () => {
      await startWith('ออย\nบีม')
      fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))
      expect(screen.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' })).toBeInTheDocument()
    })

    it('brings in games from the account and backs up this device\'s games', async () => {
      cloud.account = { id: 'u1', email: 'judge@example.com' }
      cloud.remote = [
        {
          id: 'fromcloud1',
          updatedAt: 5,
          deleted: false,
          game: {
            id: 'fromcloud1',
            createdAt: 1,
            updatedAt: 5,
            round: {
              players: [
                { id: 'p1', name: 'เจ' },
                { id: 'p2', name: 'บีม' },
              ],
              events: [{ type: 'word', playerId: 'p1', word: 'กาแฟ', syllables: ['กา', 'แฟ'] }],
            },
          },
        },
      ]
      await startWith('ออย\nบีม')
      await submit('มหา')
      fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))

      expect(screen.getByText(/เข้าสู่ระบบเป็น judge@example.com/)).toBeInTheDocument()
      expect(await screen.findByText('กำลังเล่น · ตาของ บีม', {}, { timeout: 4000 })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByText(/สำรองล่าสุด/)).toBeInTheDocument(), { timeout: 4000 })
      const pushedIds = cloud.pushed.flat().map((g) => g.id)
      expect(pushedIds).not.toContain('fromcloud1')
      expect(pushedIds.length).toBeGreaterThan(0)
    }, 10000)

    it('shows a retry button only when a backup fails', async () => {
      const { pullGames } = await import('./cloud')
      cloud.account = { id: 'u1', email: null }
      vi.mocked(pullGames).mockRejectedValueOnce(new Error('offline'))
      await startWith('ออย\nบีม')
      fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))
      expect(screen.queryByRole('button', { name: 'ลองอีกครั้ง' })).not.toBeInTheDocument()

      fireEvent.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }, { timeout: 4000 }))
      await waitFor(() => expect(screen.getByText(/สำรองล่าสุด/)).toBeInTheDocument(), { timeout: 4000 })
      expect(screen.queryByRole('button', { name: 'ลองอีกครั้ง' })).not.toBeInTheDocument()
    }, 10000)

    it('sends a deletion to the account', async () => {
      cloud.account = { id: 'u1', email: null }
      await startWith('ออย\nบีม')
      fireEvent.click(screen.getByRole('button', { name: 'หน้าแรก' }))
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: 'ลบเกม ออย, บีม' }))
      await waitFor(
        () => expect(cloud.pushed.flat().some((g) => g.deleted)).toBe(true),
        { timeout: 4000 },
      )
    }, 10000)
  })
})

async function cleanupAndRender() {
  cleanup()
  await renderApp()
}

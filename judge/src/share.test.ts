// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addWord, judgeOut, startRound } from './game'
import { hasSharedGame, QR_MAX_LENGTH, readShared, shareLink } from './share'
import type { SavedGame } from './storage'

const WORDS = [
  'ตะขบ', 'แมลง', 'ผีเสื้อ', 'ขา', 'แขน', 'ตัว', 'หู', 'จมูก', 'ปาก', 'ขน', 'แมว', 'หมา', 'ไก่', 'ปลา',
  'สิงโต', 'หมอ', 'เข็ม', 'ดารา', 'ใหม่', 'พี่เต๋อ', 'จีดีเอช', 'บุฟเฟต์', 'แชนแนล', 'เทพลีลา', 'โอฮาน่า',
  'เกม', 'คอมพิวเตอร์', 'เมาส์', 'ลูกกลิ้ง', 'โรลออน', 'ดอกไม้', 'น้ำหอม', 'ดิออร์', 'แจ็ก สแปร์โรว์',
  'โจร', 'ตำรวจ', 'กุญแจมือ', 'โซ่', 'แส้', 'ม้า', 'เกือก', 'รองเท้า', 'พื้น', 'ไม้', 'อะโวคาโด', 'กล้วย',
  'เปลือก', 'ส้ม', 'มะม่วง', 'ไฟเบอร์', 'ไส้', 'ตูด', 'อุจจาระ', 'ผักบุ้ง', 'สีเขียว', 'กัญชา', 'แมว',
  'หนุ่ย', 'ชื่อ', 'เสียง', 'ลำโพง', 'สปีกเกอร์', 'ส้วม', 'ห้อง', 'บ้าน', 'คาน', 'หญิงสาว', 'ชายชรา',
  'ลิเทียม', 'เคมี', 'ชีวะ', 'โรงเรียน', 'เรสซิเดนท์อีวิล', 'กระเป๋า', 'สบาย', 'ขนม', 'ราชการ', 'อุบัติเหตุ',
  'ประวัติศาสตร์', 'ไปรษณีย์', 'มหาวิทยาลัย', 'โทรศัพท์',
]

function longGame(): SavedGame {
  let round = startRound(['เติ๊ด', 'สมัคร', 'มาร์ค', 'ใบปอ', 'ไทย', 'เหว่ง'])
  for (const word of WORDS) {
    round = addWord(round, word, word.match(/.{1,3}/gu) ?? [word])
  }
  round = judgeOut(round, 'too-slow', '')
  return { id: 'abc123def', createdAt: 1, updatedAt: 2, round }
}

describe('share link', () => {
  it('carries the whole game and reads back the same', async () => {
    const game = longGame()
    const link = await shareLink(game, 'https://example.app')
    expect(link.startsWith('https://example.app/#game=g1.')).toBe(true)
    expect(hasSharedGame(new URL(link).hash)).toBe(true)
    expect(await readShared(new URL(link).hash)).toEqual(game)
  })

  it('keeps a long game small enough for a QR code', async () => {
    const link = await shareLink(longGame(), 'https://khamtongchueam.vercel.app')
    expect(link.length).toBeLessThan(QR_MAX_LENGTH)
  })

  it('ignores links that are not a shared game or are broken', async () => {
    expect(await readShared('')).toBeNull()
    expect(await readShared('#other')).toBeNull()
    expect(await readShared('#game=g1.not-real-data')).toBeNull()
  })
})

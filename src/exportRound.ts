import {
  getScoreAwards,
  type AnswerSource,
  type EliminationReason,
  type GameState,
  type LeaderboardAward,
} from './game'

interface ExportRoundInput {
  gameState: GameState
  leaderboardScores: Record<string, number>
  matchRoundNumber: number
  matchTotalRounds: number
}

const ELIMINATION_REASON_LABELS_TH: Record<EliminationReason, string> = {
  timeout: 'ไม่ทันเวลา',
  late_submit: 'ส่งคำช้าเกินเวลา',
  duplicate_syllable: 'ใช้พยางค์ซ้ำ',
  failed_challenge: 'ชาเลนจ์ไม่สำเร็จ',
  invalid_connection: 'คำไม่เชื่อมกัน',
  not_noun: 'ไม่ใช่คำนาม',
  forbidden_word: 'คำต้องห้าม',
}

const ANSWER_SOURCE_LABELS_TH: Record<AnswerSource, string> = {
  player: 'ผู้เล่น',
  gm_seed: 'คำเปิดจากพิธีกร',
}

type CsvCell = string | number | boolean | null | undefined

function escapeCsvField(value: CsvCell): string {
  if (value === null || value === undefined) {
    return ''
  }

  const stringValue =
    typeof value === 'boolean'
      ? value
        ? 'ใช่'
        : 'ไม่ใช่'
      : String(value)

  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function toCsvRow(values: CsvCell[]): string {
  return values.map(escapeCsvField).join(',')
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function formatTimestampForFilename(date: Date): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  const seconds = pad2(date.getSeconds())
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function formatTimestampThai(date: Date): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  const seconds = pad2(date.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function formatTurnDirection(direction: GameState['turnDirection']): string {
  return direction === 1 ? 'จากบนลงล่าง' : 'จากล่างขึ้นบน'
}

function compareLeaderboardAwards(
  left: LeaderboardAward,
  right: LeaderboardAward,
): number {
  const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER
  const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER

  if (leftPlacement !== rightPlacement) {
    return leftPlacement - rightPlacement
  }

  return right.points - left.points
}

function buildMetadataSection(input: ExportRoundInput, exportedAt: Date): string[] {
  const { gameState, matchRoundNumber, matchTotalRounds } = input
  const winner = gameState.players.find(
    (player) => player.id === gameState.winnerId,
  )
  const playerNames = gameState.players.map((player) => player.name).join('; ')

  return [
    '# ข้อมูลแมตช์',
    toCsvRow(['หัวข้อ', 'ค่า']),
    toCsvRow(['รอบที่', matchRoundNumber]),
    toCsvRow(['จำนวนรอบทั้งหมด', matchTotalRounds]),
    toCsvRow(['ทิศทางลำดับ', formatTurnDirection(gameState.turnDirection)]),
    toCsvRow(['รายชื่อผู้เล่น', playerNames]),
    toCsvRow(['ผู้ชนะ', winner?.name ?? '']),
    toCsvRow(['ส่งออกเมื่อ', formatTimestampThai(exportedAt)]),
  ]
}

function buildScoresSection(input: ExportRoundInput): string[] {
  const awards = [...getScoreAwards(input.gameState)].sort(
    compareLeaderboardAwards,
  )

  const header = toCsvRow([
    'ผู้เล่น',
    'อันดับ',
    'คะแนนตามอันดับ',
    'โบนัสผู้ชนะ',
    'โบนัสชาเลนจ์',
    'คะแนนรวมรอบนี้',
    'คะแนนสะสมในแมตช์',
  ])

  const rows = awards.map((award) =>
    toCsvRow([
      award.playerName,
      award.placement ?? '',
      award.standingPoints,
      award.winnerBonus,
      award.challengeBonus,
      award.points,
      input.leaderboardScores[award.playerId] ?? 0,
    ]),
  )

  return ['# คะแนนและการจัดอันดับ', header, ...rows]
}

function buildAnswerHistorySection(input: ExportRoundInput): string[] {
  const header = toCsvRow([
    'ลำดับ',
    'ผู้เล่น',
    'คำตอบ',
    'พยางค์',
    'ที่มา',
    'ถูกชาเลนจ์ลบล้าง',
  ])

  const rows = input.gameState.answerHistory.map((record, index) =>
    toCsvRow([
      index + 1,
      record.playerName,
      record.answer,
      record.syllables.join('|'),
      ANSWER_SOURCE_LABELS_TH[record.source] ?? record.source,
      record.invalidatedByChallenge,
    ]),
  )

  return ['# ประวัติคำตอบ', header, ...rows]
}

function buildEliminationsSection(input: ExportRoundInput): string[] {
  const eliminated = input.gameState.players
    .filter((player) => player.status === 'eliminated')
    .sort(
      (left, right) =>
        (left.eliminatedOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.eliminatedOrder ?? Number.MAX_SAFE_INTEGER),
    )

  const header = toCsvRow([
    'ลำดับ',
    'ผู้เล่น',
    'ตกรอบเมื่อรอบเดิน',
    'เหตุผล',
    'คำที่ส่งตอบ',
  ])

  const rows = eliminated.map((player, index) => {
    const reasonCode = player.eliminationReason
    const reasonLabel = reasonCode
      ? ELIMINATION_REASON_LABELS_TH[reasonCode]
      : ''

    return toCsvRow([
      player.eliminatedOrder ?? index + 1,
      player.name,
      player.eliminatedAtTurnCycle ?? '',
      reasonLabel,
      player.duplicateSubmittedAnswer ?? '',
    ])
  })

  return ['# การตกรอบ', header, ...rows]
}

function buildCsv(input: ExportRoundInput, exportedAt: Date): string {
  const sections = [
    buildMetadataSection(input, exportedAt),
    buildScoresSection(input),
    buildAnswerHistorySection(input),
    buildEliminationsSection(input),
  ]

  const body = sections.map((lines) => lines.join('\r\n')).join('\r\n\r\n')
  return `﻿${body}\r\n`
}

export function exportRoundToCsv(input: ExportRoundInput): void {
  const exportedAt = new Date()
  const csv = buildCsv(input, exportedAt)

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `คำต้องเชื่อม_รอบ-${input.matchRoundNumber}_${formatTimestampForFilename(exportedAt)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

import { describe, expect, it } from 'vitest'
import {
  acknowledgeRoundSummary,
  advanceChallengeDebate,
  advanceTurn,
  applyScoreAwards,
  beginChallengeSelection,
  CHALLENGE_DEBATE_SEGMENT_COUNT,
  createConfirmedGameState,
  createGameState,
  getChallengeableAnswers,
  getFinalPlacements,
  getScoreAwards,
  resolveChallenge,
  resumeChallengeDebate,
  startRoundWithOpeningWord,
  startActiveTurn,
  startChallengeDebate,
  TURN_DURATION_MS,
  updateChallengeSelection,
} from './game'

function submit(
  answer: string,
  now: number,
  syllables: string[] = [answer],
) {
  return {
    type: 'submit' as const,
    answer,
    syllables,
    now,
  }
}

function advanceDebateToJudging(state: ReturnType<typeof startChallengeDebate>) {
  let nextState = state
  let now = 2000

  for (let segment = 0; segment < CHALLENGE_DEBATE_SEGMENT_COUNT; segment += 1) {
    nextState = advanceChallengeDebate(
      nextState,
      nextState.challenge.segmentStartedAt ?? 0,
      now,
    )
    now += 1000
    if (segment < CHALLENGE_DEBATE_SEGMENT_COUNT - 1 && nextState.challenge.segmentAwaitingContinue) {
      nextState = resumeChallengeDebate(nextState, now)
      now += 1000
    }
  }

  return nextState
}

describe('advanceTurn', () => {
  it('can confirm players first and start the first turn later', () => {
    const confirmedState = createConfirmedGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      3000,
    )

    expect(confirmedState.phase).toBe('playing')
    expect(confirmedState.activePlayerId).toBe('a')
    expect(confirmedState.isAwaitingFirstTurnStart).toBe(true)
    expect(confirmedState.turnStartedAt).toBeNull()
    expect(confirmedState.turnDeadlineAt).toBeNull()
    expect(confirmedState.turnDirection).toBe(1)

    const startedState = startActiveTurn(confirmedState, 500, 3000)

    expect(startedState.isAwaitingFirstTurnStart).toBe(false)
    expect(startedState.turnStartedAt).toBe(500)
    expect(startedState.turnDeadlineAt).toBe(3500)
    expect(startedState.timeLeftMs).toBe(3000)
  })

  it('can start a confirmed game from the last player when the match round is reversed', () => {
    const confirmedState = createConfirmedGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      3000,
      -1,
    )

    expect(confirmedState.activePlayerId).toBe('c')
    expect(confirmedState.turnDirection).toBe(-1)
  })

  it('can start a confirmed round with a GM opening word without advancing the active player', () => {
    const confirmedState = createConfirmedGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      3000,
    )

    const startedState = startRoundWithOpeningWord(
      confirmedState,
      'alpha',
      ['a', 'lpha'],
      500,
      3000,
    )

    expect(startedState.activePlayerId).toBe('a')
    expect(startedState.isAwaitingFirstTurnStart).toBe(false)
    expect(startedState.turnStartedAt).toBe(500)
    expect(startedState.turnDeadlineAt).toBe(3500)
    expect(startedState.timeLeftMs).toBe(3000)
    expect(startedState.players.find((player) => player.id === 'a')?.answers).toEqual([])
    expect(startedState.usedSyllablesInRound).toEqual(['a', 'lpha'])
    expect(startedState.answerHistory).toHaveLength(1)
    expect(startedState.answerHistory[0]).toMatchObject({
      answer: 'alpha',
      previousValidAnswerId: null,
      source: 'gm_seed',
    })
  })

  it('links the first player answer to the GM opening word and exposes it to challenge flow', () => {
    const confirmedState = createConfirmedGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      3000,
    )

    const afterOpening = startRoundWithOpeningWord(
      confirmedState,
      'alpha',
      ['a'],
      100,
      3000,
    )
    const afterFirstSubmit = advanceTurn(afterOpening, submit('bravo', 200, ['b']))
    const openingRecord = afterFirstSubmit.answerHistory[0]
    const firstPlayerAnswer = afterFirstSubmit.answerHistory[1]

    expect(openingRecord?.source).toBe('gm_seed')
    expect(firstPlayerAnswer).toMatchObject({
      answer: 'bravo',
      source: 'player',
      previousValidAnswerId: openingRecord.id,
    })
    expect(
      getChallengeableAnswers(afterFirstSubmit).map((answerRecord) => answerRecord.answer),
    ).toEqual(['bravo'])
  })

  it('keeps the GM opening word valid when the first linked player answer is invalidated by challenge', () => {
    const confirmedState = createConfirmedGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      3000,
    )

    const afterOpening = startRoundWithOpeningWord(
      confirmedState,
      'alpha',
      ['a'],
      100,
      3000,
    )
    const afterFirstSubmit = advanceTurn(afterOpening, submit('bravo', 200, ['b']))
    const openingRecord = afterFirstSubmit.answerHistory[0]
    const challengedAnswer = afterFirstSubmit.answerHistory[1]
    const judgingState = {
      ...afterFirstSubmit,
      challenge: {
        ...afterFirstSubmit.challenge,
        status: 'judging' as const,
        challengerPlayerId: 'c',
        challengedAnswerId: challengedAnswer.id,
        challengedPlayerId: 'a',
        previousValidAnswerId: openingRecord.id,
        currentSpeaker: null,
        segmentIndex: 0,
        segmentStartedAt: null,
        segmentDeadlineAt: null,
        timeLeftMs: 0,
        segmentAwaitingContinue: false,
        awaitingChallengeStart: false,
      },
    }
    const resolvedState = resolveChallenge(judgingState, 'not_connects', 7000)

    expect(
      resolvedState.answerHistory
        .filter((answerRecord) => !answerRecord.invalidatedByChallenge)
        .map((answerRecord) => answerRecord.answer),
    ).toEqual(['alpha'])
    expect(
      resolvedState.answerHistory.find((answerRecord) => answerRecord.answer === 'alpha')
        ?.source,
    ).toBe('gm_seed')
    expect(resolvedState.usedSyllablesInRound).toEqual(['a'])
  })

  it('pauses the next turn after an elimination and keeps moving forward across cycle wraps', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterFirstSubmit = advanceTurn(initialState, submit('one', 100))
    const afterTimeout = advanceTurn(afterFirstSubmit, {
      type: 'timeout',
      now: 200,
    })
    const afterRoundWrap = advanceTurn(afterTimeout, submit('two', 300))
    const afterForwardContinue = advanceTurn(afterRoundWrap, submit('three', 400))

    expect(afterFirstSubmit.activePlayerId).toBe('b')
    expect(afterFirstSubmit.turnCycle).toBe(1)
    expect(afterFirstSubmit.turnStartedAt).toBe(100)

    expect(afterTimeout.activePlayerId).toBe('c')
    expect(afterTimeout.turnCycle).toBe(1)
    expect(afterTimeout.turnStartedAt).toBeNull()
    expect(afterTimeout.turnDeadlineAt).toBeNull()
    expect(afterTimeout.turnDirection).toBe(1)

    expect(afterRoundWrap.activePlayerId).toBe('a')
    expect(afterRoundWrap.turnCycle).toBe(2)
    expect(afterRoundWrap.turnStartedAt).toBe(300)
    expect(afterRoundWrap.turnDirection).toBe(1)

    expect(afterForwardContinue.activePlayerId).toBe('c')
    expect(afterForwardContinue.turnCycle).toBe(2)
  })

  it('keeps moving backward for the whole game when the turn direction is reversed', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
      3000,
      -1,
    )

    const afterC = advanceTurn(initialState, submit('charlie', 100))
    const afterB = advanceTurn(afterC, submit('bravo', 200))
    const afterWrap = advanceTurn(afterB, submit('alpha', 300))

    expect(initialState.activePlayerId).toBe('c')
    expect(initialState.turnDirection).toBe(-1)
    expect(afterC.activePlayerId).toBe('b')
    expect(afterC.turnCycle).toBe(1)
    expect(afterB.activePlayerId).toBe('a')
    expect(afterB.turnCycle).toBe(1)
    expect(afterWrap.activePlayerId).toBe('c')
    expect(afterWrap.turnCycle).toBe(2)
    expect(afterWrap.turnDirection).toBe(-1)
  })

  it('wraps to the opposite boundary in the same direction when the boundary player is eliminated', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100))
    const afterB = advanceTurn(afterA, submit('bravo', 200))
    const afterBoundaryTimeout = advanceTurn(afterB, {
      type: 'timeout',
      now: 300,
    })

    expect(afterB.activePlayerId).toBe('c')
    expect(afterB.turnCycle).toBe(1)
    expect(afterBoundaryTimeout.activePlayerId).toBe('a')
    expect(afterBoundaryTimeout.turnCycle).toBe(2)
    expect(afterBoundaryTimeout.turnStartedAt).toBeNull()
    expect(afterBoundaryTimeout.turnDeadlineAt).toBeNull()
    expect(
      afterBoundaryTimeout.players.find((player) => player.id === 'c')
        ?.eliminationReason,
    ).toBe('timeout')
  })

  it('tracks provided syllables used in the current match round for multi-syllable answers', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const afterSubmit = advanceTurn(
      initialState,
      submit('กาแฟ', 100, ['กา', 'แฟ']),
    )

    expect(afterSubmit.usedSyllablesInRound).toEqual(['กา', 'แฟ'])
  })

  it('accepts a provided leading-vowel syllable as-is', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const afterSubmit = advanceTurn(initialState, submit('แกง', 100, ['แกง']))

    expect(afterSubmit.usedSyllablesInRound).toEqual(['แกง'])
  })

  it('accepts provided Thai syllables with leading vowels and tone marks as-is', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const afterSubmit = advanceTurn(
      initialState,
      submit('ต้นไม้', 100, ['ต้น', 'ไม้']),
    )

    expect(afterSubmit.usedSyllablesInRound).toEqual(['ต้น', 'ไม้'])
  })

  it('eliminates a player immediately when they reuse a syllable in the same match round', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterFirstSubmit = advanceTurn(
      initialState,
      submit('กาแฟ', 100, ['กา', 'แฟ']),
    )
    const afterDuplicateSubmit = advanceTurn(
      afterFirstSubmit,
      submit('กากี', 200, ['กา', 'กี']),
    )

    expect(afterDuplicateSubmit.activePlayerId).toBe('c')
    expect(afterDuplicateSubmit.turnStartedAt).toBeNull()
    expect(afterDuplicateSubmit.turnDeadlineAt).toBeNull()
    expect(afterDuplicateSubmit.usedSyllablesInRound).toEqual(['กา', 'แฟ'])
    expect(
      afterDuplicateSubmit.players.find((player) => player.id === 'b')?.status,
    ).toBe('eliminated')
    expect(
      afterDuplicateSubmit.players.find((player) => player.id === 'b')
        ?.eliminationReason,
    ).toBe('duplicate_syllable')
    expect(
      afterDuplicateSubmit.players.find((player) => player.id === 'b')
        ?.duplicateSyllable,
    ).toBe('กา')
    expect(
      afterDuplicateSubmit.players.find((player) => player.id === 'b')
        ?.duplicateSourceAnswer,
    ).toBe('กาแฟ')
    expect(
      afterDuplicateSubmit.players.find((player) => player.id === 'b')
        ?.duplicateSubmittedAnswer,
    ).toBe('กากี')
  })

  it('keeps used syllables across in-game cycle wraps within the same match round', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const afterFirstSubmit = advanceTurn(initialState, submit('กา', 100, ['กา']))
    const afterCycleWrap = advanceTurn(afterFirstSubmit, submit('แฟ', 200, ['แฟ']))
    const afterDuplicateAcrossCycle = advanceTurn(
      afterCycleWrap,
      submit('กา', 300, ['กา']),
    )

    expect(afterCycleWrap.turnCycle).toBe(2)
    expect(afterCycleWrap.usedSyllablesInRound).toEqual(['กา', 'แฟ'])
    expect(afterDuplicateAcrossCycle.usedSyllablesInRound).toEqual([
      'กา',
      'แฟ',
    ])
    expect(
      afterDuplicateAcrossCycle.players.find((player) => player.id === 'a')
        ?.status,
    ).toBe('eliminated')
    expect(afterDuplicateAcrossCycle.phase).toBe('finished')
  })

  it('does not treat different provided syllable text as duplicates', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterFirstSubmit = advanceTurn(
      initialState,
      submit('เกา', 100, ['เกา']),
    )
    const afterDifferentTextSubmit = advanceTurn(
      afterFirstSubmit,
      submit('เก่า', 200, ['เก่า']),
    )

    expect(afterDifferentTextSubmit.activePlayerId).toBe('c')
    expect(afterDifferentTextSubmit.usedSyllablesInRound).toEqual([
      'เกา',
      'เก่า',
    ])
    expect(
      afterDifferentTextSubmit.players.find((player) => player.id === 'b')
        ?.status,
    ).toBe('active')
  })

  it('returns only the latest three valid answers for challenge selection', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'd', name: 'D' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100, ['a']))
    const afterB = advanceTurn(afterA, submit('bravo', 200, ['b']))
    const afterC = advanceTurn(afterB, submit('charlie', 300, ['c']))
    const afterD = advanceTurn(afterC, submit('delta', 400, ['d']))

    expect(getChallengeableAnswers(afterD).map((answerRecord) => answerRecord.answer)).toEqual([
      'delta',
      'charlie',
      'bravo',
    ])
  })

  it('preselects the latest valid answer when challenge selection opens', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100, ['a']))
    const afterB = advanceTurn(afterA, submit('bravo', 200, ['b']))
    const afterC = advanceTurn(afterB, submit('charlie', 300, ['c']))
    const selectingState = beginChallengeSelection(afterC)

    expect(selectingState.challenge.status).toBe('selecting')
    expect(
      selectingState.answerHistory.find(
        (answerRecord) => answerRecord.id === selectingState.challenge.challengedAnswerId,
      )?.answer,
    ).toBe('charlie')
    expect(selectingState.challenge.challengedPlayerId).toBe('c')
    expect(selectingState.challenge.previousValidAnswerId).not.toBeNull()
  })

  it('can invalidate a challenged chain, award bonus points, and move to the next player after the eliminated one', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100, ['a']))
    const afterB = advanceTurn(afterA, submit('bravo', 200, ['b']))
    const afterC = advanceTurn(afterB, submit('charlie', 300, ['c']))
    const challengedAnswer = getChallengeableAnswers(afterC).find(
      (answerRecord) => answerRecord.answer === 'bravo',
    )

    expect(challengedAnswer).toBeDefined()

    const selectingState = beginChallengeSelection(afterC)
    const selectedState = updateChallengeSelection(selectingState, {
      challengerPlayerId: 'a',
      challengedAnswerId: challengedAnswer?.id ?? null,
    })
    const debatingState = startChallengeDebate(selectedState, 1000)
    const judgingState = advanceDebateToJudging(debatingState)
    const resolvedState = resolveChallenge(judgingState, 'not_connects', 7000)

    expect(
      resolvedState.players.find((player) => player.id === 'b')?.status,
    ).toBe('eliminated')
    expect(
      resolvedState.players.find((player) => player.id === 'b')
        ?.eliminationReason,
    ).toBe('invalid_connection')
    expect(resolvedState.activePlayerId).toBe('c')
    expect(resolvedState.turnStartedAt).toBeNull()
    expect(resolvedState.usedSyllablesInRound).toEqual(['a'])
    expect(
      resolvedState.answerHistory
        .filter((answerRecord) => !answerRecord.invalidatedByChallenge)
        .map((answerRecord) => answerRecord.answer),
    ).toEqual(['alpha'])
    expect(resolvedState.challengeBonusPointsByPlayerId).toEqual({ a: 2 })
  })

  it('eliminates the challenger when the challenge fails and marks the challenged answer as already resolved', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100, ['a']))
    const afterB = advanceTurn(afterA, submit('bravo', 200, ['b']))
    const challengedAnswer = getChallengeableAnswers(afterB).find(
      (answerRecord) => answerRecord.answer === 'bravo',
    )
    const selectingState = beginChallengeSelection(afterB)
    const selectedState = updateChallengeSelection(selectingState, {
      challengerPlayerId: 'c',
      challengedAnswerId: challengedAnswer?.id ?? null,
    })
    const debatingState = startChallengeDebate(selectedState, 1000)
    const judgingState = advanceDebateToJudging(debatingState)
    const resolvedState = resolveChallenge(judgingState, 'connects', 7000)

    expect(
      resolvedState.players.find((player) => player.id === 'c')?.status,
    ).toBe('eliminated')
    expect(
      resolvedState.players.find((player) => player.id === 'c')
        ?.eliminationReason,
    ).toBe('failed_challenge')
    expect(resolvedState.activePlayerId).toBe('a')
    expect(resolvedState.turnCycle).toBe(2)
    expect(
      resolvedState.answerHistory.find(
        (answerRecord) => answerRecord.id === challengedAnswer?.id,
      )?.challengeResolved,
    ).toBe(true)
    expect(getChallengeableAnswers(resolvedState)).toEqual([])
    expect(resolvedState.usedSyllablesInRound).toEqual(['a', 'b'])
  })

  it('adds challenge bonus points to final score awards and can finish immediately after a successful challenge', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100, ['a']))
    const afterB = advanceTurn(afterA, submit('bravo', 200, ['b']))
    const challengedAnswer = getChallengeableAnswers(afterB)[0]
    const selectingState = beginChallengeSelection(afterB)
    const selectedState = updateChallengeSelection(selectingState, {
      challengerPlayerId: 'a',
      challengedAnswerId: challengedAnswer.id,
    })
    const debatingState = startChallengeDebate(selectedState, 1000)
    const judgingState = advanceDebateToJudging(debatingState)
    const finishedState = resolveChallenge(judgingState, 'not_connects', 7000)

    expect(finishedState.phase).toBe('finished')
    expect(finishedState.isAwaitingRoundSummary).toBe(true)

    expect(getScoreAwards(finishedState)).toEqual([
      {
        playerId: 'a',
        playerName: 'A',
        placement: 1,
        standingPoints: 1,
        winnerBonus: 2,
        challengeBonus: 2,
        points: 5,
      },
      {
        playerId: 'b',
        playerName: 'B',
        placement: 2,
        standingPoints: 1,
        winnerBonus: 0,
        challengeBonus: 0,
        points: 1,
      },
    ])
  })

  it('marks a late submit with the correct elimination reason', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      0,
    )

    const afterLateSubmit = advanceTurn(
      initialState,
      submit('กา', TURN_DURATION_MS + 100, ['กา']),
    )

    expect(afterLateSubmit.activePlayerId).toBe('b')
    expect(afterLateSubmit.turnStartedAt).toBeNull()
    expect(afterLateSubmit.usedSyllablesInRound).toEqual([])
    expect(
      afterLateSubmit.players.find((player) => player.id === 'a')
        ?.eliminationReason,
    ).toBe('late_submit')
  })

  it('marks the final active player as the winner', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const finishedState = advanceTurn(initialState, {
      type: 'timeout',
      now: 3000,
    })

    expect(finishedState.phase).toBe('finished')
    expect(finishedState.winnerId).toBe('b')
    expect(finishedState.isAwaitingRoundSummary).toBe(true)
    expect(finishedState.players.find((player) => player.id === 'b')?.status).toBe(
      'winner',
    )
    expect(finishedState.players.find((player) => player.id === 'a')?.status).toBe(
      'eliminated',
    )
  })

  it('can acknowledge the finished round before showing the summary screen', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const finishedState = advanceTurn(initialState, {
      type: 'timeout',
      now: 3000,
    })
    const acknowledgedState = acknowledgeRoundSummary(finishedState)

    expect(finishedState.isAwaitingRoundSummary).toBe(true)
    expect(acknowledgedState.isAwaitingRoundSummary).toBe(false)
    expect(acknowledgedState.phase).toBe('finished')
    expect(acknowledgedState.winnerId).toBe('b')
  })

  it('awards points to the last three players based on elimination order', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'd', name: 'D' },
      ],
      0,
    )

    const afterA = advanceTurn(initialState, submit('alpha', 100))
    const afterBTimeout = advanceTurn(afterA, {
      type: 'timeout',
      now: 200,
    })
    const afterC = advanceTurn(afterBTimeout, submit('charlie', 300))
    const afterDTimeout = advanceTurn(afterC, {
      type: 'timeout',
      now: 400,
    })
    const afterAAgain = advanceTurn(afterDTimeout, submit('atlas', 500))
    const finishedState = advanceTurn(afterAAgain, {
      type: 'timeout',
      now: 600,
    })

    expect(getFinalPlacements(finishedState).map((player) => player.id)).toEqual([
      'a',
      'c',
      'd',
      'b',
    ])

    expect(
      getScoreAwards(finishedState).map((award) => ({
        playerId: award.playerId,
        placement: award.placement,
        points: award.points,
      })),
    ).toEqual([
      { playerId: 'a', placement: 1, points: 3 },
      { playerId: 'c', placement: 2, points: 1 },
      { playerId: 'd', placement: 3, points: 1 },
    ])

    expect(
      applyScoreAwards(
        {
          a: 2,
          b: 5,
        },
        getScoreAwards(finishedState),
      ),
    ).toEqual({
      a: 5,
      b: 5,
      c: 1,
      d: 1,
    })
  })
})

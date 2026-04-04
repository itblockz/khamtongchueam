import { describe, expect, it } from 'vitest'
import {
  TURN_DURATION_MS,
  acknowledgeRoundSummary,
  applyScoreAwards,
  advanceTurn,
  createConfirmedGameState,
  createGameState,
  getFinalPlacements,
  getScoreAwards,
  startActiveTurn,
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

  it('pauses the next turn after an elimination and keeps moving forward across round wraps', () => {
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
    expect(afterFirstSubmit.round).toBe(1)
    expect(afterFirstSubmit.turnStartedAt).toBe(100)

    expect(afterTimeout.activePlayerId).toBe('c')
    expect(afterTimeout.round).toBe(1)
    expect(afterTimeout.turnStartedAt).toBeNull()
    expect(afterTimeout.turnDeadlineAt).toBeNull()
    expect(afterTimeout.turnDirection).toBe(1)

    expect(afterRoundWrap.activePlayerId).toBe('a')
    expect(afterRoundWrap.round).toBe(2)
    expect(afterRoundWrap.turnStartedAt).toBe(300)
    expect(afterRoundWrap.turnDirection).toBe(1)

    expect(afterForwardContinue.activePlayerId).toBe('c')
    expect(afterForwardContinue.round).toBe(2)
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
    expect(afterC.round).toBe(1)
    expect(afterB.activePlayerId).toBe('a')
    expect(afterB.round).toBe(1)
    expect(afterWrap.activePlayerId).toBe('c')
    expect(afterWrap.round).toBe(2)
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
    expect(afterB.round).toBe(1)
    expect(afterBoundaryTimeout.activePlayerId).toBe('a')
    expect(afterBoundaryTimeout.round).toBe(2)
    expect(afterBoundaryTimeout.turnStartedAt).toBeNull()
    expect(afterBoundaryTimeout.turnDeadlineAt).toBeNull()
    expect(
      afterBoundaryTimeout.players.find((player) => player.id === 'c')
        ?.eliminationReason,
    ).toBe('timeout')
  })

  it('tracks provided syllables used in the current round for multi-syllable answers', () => {
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

  it('eliminates a player immediately when they reuse a syllable in the same round', () => {
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
  })

  it('resets used syllables when the in-game round wraps', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      0,
    )

    const afterFirstSubmit = advanceTurn(initialState, submit('กา', 100, ['กา']))
    const afterRoundWrap = advanceTurn(afterFirstSubmit, submit('แฟ', 200, ['แฟ']))
    const afterNewRoundSubmit = advanceTurn(
      afterRoundWrap,
      submit('กา', 300, ['กา']),
    )

    expect(afterRoundWrap.round).toBe(2)
    expect(afterRoundWrap.usedSyllablesInRound).toEqual([])
    expect(afterNewRoundSubmit.usedSyllablesInRound).toEqual(['กา'])
    expect(
      afterNewRoundSubmit.players.find((player) => player.id === 'a')?.status,
    ).toBe('active')
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

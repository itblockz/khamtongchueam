import { describe, expect, it } from 'vitest'
import {
  applyScoreAwards,
  advanceTurn,
  createConfirmedGameState,
  createGameState,
  getFinalPlacements,
  getScoreAwards,
  startActiveTurn,
} from './game'

describe('advanceTurn', () => {
  it('can confirm players first and start the first turn later', () => {
    const confirmedState = createConfirmedGameState(
      [
        { id: 'a', name: 'เอ' },
        { id: 'b', name: 'บี' },
      ],
      3000,
    )

    expect(confirmedState.phase).toBe('playing')
    expect(confirmedState.activePlayerId).toBe('a')
    expect(confirmedState.isAwaitingFirstTurnStart).toBe(true)
    expect(confirmedState.turnStartedAt).toBeNull()
    expect(confirmedState.turnDeadlineAt).toBeNull()

    const startedState = startActiveTurn(confirmedState, 500, 3000)

    expect(startedState.isAwaitingFirstTurnStart).toBe(false)
    expect(startedState.turnStartedAt).toBe(500)
    expect(startedState.turnDeadlineAt).toBe(3500)
    expect(startedState.timeLeftMs).toBe(3000)
  })

  it('pauses the next turn after an elimination and increments the round after wrapping', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'เอ' },
        { id: 'b', name: 'บี' },
        { id: 'c', name: 'ซี' },
      ],
      0,
    )

    const afterFirstSubmit = advanceTurn(initialState, {
      type: 'submit',
      answer: 'คำแรก',
      now: 100,
    })
    const afterTimeout = advanceTurn(afterFirstSubmit, {
      type: 'timeout',
      now: 200,
    })
    const afterWrap = advanceTurn(afterTimeout, {
      type: 'submit',
      answer: 'คำสาม',
      now: 300,
    })

    expect(afterFirstSubmit.activePlayerId).toBe('b')
    expect(afterFirstSubmit.round).toBe(1)
    expect(afterFirstSubmit.turnStartedAt).toBe(100)
    expect(afterTimeout.activePlayerId).toBe('c')
    expect(afterTimeout.round).toBe(1)
    expect(afterTimeout.turnStartedAt).toBeNull()
    expect(afterTimeout.turnDeadlineAt).toBeNull()
    expect(afterWrap.activePlayerId).toBe('a')
    expect(afterWrap.round).toBe(2)
    expect(afterWrap.turnStartedAt).toBe(300)
  })

  it('marks the final active player as the winner', () => {
    const initialState = createGameState(
      [
        { id: 'a', name: 'เอ' },
        { id: 'b', name: 'บี' },
      ],
      0,
    )

    const finishedState = advanceTurn(initialState, {
      type: 'timeout',
      now: 3000,
    })

    expect(finishedState.phase).toBe('finished')
    expect(finishedState.winnerId).toBe('b')
    expect(finishedState.players.find((player) => player.id === 'b')?.status).toBe(
      'winner',
    )
    expect(finishedState.players.find((player) => player.id === 'a')?.status).toBe(
      'eliminated',
    )
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

    const afterFirstSubmit = advanceTurn(initialState, {
      type: 'submit',
      answer: 'alpha',
      now: 100,
    })
    const afterBTimeout = advanceTurn(afterFirstSubmit, {
      type: 'timeout',
      now: 200,
    })
    const afterCSubmit = advanceTurn(afterBTimeout, {
      type: 'submit',
      answer: 'charlie',
      now: 300,
    })
    const afterDTimeout = advanceTurn(afterCSubmit, {
      type: 'timeout',
      now: 400,
    })
    const afterASecondSubmit = advanceTurn(afterDTimeout, {
      type: 'submit',
      answer: 'atlas',
      now: 500,
    })
    const finishedState = advanceTurn(afterASecondSubmit, {
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

import { describe, expect, it } from 'vitest'
import {
  advanceTurn,
  createConfirmedGameState,
  createGameState,
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
})

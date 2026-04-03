import { describe, expect, it } from 'vitest'
import { advanceTurn, createGameState } from './game'

describe('advanceTurn', () => {
  it('skips eliminated players and increments the round after wrapping', () => {
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
    expect(afterTimeout.activePlayerId).toBe('c')
    expect(afterTimeout.round).toBe(1)
    expect(afterWrap.activePlayerId).toBe('a')
    expect(afterWrap.round).toBe(2)
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

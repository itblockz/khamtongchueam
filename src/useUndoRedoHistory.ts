import { useCallback, useState } from 'react'

export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export function useUndoRedoHistory<T>(
  initialPresent: T,
  maxEntries = 100,
) {
  const [historyState, setHistoryState] = useState<HistoryState<T>>({
    past: [],
    present: initialPresent,
    future: [],
  })

  const resetHistory = useCallback((nextPresent: T) => {
    setHistoryState({
      past: [],
      present: nextPresent,
      future: [],
    })
  }, [])

  const updatePresent = useCallback((updater: (current: T) => T) => {
    setHistoryState((current) => {
      const nextPresent = updater(current.present)

      if (nextPresent === current.present) {
        return current
      }

      return {
        ...current,
        present: nextPresent,
      }
    })
  }, [])

  const commitPresent = useCallback(
    (updater: (current: T) => T) => {
      setHistoryState((current) => {
        const nextPresent = updater(current.present)

        if (nextPresent === current.present) {
          return current
        }

        return {
          past: [...current.past, current.present].slice(-maxEntries),
          present: nextPresent,
          future: [],
        }
      })
    },
    [maxEntries],
  )

  const undoPresent = useCallback((mapSnapshot?: (snapshot: T) => T) => {
    setHistoryState((current) => {
      const previousPresent = current.past.at(-1)

      if (previousPresent === undefined) {
        return current
      }

      return {
        past: current.past.slice(0, -1),
        present: mapSnapshot ? mapSnapshot(previousPresent) : previousPresent,
        future: [current.present, ...current.future],
      }
    })
  }, [])

  const redoPresent = useCallback((mapSnapshot?: (snapshot: T) => T) => {
    setHistoryState((current) => {
      const nextPresent = current.future[0]

      if (nextPresent === undefined) {
        return current
      }

      return {
        past: [...current.past, current.present].slice(-maxEntries),
        present: mapSnapshot ? mapSnapshot(nextPresent) : nextPresent,
        future: current.future.slice(1),
      }
    })
  }, [maxEntries])

  return {
    historyState,
    present: historyState.present,
    canUndo: historyState.past.length > 0,
    canRedo: historyState.future.length > 0,
    resetHistory,
    updatePresent,
    commitPresent,
    undoPresent,
    redoPresent,
  }
}

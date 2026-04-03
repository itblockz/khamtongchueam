import { useEffect, useEffectEvent } from 'react'

interface UseTurnTimerOptions {
  durationMs: number
  active: boolean
  safeToFinish: boolean
  startedAt: number | null
  onTick: (timeLeftMs: number) => void
  onExpire: () => void
}

export function useTurnTimer({
  durationMs,
  active,
  safeToFinish,
  startedAt,
  onTick,
  onExpire,
}: UseTurnTimerOptions) {
  const handleTick = useEffectEvent(onTick)
  const handleExpire = useEffectEvent(onExpire)

  useEffect(() => {
    if (!active || safeToFinish || startedAt === null) {
      return
    }

    const updateTimeLeft = () => {
      const elapsed = Date.now() - startedAt
      handleTick(Math.max(0, durationMs - elapsed))
    }

    updateTimeLeft()

    const intervalId = window.setInterval(updateTimeLeft, 100)
    const timeoutId = window.setTimeout(() => {
      handleTick(0)
      handleExpire()
    }, Math.max(0, durationMs - (Date.now() - startedAt)))

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [active, durationMs, safeToFinish, startedAt])
}

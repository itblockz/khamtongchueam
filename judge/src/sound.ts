// A short beep when time runs out. Browsers (iOS above all) only let a page play
// sound after the user has touched it, so the audio is unlocked on the first touch.

const KEY = 'khamtongchueam-judge-sound'

let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (context) return context
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    return null
  }
  return context
}

/** Call from a touch or click: creates and resumes the audio so later beeps play. */
export function unlockAudio() {
  const ctx = audio()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* blocked: the choice just will not survive a reload */
  }
}

/** Time is up: one beep (if sound is on) and a buzz where the phone supports it. */
export function timeUp() {
  navigator.vibrate?.(300)
  if (!soundOn()) return
  const ctx = audio()
  if (!ctx) return
  try {
    const start = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
    gain.gain.setValueAtTime(0.3, start + 0.4)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.5)
  } catch {
    /* no sound: the screen still shows the time is up */
  }
}

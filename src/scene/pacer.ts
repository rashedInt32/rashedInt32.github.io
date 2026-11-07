// Frame pacing: which display refreshes get a rendered frame, how far each
// rendered frame moves the animation on, and when the loop should sleep.
//
// Caps snap to whole display refreshes, so frames stay evenly spaced (uneven
// spacing is what reads as stutter): a 40 fps cap is 40 on a 120 Hz screen
// and 30 on a 60 Hz one. The refresh interval is measured, not assumed.
//
// Pure: no DOM, no clock. The caller passes the time and the scene's state.

export interface PacerOptions {
  /** Frame-rate caps, before snapping to the display. */
  fps: { moving: number; active: number; reading: number; idle: number }
  /** No input for this long: the idle cap. */
  idleMs: number
  /** No input for this long: stop rendering until the next input. */
  sleepMs: number
}

export interface PaceState {
  /** Milliseconds since the last input (pointer, key, scroll). */
  sinceInput: number
  /** False while the camera travels or a form morphs. */
  settled: boolean
  /** The reading page (work history) is showing. */
  reading: boolean
  /** Sleeping is allowed (not before the reveal). */
  canSleep: boolean
}

export type Frame =
  | { kind: 'skip' }
  | { kind: 'sleep' }
  | {
      kind: 'render'
      /** Seconds to advance the animation: the time since the last rendered frame. */
      dt: number
      idle: boolean
      /** Milliseconds since the last rendered frame, 0 for the first. */
      ms: number
      /** That interval over the frame time it was capped at: 1 is on time. */
      lateness: number
    }

/** Longest step the animation takes in one frame, after a stall. */
const MAX_DT = 1 / 15

export function createPacer(opts: PacerOptions) {
  let vsyncMs = 1000 / 60
  let lastRefresh = -1
  let lastRendered = -1
  // Only a gap that follows a skipped refresh measures the display: after a
  // rendered frame, the gap also holds the frame's own cost, and on a slow
  // device that would be learned as the refresh rate.
  let skipped = false
  const gaps: number[] = []

  const capFor = (s: PaceState, idle: boolean) =>
    !s.settled ? opts.fps.moving : idle ? opts.fps.idle : s.reading ? opts.fps.reading : opts.fps.active

  return {
    /** Call on every display refresh. */
    frame(now: number, s: PaceState): Frame {
      if (lastRefresh >= 0 && skipped) {
        const gap = now - lastRefresh
        if (gap > 2 && gap < 60) {
          gaps.push(gap)
          if (gaps.length >= 32) {
            gaps.sort((a, b) => a - b)
            vsyncMs = gaps[16]!
            gaps.length = 0
          }
        }
      }
      const sinceRefresh = lastRefresh >= 0 ? now - lastRefresh : vsyncMs
      lastRefresh = now

      if (s.canSleep && s.sinceInput > opts.sleepMs) return { kind: 'sleep' }

      const idle = s.settled && s.sinceInput > opts.idleMs
      // Whole refreshes per frame, rounding the cap down, never up.
      const refreshes = Math.max(1, Math.ceil(1000 / capFor(s, idle) / vsyncMs - 0.05))
      const frameMs = refreshes * vsyncMs
      skipped = lastRendered >= 0 && now - lastRendered < frameMs - vsyncMs * 0.4
      if (skipped) return { kind: 'skip' }

      const ms = lastRendered >= 0 ? now - lastRendered : 0
      const dt = Math.min((lastRendered >= 0 ? ms : sinceRefresh) / 1000, MAX_DT)
      lastRendered = now
      // Capped so one hitch can't swamp a whole window of samples.
      return { kind: 'render', dt, idle, ms, lateness: Math.min(ms / frameMs, 4) }
    },
    /** After sleeping or a hidden tab: the next refresh renders, with a fresh step. */
    reset() {
      lastRendered = -1
      lastRefresh = -1
      skipped = false
    },
    /** The measured display refresh interval, in ms. */
    get vsyncMs() {
      return vsyncMs
    },
  }
}

export type Pacer = ReturnType<typeof createPacer>

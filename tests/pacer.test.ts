import { describe, expect, test } from 'bun:test'
import { createPacer, type PaceState } from '../src/scene/pacer'

const opts = { fps: { moving: 60, active: 40, reading: 30, idle: 24 }, idleMs: 4000, sleepMs: 40000 }
const active: PaceState = { sinceInput: 0, settled: true, reading: false, canSleep: true }

/** Drive the pacer at a display rate for `seconds`; collect rendered frames. */
function run(hz: number, seconds: number, state: (t: number) => PaceState, jitter = 0) {
  const p = createPacer(opts)
  const frames: { t: number; dt: number; idle: boolean }[] = []
  const step = 1000 / hz
  let seed = 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  for (let i = 0; i * step < seconds * 1000; i++) {
    const t = i * step + rand() * jitter
    const f = p.frame(t, state(t))
    if (f.kind === 'render') frames.push({ t, dt: f.dt, idle: f.idle })
  }
  return frames
}

/** Rendered frames per second, from the second half (after the refresh rate is learned). */
function rate(frames: { t: number }[], seconds: number) {
  return frames.filter((f) => f.t >= (seconds * 1000) / 2).length / (seconds / 2)
}

/** Distinct gaps between rendered frames, rounded to 0.1 ms. */
function gaps(frames: { t: number }[], seconds: number) {
  const late = frames.filter((f) => f.t >= (seconds * 1000) / 2)
  return [...new Set(late.slice(1).map((f, i) => Math.round((f.t - late[i]!.t) * 10) / 10))]
}

describe('caps snap to whole display refreshes', () => {
  const cases: [number, string, PaceState, number][] = [
    [120, 'moving', { ...active, settled: false }, 60],
    [120, 'active', active, 40],
    [120, 'reading', { ...active, reading: true }, 30],
    [120, 'idle', { ...active, sinceInput: 5000 }, 24],
    [60, 'moving', { ...active, settled: false }, 60],
    [60, 'active', active, 30],
    [60, 'reading', { ...active, reading: true }, 30],
    [60, 'idle', { ...active, sinceInput: 5000 }, 20],
  ]
  for (const [hz, name, state, want] of cases) {
    test(`${hz} Hz ${name}: ${want} fps, evenly spaced`, () => {
      const f = run(hz, 4, () => state)
      expect(rate(f, 4)).toBeCloseTo(want, 0)
      expect(gaps(f, 4)).toHaveLength(1)
    })
  }

  test('a jittery display clock still gives every third refresh', () => {
    // ±1 ms on each timestamp is ±2 ms on each gap; what must not happen is
    // a frame landing two or four refreshes apart (16.7 or 33.3 ms).
    const f = run(120, 4, () => active, 1)
    expect(gaps(f, 4).every((g) => Math.abs(g - 25) < 3)).toBe(true)
    expect(rate(f, 4)).toBeCloseTo(40, 0)
  })
})

describe('dt', () => {
  // The bug this guards: dt was the time since the last refresh, so skipped
  // refreshes slowed every animation down.
  for (const hz of [60, 120]) {
    for (const [name, state] of [
      ['active', active],
      ['idle', { ...active, sinceInput: 5000 }],
    ] as const) {
      test(`${hz} Hz ${name}: one second of frames adds up to one second`, () => {
        const f = run(hz, 3, () => state)
        const lastSecond = f.filter((x) => x.t >= 2000)
        const total = lastSecond.reduce((a, x) => a + x.dt, 0)
        expect(total).toBeCloseTo(1, 1)
      })
    }
  }

  test('a stall advances by at most 1/15 s', () => {
    const p = createPacer(opts)
    p.frame(0, active)
    const f = p.frame(2000, active)
    expect(f.kind === 'render' && f.dt).toBeCloseTo(1 / 15, 5)
  })
})

describe('idle and sleep', () => {
  test('idle after idleMs without input', () => {
    const f = run(60, 6, (t) => ({ ...active, sinceInput: t }))
    expect(f.find((x) => x.t < 3900)?.idle).toBe(false)
    expect(f.filter((x) => x.t > 4100).every((x) => x.idle)).toBe(true)
  })

  test('sleeps after sleepMs, only when allowed', () => {
    const p = createPacer(opts)
    expect(p.frame(0, { ...active, sinceInput: 40001 }).kind).toBe('sleep')
    expect(p.frame(16, { ...active, sinceInput: 40001, canSleep: false }).kind).toBe('render')
  })

  test('never idle while the camera travels', () => {
    const f = run(60, 2, () => ({ ...active, sinceInput: 9000, settled: false }))
    expect(f.every((x) => !x.idle)).toBe(true)
    expect(rate(f, 2)).toBeCloseTo(60, 0)
  })

  test('after reset the next refresh renders with a fresh small step', () => {
    const p = createPacer(opts)
    p.frame(0, active)
    p.reset()
    const f = p.frame(90000, active)
    expect(f.kind).toBe('render')
    expect(f.kind === 'render' && f.dt).toBeLessThan(0.02)
  })
})

describe('slow devices', () => {
  /** Simulate the browser: a rendered frame costing `costMs` delays the next refresh callback. */
  function slow(hz: number, costMs: number, seconds: number) {
    const p = createPacer(opts)
    const v = 1000 / hz
    const late: number[] = []
    let t = 0
    let renders = 0
    while (t < seconds * 1000) {
      const f = p.frame(t, active)
      if (f.kind === 'render') {
        // Count the second half only, after the refresh rate is learned.
        if (t >= (seconds * 1000) / 2) renders++
        if (f.ms > 0 && t >= (seconds * 1000) / 2) late.push(f.lateness)
        t = Math.ceil((t + costMs) / v - 1e-9) * v
      } else t += v
    }
    return { p, renders, lateness: late.reduce((a, b) => a + b, 0) / late.length }
  }

  // The bug this guards: the pacer took the app's own slow frame rate as the
  // display refresh, so lateness always read 1 and the governor never stepped down.
  for (const hz of [60, 120]) {
    test(`${hz} Hz, 45 ms frames: frame cost isn't learned as the refresh, and frames read as late`, () => {
      const r = slow(hz, 45, 6)
      // It never skips a refresh, so it never needs the true one; it must
      // only not mistake the 45-50 ms frame cost for it.
      expect(r.p.vsyncMs).toBeLessThan(20)
      expect(r.lateness).toBeGreaterThan(1.25)
    })
  }

  test('frames that fit the cap read as on time', () => {
    const r = slow(120, 10, 6)
    expect(r.lateness).toBeLessThan(1.1)
    expect(r.renders / 3).toBeCloseTo(40, 0)
  })
})

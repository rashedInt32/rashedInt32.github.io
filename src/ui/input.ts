import type { Point, View } from '../contract'

export interface InputHandlers {
  /** Navigation keys, wheel and swipe act only while this is true. */
  active(): boolean
  /** j/k, arrows, wheel or swipe. `source` lets the work view keep native scrolling. */
  step(dir: 1 | -1, source: 'key' | 'wheel' | 'swipe'): void
  /** h, p, w. */
  view(v: View): void
  first(): void
  last(): void
  jump(i: number): void
  /** Enter: the project's page. o (`direct`): github. */
  open(direct: boolean): void
  help(): void
  escape(): void
  pointer(p: Point | null): void
}

const WHEEL_STEP = 40
const WHEEL_LOCK_MS = 650
const WHEEL_LOCK_MAX_MS = 1400
const WHEEL_IDLE_MS = 300
const SWIPE_PX = 40

/** Binds keys, wheel, swipe and pointer on window. Returns an unbind function. */
export function bindInput(on: InputHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    // The intro claims its keys first; the Enter that submits it must not also open a repo.
    if (e.defaultPrevented || !on.active() || e.metaKey || e.ctrlKey || e.altKey) return
    const onControl = e.target instanceof Element && e.target.closest('a, button') !== null
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        on.step(1, 'key')
        break
      case 'k':
      case 'ArrowUp':
        on.step(-1, 'key')
        break
      case 'h':
        on.view('home')
        break
      case 'p':
        on.view('projects')
        break
      case 'w':
        on.view('work')
        break
      case 'g':
        on.first()
        break
      case 'G':
        on.last()
        break
      case 'o':
        on.open(true)
        break
      case 'Enter':
        // A focused link or button handles its own Enter.
        if (onControl) return
        on.open(false)
        break
      case '?':
        on.help()
        break
      case 'Escape':
        on.escape()
        break
      default:
        // 1-9 are the first nine projects, 0 the tenth.
        if (/^[0-9]$/.test(e.key)) {
          on.jump(e.key === '0' ? 9 : Number(e.key) - 1)
          break
        }
        return
    }
    e.preventDefault()
  }

  // One step per gesture: trackpad inertia keeps extending the lock, up to a cap.
  let acc = 0
  let last = 0
  let lockStart = 0
  let lockedUntil = 0
  const onWheel = (e: WheelEvent) => {
    if (!on.active()) return
    const now = performance.now()
    if (now < lockedUntil) {
      if (now - lockStart < WHEEL_LOCK_MAX_MS) lockedUntil = Math.max(lockedUntil, now + 140)
      return
    }
    if (now - last > WHEEL_IDLE_MS) acc = 0
    last = now
    acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    if (Math.abs(acc) < WHEEL_STEP) return
    on.step(acc > 0 ? 1 : -1, 'wheel')
    acc = 0
    lockStart = now
    lockedUntil = now + WHEEL_LOCK_MS
  }

  let touchY: number | null = null
  const onTouchStart = (e: TouchEvent) => {
    touchY = e.touches.length === 1 ? e.touches[0]!.clientY : null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchY
    touchY = null
    const t = e.changedTouches[0]
    if (start === null || !t || !on.active()) return
    const dy = start - t.clientY
    if (Math.abs(dy) > SWIPE_PX) on.step(dy > 0 ? 1 : -1, 'swipe')
  }

  const onMove = (e: PointerEvent) =>
    on.pointer({ x: (e.clientX / innerWidth) * 2 - 1, y: 1 - (e.clientY / innerHeight) * 2 })
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) on.pointer(null)
  }
  const onBlur = () => on.pointer(null)

  addEventListener('keydown', onKey)
  addEventListener('wheel', onWheel, { passive: true })
  addEventListener('touchstart', onTouchStart, { passive: true })
  addEventListener('touchend', onTouchEnd, { passive: true })
  addEventListener('pointermove', onMove, { passive: true })
  addEventListener('pointerout', onOut, { passive: true })
  addEventListener('blur', onBlur)

  return () => {
    removeEventListener('keydown', onKey)
    removeEventListener('wheel', onWheel)
    removeEventListener('touchstart', onTouchStart)
    removeEventListener('touchend', onTouchEnd)
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerout', onOut)
    removeEventListener('blur', onBlur)
  }
}

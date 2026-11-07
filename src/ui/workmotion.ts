// The work view's motion, all driven by its own scroll: no loop runs when
// nothing scrolls. Each scroll schedules one frame that
//   - reports progress 0..1 (the scene glides the camera along the hall),
//   - fills the timeline rule up to the reading line,
//   - lights each role's node once the reading line passes it,
//   - eases sections in as they first enter the view.
// Positions are measured once and again only when the column resizes.

const READ_LINE = 0.5
const REVEAL_LINE = 0.92

export interface WorkMotion {
  /** Measure and report the current state, e.g. when the view opens. */
  open(): void
}

export function attachWorkMotion(scroller: HTMLElement, col: HTMLElement, onProgress: (t: number) => void): WorkMotion {
  col.classList.add('work--motion')
  const list = col.querySelector<HTMLElement>('.jobs')
  const items = [...col.querySelectorAll<HTMLElement>('.w-head, .job, .w-sec')]
  let listTop = 0
  let listH = 1
  let tops: number[] = []
  let frame = 0
  let lastT = -1

  const measure = () => {
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop
    if (list) {
      const r = list.getBoundingClientRect()
      listTop = r.top - base
      listH = Math.max(1, r.height)
    }
    // Sections may be shifted by their entry transform; measure without it.
    tops = items.map((el) => el.getBoundingClientRect().top - base - (el.classList.contains('is-in') ? 0 : 16))
  }

  const update = () => {
    frame = 0
    const max = scroller.scrollHeight - scroller.clientHeight
    const t = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0
    if (t !== lastT) {
      lastT = t
      onProgress(t)
    }
    const view = scroller.clientHeight
    const line = scroller.scrollTop + view * READ_LINE
    const reveal = scroller.scrollTop + view * REVEAL_LINE
    if (list) list.style.setProperty('--fill', Math.min(1, Math.max(0, (line - listTop) / listH)).toFixed(4))
    items.forEach((el, i) => {
      const top = tops[i] ?? 0
      if (top < reveal) el.classList.add('is-in')
      if (el.classList.contains('job')) el.classList.toggle('is-lit', top + 14 < line)
    })
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }

  scroller.addEventListener('scroll', schedule, { passive: true })
  new ResizeObserver(() => {
    measure()
    schedule()
  }).observe(col)

  return {
    open() {
      lastT = -1
      measure()
      update()
    },
  }
}

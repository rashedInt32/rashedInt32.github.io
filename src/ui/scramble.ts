// A short decode of a word through random braille cells, left to right.
// Braille falls back to a system font with different advances, so the
// element's width is pinned to the final word's width while it runs.

const STEP_MS = 40
const running = new WeakMap<HTMLElement, number>()

const cell = (): string => String.fromCharCode(0x2801 + Math.floor(Math.random() * 254))

export function scramble(el: HTMLElement, text: string, reduced: boolean, durationMs = 560): void {
  const prev = running.get(el)
  if (prev !== undefined) clearInterval(prev)
  el.style.width = ''
  el.textContent = text
  if (reduced || text.length === 0) return

  el.style.width = `${el.getBoundingClientRect().width}px`
  const frames = Math.max(2, Math.round(durationMs / STEP_MS))
  let f = 0
  const tick = () => {
    f++
    const done = Math.floor((f / frames) * text.length)
    let s = text.slice(0, done)
    for (let i = done; i < text.length; i++) s += text[i] === ' ' ? ' ' : cell()
    el.textContent = s
    if (f >= frames) {
      clearInterval(id)
      running.delete(el)
      el.textContent = text
      el.style.width = ''
    }
  }
  const id = window.setInterval(tick, STEP_MS)
  running.set(el, id)
  tick()
}

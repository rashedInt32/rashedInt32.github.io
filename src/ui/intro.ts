import { h } from './dom'

const CMD = 'cd ~/harbor'
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

export interface Intro {
  el: HTMLElement
  setReady(): void
  /** Tear down without the exit animation. */
  destroy(): void
}

interface IntroOptions {
  reduced: boolean
  horizonY(): number
  /** Fires once, the moment the command is accepted. */
  onSubmit(): void
  /** Fires when the exit animation is over and the intro is gone. */
  onDone(): void
}

function lastLogin(): string {
  const d = new Date(Date.now() - 7 * 60_000)
  const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase()
  const mon = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `last login: ${day} ${mon} ${d.getDate()} ${hh}:${mm} on ttys001`
}

export function createIntro(o: IntroOptions): Intro {
  let n = 0
  let ready = false
  let pending = false
  let submitted = false
  let spin: number | undefined
  let typer: number | undefined
  let typingTimer: number | undefined
  const timers: number[] = []

  const typed = h('span', { class: 'pr-typed' })
  const caret = h('span', { class: 'pr-caret' })
  const ghost = h('span', { class: 'pr-ghost' })
  const row = h(
    'div',
    { class: 'intro-row', attrs: { 'aria-hidden': 'true' } },
    h('span', { class: 'pr-user', text: 'rashed@harbor' }),
    h('span', { class: 'pr-cwd', text: ' ~ ' }),
    h('span', { class: 'pr-sig', text: '% ' }),
    typed,
    caret,
    ghost,
  )
  const spinEl = h('span', { class: 'intro-spin', attrs: { 'aria-hidden': 'true' } })
  const statusText = h('span', { text: 'warming the gpu' })
  const status = h('p', { class: 'intro-status', attrs: { role: 'status' } }, spinEl, statusText)
  const enter = h('button', {
    class: 'intro-enter',
    text: '↵ enter',
    attrs: { type: 'button', 'aria-label': 'enter the harbor' },
  })
  const line = h('div', { class: 'horizon', attrs: { 'aria-hidden': 'true' } })
  const el = h(
    'section',
    { class: 'intro', attrs: { 'aria-label': 'rashed parvez, portfolio' } },
    h('h1', { class: 'sr-only', text: 'rashed parvez' }),
    h(
      'div',
      { class: 'intro-inner' },
      h('p', { class: 'intro-login', text: lastLogin(), attrs: { 'aria-hidden': 'true' } }),
      row,
      h('div', { class: 'intro-foot' }, status, enter),
    ),
    line,
  )

  const render = () => {
    typed.textContent = CMD.slice(0, n)
    caret.textContent = n < CMD.length ? CMD[n]! : ' '
    ghost.textContent = CMD.slice(n + 1)
  }

  // Terminals hold the cursor solid while you type.
  const bump = () => {
    render()
    row.classList.add('typing')
    clearTimeout(typingTimer)
    typingTimer = window.setTimeout(() => row.classList.remove('typing'), 500)
  }

  const setStatus = (text: string) => {
    statusText.textContent = text
  }

  const startSpin = () => {
    let f = 0
    spinEl.textContent = SPINNER[0]!
    spin = window.setInterval(() => {
      f = (f + 1) % SPINNER.length
      spinEl.textContent = SPINNER[f]!
    }, 90)
  }
  const stopSpin = () => {
    clearInterval(spin)
    spin = undefined
  }

  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))

  const autotype = (then: () => void) => {
    if (typer !== undefined) return
    if (o.reduced) {
      n = CMD.length
      render()
      then()
      return
    }
    typer = window.setInterval(() => {
      n++
      bump()
      if (n >= CMD.length) {
        clearInterval(typer)
        typer = undefined
        then()
      }
    }, 32)
  }

  const submit = () => {
    if (submitted) return
    if (n < CMD.length) return autotype(submit)
    if (!ready) {
      pending = true
      setStatus('waiting for the gpu')
      return
    }
    submitted = true
    leave()
  }

  // Each character becomes its own span so they can dissolve one by one.
  const splitChars = () => {
    for (const part of Array.from(row.children) as HTMLElement[]) {
      const text = part.textContent ?? ''
      part.textContent = ''
      for (const ch of text) {
        const s = h('span', { class: 'ch', text: ch })
        s.style.transitionDelay = `${380 + Math.random() * 360}ms`
        part.append(s)
      }
    }
  }

  const leave = () => {
    removeEventListener('keydown', onKey)
    stopSpin()
    o.onSubmit()
    if (o.reduced) {
      el.remove()
      o.onDone()
      return
    }
    const r = row.getBoundingClientRect()
    const y = o.horizonY()
    splitChars()
    line.style.top = `${Math.round(y)}px`
    el.classList.add('intro--leaving')
    // Whole pixels, so the text stays crisp while it slides.
    row.style.transform = `translateY(${Math.round(y - (r.top + r.height / 2))}px)`
    later(420, () => line.classList.add('on'))
    later(700, () => el.classList.add('intro--clear'))
    later(1500, () => line.classList.add('off'))
    later(2400, () => {
      el.remove()
      o.onDone()
    })
  }

  const onKey = (e: KeyboardEvent) => {
    if (submitted || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      n = Math.max(0, n - 1)
      bump()
    } else if (e.key === 'Tab' && n < CMD.length) {
      e.preventDefault()
      n = CMD.length
      bump()
    } else if (e.key.length === 1 && typer === undefined) {
      e.preventDefault()
      n = Math.min(CMD.length, n + 1)
      bump()
    }
  }

  enter.addEventListener('click', submit)
  row.addEventListener('click', submit)
  addEventListener('keydown', onKey)
  render()
  startSpin()

  return {
    el,
    setReady() {
      if (ready) return
      ready = true
      stopSpin()
      spinEl.textContent = '●'
      el.classList.add('intro--ready')
      setStatus(pending ? 'entering' : 'ready')
      if (pending) submit()
    },
    destroy() {
      removeEventListener('keydown', onKey)
      stopSpin()
      clearInterval(typer)
      clearTimeout(typingTimer)
      timers.forEach(clearTimeout)
      el.remove()
    },
  }
}

import { HOME_ACCENT, type Point, type Profile, type Project, type SceneStats, type View, type WorkHistory } from '../contract'
import { h, pad2, replay } from './dom'
import { routeHref } from './route'
import { scramble } from './scramble'
import { contactLinks, renderWork } from './work'
import { attachWorkMotion } from './workmotion'

export interface HudActions {
  /** A project picked from the index. */
  pick(i: number): void
  /** A view picked from the nav or a call to action. */
  go(view: View): void
  /** Pager arrows (phones): same as j and k. */
  step(dir: 1 | -1): void
  /** Work view scroll progress, 0..1, at most once per frame. */
  scrolled(t: number): void
  /** Open project i's case page. */
  openCase(i: number): void
  closeCase(): void
}

export interface Hud {
  el: HTMLElement
  /** The work view's scroll container, for keyboard scrolling and focus. */
  workScroll: HTMLElement
  /** The case page's scroll container. */
  caseScroll: HTMLElement
  /** The work view just opened: measure it and report where it's scrolled. */
  workOpened(): void
  show(): void
  /** Show `view` and, in projects, project `i`. `animate` runs the decode and swap. `caseOpen` puts the project's page over the hall. */
  set(view: View, i: number, animate: boolean, caseOpen?: boolean): void
  setStats(s: SceneStats): void
  /** The pointer, for the statusline readout. */
  setPointer(p: Point | null): void
  /** Where the form is on screen (NDC); the callout line runs from the title to it. */
  setAnchor(p: Point | null): void
  toggleHelp(force?: boolean): void
  helpOpen(): boolean
}

const KEYS: Array<[string, string]> = [
  ['h  p  w', 'home, projects, work'],
  ['j k  ↓ ↑', 'move, or scroll'],
  ['g G', 'first, last'],
  ['1 – 9  0', 'jump to a project'],
  ['↵  o', 'open on github'],
  ['wheel, swipe', 'move'],
  ['?', 'this card'],
  ['esc', 'close, or back home'],
]

const STATUS_KEYS: Record<View, string> = {
  home: 'j projects · w work · ? help',
  projects: 'j/k move · ↵ open · ? help',
  work: 'j/k scroll · esc home · ? help',
}
const CASE_KEYS = 'j/k scroll · o github · esc back'

/** The work page's own accent: tidepool gold, warm against the cool hall, so the numbers lead. */
const WORK_ACCENT = '#e0af68'

const VIEW_LABEL: Record<View, string> = { home: 'home', projects: 'projects', work: 'work' }

const dot = () => h('span', { class: 'p-dot', text: ' · ' })

/** A same-page link that routes on plain clicks and stays a real link for new tabs. */
function routeLink(cls: string, href: string, onGo: () => void, ...children: Array<Node | string>) {
  const a = h('a', { class: cls, attrs: { href } }, ...children)
  a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onGo()
  })
  return a
}

export function createHud(projects: Project[], profile: Profile, work: WorkHistory, act: HudActions): Hud {
  const total = pad2(projects.length)
  let currentView: View | null = null
  let currentIndex = -1
  let lastStats = ''

  // ── top: who, the nav, github ──────────────────────────
  const navLinks = (['home', 'projects', 'work'] as const).map((v) =>
    routeLink('nav-a', routeHref(v), () => act.go(v), VIEW_LABEL[v]),
  )
  const sep = () => h('span', { class: 'nav-sep', text: ' · ', attrs: { 'aria-hidden': 'true' } })
  const nav = h('nav', { class: 'nav', attrs: { 'aria-label': 'site' } }, navLinks[0]!, sep(), navLinks[1]!, sep(), navLinks[2]!)

  const top = h(
    'header',
    { class: 'hud-top rise', attrs: { style: '--d: 60ms' } },
    h('div', { class: 'ident' }, h('p', { class: 'ident-name', text: profile.name }), h('p', { class: 'ident-role', text: profile.role })),
    nav,
    h(
      'a',
      { class: 'touch', attrs: { href: `mailto:${profile.contact.email}`, 'aria-label': `email ${profile.contact.email}` } },
      'get in touch',
      h('span', { class: 'touch-arrow', text: ' →', attrs: { 'aria-hidden': 'true' } }),
    ),
  )

  // ── projects: the index ────────────────────────────────
  const items = projects.map((p, i) =>
    h(
      'button',
      { class: 'ix', attrs: { type: 'button', 'data-i': String(i) } },
      h('span', { class: 'ix-bar', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ix-n', text: pad2(i + 1) }),
      h('span', { class: 'ix-name', text: p.name }),
    ),
  )
  const index = h(
    'nav',
    { class: 'index view-part', attrs: { 'aria-label': 'projects' } },
    h('p', { class: 'ix-label rise', text: '[ index ]', attrs: { style: '--d: 120ms', 'aria-hidden': 'true' } }),
    h('ol', { class: 'rise', attrs: { style: '--d: 160ms' } }, ...items.map((b) => h('li', null, b))),
  )

  // ── edge arrows: previous and next, beside the form ─────
  const edgePrev = h('button', { class: 'edge edge-prev view-part', text: '‹', attrs: { type: 'button', 'aria-label': 'previous project' } })
  const edgeNext = h('button', { class: 'edge edge-next view-part', text: '›', attrs: { type: 'button', 'aria-label': 'next project' } })
  edgePrev.addEventListener('click', () => act.step(-1))
  edgeNext.addEventListener('click', () => act.step(1))

  // ── the callout: a line from the title to the form ─────
  const calloutPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  calloutPath.setAttribute('class', 'callout-line')
  calloutPath.setAttribute('pathLength', '1')
  const calloutDot = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  calloutDot.setAttribute('class', 'callout-dot')
  calloutDot.setAttribute('width', '5')
  calloutDot.setAttribute('height', '5')
  const callout = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  callout.setAttribute('class', 'callout off')
  callout.setAttribute('aria-hidden', 'true')
  callout.append(calloutPath, calloutDot)
  // The title's left edge, measured when the panel changes and on resize,
  // not every frame.
  let titleX = 0
  let titleY = 0
  let anchor: Point | null = null
  const measureTitle = () => {
    const r = nameVis.getBoundingClientRect()
    titleX = r.left
    titleY = r.top + r.height / 2
  }
  const drawCallout = () => {
    const on = anchor !== null && currentView === 'projects' && caseShown < 0 && innerWidth > 700
    callout.classList.toggle('off', !on)
    if (!on || !anchor) return
    const ax = ((anchor.x + 1) / 2) * innerWidth
    const ay = ((1 - anchor.y) / 2) * innerHeight
    const tx = titleX - 18
    const ty = titleY
    const elbow = ax + 56
    const d = elbow < tx - 48 ? `M${ax.toFixed(1)} ${ay.toFixed(1)}H${elbow.toFixed(1)}L${(tx - 48).toFixed(1)} ${ty.toFixed(1)}H${tx.toFixed(1)}` : `M${ax.toFixed(1)} ${ay.toFixed(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}`
    calloutPath.setAttribute('d', d)
    calloutDot.setAttribute('x', (ax - 2.5).toFixed(1))
    calloutDot.setAttribute('y', (ay - 2.5).toFixed(1))
  }
  addEventListener('resize', () => {
    measureTitle()
    drawCallout()
  })
  index.style.setProperty('--ix-rows', String(items.length))
  index.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('.ix') : null
    if (b) act.pick(Number(b.dataset.i))
  })

  // ── the panel: home or a project ───────────────────────
  const tag = h('p', { class: 'p-tag' })
  const nameVis = h('span', { class: 'p-name-vis', attrs: { 'aria-hidden': 'true' } })
  const nameSr = h('span', { class: 'sr-only' })
  const name = h('h2', { class: 'p-name' }, nameVis, nameSr)
  const meta = h(
    'div',
    { class: 'p-meta' },
    h('p', { class: 'p-meta-role', text: profile.role }),
    h('p', { text: profile.place }),
  )
  const copy = h('div', { class: 'p-copy' })
  const formV = h('span', { class: 'p-form-v' })
  const form = h('p', { class: 'p-form' }, h('span', { class: 'p-form-k', text: 'form: ' }), formV)
  const link = h('a', { class: 'p-link', attrs: { target: '_blank', rel: 'noopener' } })
  const caseLink = h('a', { class: 'p-link p-link-case' }, h('span', { class: 'cta-arr', text: '→ ', attrs: { 'aria-hidden': 'true' } }), 'view project')
  caseLink.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    act.openCase(currentIndex)
  })
  const cta = h(
    'p',
    { class: 'p-cta' },
    routeLink('cta', routeHref('projects'), () => act.go('projects'), h('span', { class: 'cta-arr', text: '→ ', attrs: { 'aria-hidden': 'true' } }), 'view projects'),
    routeLink('cta', routeHref('work'), () => act.go('work'), h('span', { class: 'cta-arr', text: '→ ', attrs: { 'aria-hidden': 'true' } }), 'work history'),
  )
  const contact = contactLinks(profile.contact)
  contact.classList.add('p-contact')
  const hint = h(
    'p',
    { class: 'p-hint' },
    h('span', { class: 'p-hint-k', text: '↓' }),
    h('span', { class: 'p-hint-keys' }, ' scroll or ', h('kbd', { text: 'j' }), ' for the projects'),
    h('span', { class: 'p-hint-touch', text: ' swipe up for the projects' }),
  )
  const pagerN = h('span', { class: 'pager-n' })
  const prev = h('button', { text: '↑', attrs: { type: 'button', 'aria-label': 'previous' } })
  const next = h('button', { text: '↓', attrs: { type: 'button', 'aria-label': 'next' } })
  prev.addEventListener('click', () => act.step(-1))
  next.addEventListener('click', () => act.step(1))

  const panelBody = h(
    'div',
    { class: 'panel-body' },
    tag,
    name,
    meta,
    copy,
    form,
    cta,
    contact,
    h('div', { class: 'p-actions' }, h('p', { class: 'p-links' }, caseLink, link), hint, h('div', { class: 'pager' }, prev, pagerN, next)),
  )
  const panel = h('section', { class: 'panel view-part' }, h('div', { class: 'rise', attrs: { style: '--d: 280ms' } }, panelBody))

  // ── work: a scrolling timeline over the dimmed hall ────
  const scrim = h('div', { class: 'work-scrim view-part', attrs: { 'aria-hidden': 'true' } })
  const workCol = h('div', { class: 'work-col' }, ...renderWork(work, profile, 1, 'work-title'))
  const workScroll = h('main', { class: 'work view-part', attrs: { 'aria-labelledby': 'work-title', tabindex: '-1' } }, workCol)
  const workMotion = attachWorkMotion(workScroll, workCol, (t) => act.scrolled(t))

  // ── a project's page, over a still of the hall ─────────
  const caseCol = h('div', { class: 'case-col' })
  const caseScroll = h('main', { class: 'case view-part', attrs: { 'aria-label': 'project', tabindex: '-1' } }, caseCol)
  const renderCase = (i: number) => {
    const p = projects[i]!
    const nxt = projects[(i + 1) % projects.length]!
    const c = p.case ?? {}
    const back = h('button', { class: 'case-back', attrs: { type: 'button' } }, h('span', { class: 'cta-arr', text: '← ', attrs: { 'aria-hidden': 'true' } }), 'to index')
    back.addEventListener('click', () => act.closeCase())
    const nextLink = h(
      'a',
      { class: 'case-next', attrs: { href: routeHref('projects', nxt, true) } },
      h('span', { class: 'case-next-k', text: 'next project' }),
      h('span', { class: 'case-next-name', text: nxt.name }),
      h('span', { class: 'cta-arr', text: ' →', attrs: { 'aria-hidden': 'true' } }),
    )
    nextLink.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      act.openCase((i + 1) % projects.length)
    })
    const facts: Array<[string, string]> = [
      ['kind', p.kind],
      ...(c.role ? [['role', c.role] as [string, string]] : []),
      ['year', String(p.year)],
      ...(p.stars > 0 ? [['stars', `★ ${p.stars}`] as [string, string]] : []),
    ]
    const shots = c.shots?.length
      ? h(
          'ol',
          { class: 'case-shots' },
          ...c.shots.map((sh, k) =>
            h(
              'li',
              { class: 'case-shot' },
              h('img', { attrs: { src: sh.src, alt: sh.alt, loading: 'lazy', decoding: 'async' } }),
              h('p', { class: 'case-shot-cap' }, h('span', { text: sh.caption ?? sh.alt }), h('span', { class: 'case-shot-n', text: pad2(k + 1) })),
            ),
          ),
        )
      : null
    caseCol.replaceChildren(
      h(
        'div',
        { class: 'case-text' },
        back,
        h('p', { class: 'p-tag case-tag' }, h('span', { text: p.kind }), dot(), h('span', { class: 'p-year', text: String(p.year) })),
        h('h2', { class: 'case-title', text: p.name }),
        h('p', { class: 'case-summary', text: c.summary ?? p.line }),
        h('p', { class: 'case-form' }, h('span', { class: 'p-form-k', text: 'form: ' }), p.form),
        h('dl', { class: 'case-facts' }, ...facts.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        c.points?.length ? h('ul', { class: 'case-points' }, ...c.points.map((t) => h('li', { text: t }))) : null,
        h(
          'p',
          { class: 'case-links' },
          h('a', { class: 'case-live', attrs: { href: p.url, target: '_blank', rel: 'noopener' } }, 'github', h('span', { class: 'c-arr', text: ' ↗', attrs: { 'aria-hidden': 'true' } })),
          ...(c.stack ?? []).map((t) => h('span', { class: 'case-chip', text: t })),
        ),
        nextLink,
      ),
      ...(shots ? [shots] : []),
    )
  }

  const live = h('p', { class: 'sr-only', attrs: { 'aria-live': 'polite' } })

  // ── help ───────────────────────────────────────────────
  const help = h(
    'aside',
    { class: 'help', attrs: { 'aria-label': 'keys', hidden: '' } },
    h('p', { class: 'help-title', text: 'keys' }),
    h('dl', null, ...KEYS.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
  )

  // ── statusline ─────────────────────────────────────────
  const stPath = h('span', { class: 'st-seg st-path' })
  const stCount = h('span', { class: 'st-seg st-count' })
  const stKeys = h('span', { class: 'st-seg st-keys' })
  const stPos = h('span', { class: 'st-seg st-pos', text: 'x 0.500 · y 0.500', attrs: { 'aria-hidden': 'true' } })
  const stClock = h('span', { class: 'st-seg st-clock', attrs: { 'aria-hidden': 'true' } })
  const stGpu = h('span', { class: 'st-seg st-gpu', text: '…' })
  const status = h(
    'footer',
    { class: 'status rise', attrs: { style: '--d: 0ms' } },
    h('span', { class: 'st-mode', text: 'NORMAL' }),
    stPath,
    stCount,
    stKeys,
    h('span', { class: 'st-fill' }),
    stPos,
    stClock,
    stGpu,
  )

  // The clock keeps my time: a visitor sees when it is here.
  const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const tickClock = () => {
    if (document.hidden) return
    stClock.textContent = `${clockFmt.format(new Date())} dhaka`
  }
  tickClock()
  setInterval(tickClock, 1000)

  // The pointer readout writes once per frame at most, however fast the mouse moves.
  let pointerPending: Point | null = null
  let pointerRaf = 0
  const writePointer = () => {
    pointerRaf = 0
    const p = pointerPending
    if (!p) return
    stPos.textContent = `x ${((p.x + 1) / 2).toFixed(3)} · y ${((1 - p.y) / 2).toFixed(3)}`
  }

  const el = h('div', { class: 'hud', attrs: { inert: '' } }, scrim, top, index, edgePrev, edgeNext, callout, panel, workScroll, caseScroll, help, status, live)
  let caseShown = -1

  const setName = (text: string, animate: boolean) => {
    // The type scale fits the longest name into the panel; --chars drives it.
    name.style.setProperty('--chars', String(Math.max(text.length, 8)))
    nameSr.textContent = text
    scramble(nameVis, text, !animate)
    requestAnimationFrame(() => {
      measureTitle()
      drawCallout()
    })
  }

  /** Show or hide one part of a view, for eyes and for assistive tech. */
  const part = (node: HTMLElement, on: boolean) => {
    node.classList.toggle('off', !on)
    if (on) node.removeAttribute('inert')
    else node.setAttribute('inert', '')
  }

  const showHome = (animate: boolean) => {
    tag.replaceChildren(h('span', { class: 'p-prompt', text: '$ ' }), h('span', { text: 'whoami' }))
    copy.replaceChildren(h('p', { class: 'p-line', text: profile.summary }))
    formV.textContent = ''
    link.removeAttribute('href')
    setName(profile.hello, animate)
  }

  const showProject = (p: Project, animate: boolean) => {
    tag.replaceChildren(
      h('span', { text: p.kind }),
      dot(),
      h('span', { class: 'p-year', text: String(p.year) }),
      ...(p.stars > 0 ? [dot(), h('span', { class: 'p-stars', text: `★ ${p.stars}`, attrs: { 'aria-label': `${p.stars} stars on github` } })] : []),
    )
    copy.replaceChildren(h('p', { class: 'p-line', text: p.line }))
    formV.textContent = p.form
    link.href = p.url
    link.textContent = '→ github'
    link.setAttribute('aria-label', `${p.name} on github`)
    setName(p.name, animate)
  }

  return {
    el,
    workScroll,
    caseScroll,
    workOpened: () => workMotion.open(),
    show() {
      el.removeAttribute('inert')
      el.classList.add('hud--on')
    },
    set(view, i, animate, caseOpen = false) {
      const p = projects[i] ?? projects[0]!
      const viewChanged = view !== currentView
      const projectChanged = view === 'projects' && (viewChanged || i !== currentIndex)
      const wantCase = view === 'projects' && caseOpen ? i : -1
      const caseChanged = wantCase !== caseShown
      if (!viewChanged && !projectChanged && !caseChanged) return
      currentView = view
      if (view === 'projects') currentIndex = i
      if (caseChanged) {
        caseShown = wantCase
        if (wantCase >= 0) renderCase(wantCase)
      }
      const onCase = wantCase >= 0
      el.dataset.case = onCase ? 'on' : 'off'

      el.dataset.view = view
      navLinks.forEach((a, k) => (['home', 'projects', 'work'][k] === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')))
      part(index, view === 'projects' && !onCase)
      part(edgePrev, view === 'projects' && !onCase)
      part(edgeNext, view === 'projects' && !onCase)
      part(panel, view !== 'work' && !onCase)
      part(workScroll, view === 'work')
      part(caseScroll, onCase)
      part(scrim, view === 'work')
      panelBody.classList.toggle('is-home', view === 'home')
      document.documentElement.style.setProperty('--accent', view === 'projects' ? p.accent : view === 'work' ? WORK_ACCENT : HOME_ACCENT)
      items.forEach((b) => (Number(b.dataset.i) === currentIndex && view === 'projects' ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')))

      if (view === 'home' && viewChanged) showHome(animate)
      if (view === 'projects') showProject(p, animate)
      if (animate && view !== 'work') replay(panelBody, 'swap')
      if (animate && view === 'projects') replay(callout as unknown as HTMLElement, 'draw')
      drawCallout()

      const count = `${pad2(i + 1)}/${total}`
      pagerN.textContent = count
      stPath.textContent = view === 'home' ? '~/harbor' : view === 'work' ? '~/harbor/work' : `~/harbor/projects/${p.id}${onCase ? '/case' : ''}`
      stCount.textContent = view === 'projects' ? count : ''
      stCount.hidden = view !== 'projects'
      stKeys.textContent = onCase ? CASE_KEYS : STATUS_KEYS[view]
      live.textContent =
        view === 'projects'
          ? `${pad2(i + 1)} of ${total}: ${p.name}, ${p.kind}. ${p.line}`
          : view === 'work'
            ? `work history: ${work.jobs.length} roles, newest first.`
            : `${profile.hello} ${profile.summary}`
    },
    setStats(s) {
      const text = `${s.backend} t${s.tier} ${Math.round(s.fps)}fps`
      if (text === lastStats) return
      lastStats = text
      stGpu.textContent = text
    },
    setPointer(p) {
      pointerPending = p
      if (p && !pointerRaf) pointerRaf = requestAnimationFrame(writePointer)
    },
    setAnchor(p) {
      anchor = p
      drawCallout()
    },
    toggleHelp(force) {
      const open = force ?? help.hidden
      help.hidden = !open
    },
    helpOpen: () => !help.hidden,
  }
}

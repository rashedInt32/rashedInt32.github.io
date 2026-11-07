import { HOME_ACCENT, type Profile, type Project, type SceneStats, type View, type WorkHistory } from '../contract'
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
}

export interface Hud {
  el: HTMLElement
  /** The work view's scroll container, for keyboard scrolling and focus. */
  workScroll: HTMLElement
  /** The work view just opened: measure it and report where it's scrolled. */
  workOpened(): void
  show(): void
  /** Show `view` and, in projects, project `i`. `animate` runs the decode and swap. */
  set(view: View, i: number, animate: boolean): void
  setStats(s: SceneStats): void
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
      { class: 'gh', attrs: { href: profile.contact.github, target: '_blank', rel: 'noopener' } },
      'github',
      h('span', { class: 'gh-arrow', text: ' ↗', attrs: { 'aria-hidden': 'true' } }),
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
    h('ol', { class: 'rise', attrs: { style: '--d: 160ms' } }, ...items.map((b) => h('li', null, b))),
  )
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
    h('div', { class: 'p-actions' }, link, hint, h('div', { class: 'pager' }, prev, pagerN, next)),
  )
  const panel = h('section', { class: 'panel view-part' }, h('div', { class: 'rise', attrs: { style: '--d: 280ms' } }, panelBody))

  // ── work: a scrolling timeline over the dimmed hall ────
  const scrim = h('div', { class: 'work-scrim view-part', attrs: { 'aria-hidden': 'true' } })
  const workCol = h('div', { class: 'work-col' }, ...renderWork(work, profile, 1, 'work-title'))
  const workScroll = h('main', { class: 'work view-part', attrs: { 'aria-labelledby': 'work-title', tabindex: '-1' } }, workCol)
  const workMotion = attachWorkMotion(workScroll, workCol, (t) => act.scrolled(t))

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
  const stGpu = h('span', { class: 'st-seg st-gpu', text: '…' })
  const status = h(
    'footer',
    { class: 'status rise', attrs: { style: '--d: 0ms' } },
    h('span', { class: 'st-mode', text: 'NORMAL' }),
    stPath,
    stCount,
    stKeys,
    h('span', { class: 'st-fill' }),
    stGpu,
  )

  const el = h('div', { class: 'hud', attrs: { inert: '' } }, scrim, top, index, panel, workScroll, help, status, live)

  const setName = (text: string, animate: boolean) => {
    // The type scale fits the longest name into the panel; --chars drives it.
    name.style.setProperty('--chars', String(Math.max(text.length, 8)))
    nameSr.textContent = text
    scramble(nameVis, text, !animate)
  }

  /** Show or hide one part of a view, for eyes and for assistive tech. */
  const part = (node: HTMLElement, on: boolean) => {
    node.classList.toggle('off', !on)
    if (on) node.removeAttribute('inert')
    else node.setAttribute('inert', '')
  }

  const showHome = (animate: boolean) => {
    tag.replaceChildren(h('span', { class: 'p-prompt', text: '$ ' }), h('span', { text: 'whoami' }))
    copy.replaceChildren(...profile.lines.map((t) => h('p', { class: 'p-line', text: t })))
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
    workOpened: () => workMotion.open(),
    show() {
      el.removeAttribute('inert')
      el.classList.add('hud--on')
    },
    set(view, i, animate) {
      const p = projects[i] ?? projects[0]!
      const viewChanged = view !== currentView
      const projectChanged = view === 'projects' && (viewChanged || i !== currentIndex)
      if (!viewChanged && !projectChanged) return
      currentView = view
      if (view === 'projects') currentIndex = i

      el.dataset.view = view
      navLinks.forEach((a, k) => (['home', 'projects', 'work'][k] === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')))
      part(index, view === 'projects')
      part(panel, view !== 'work')
      part(workScroll, view === 'work')
      part(scrim, view === 'work')
      panelBody.classList.toggle('is-home', view === 'home')
      document.documentElement.style.setProperty('--accent', view === 'projects' ? p.accent : view === 'work' ? WORK_ACCENT : HOME_ACCENT)
      items.forEach((b) => (Number(b.dataset.i) === currentIndex && view === 'projects' ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')))

      if (view === 'home' && viewChanged) showHome(animate)
      if (view === 'projects') showProject(p, animate)
      if (animate && view !== 'work') replay(panelBody, 'swap')

      const count = `${pad2(i + 1)}/${total}`
      pagerN.textContent = count
      stPath.textContent = view === 'home' ? '~/harbor' : view === 'work' ? '~/harbor/work' : `~/harbor/projects/${p.id}`
      stCount.textContent = view === 'projects' ? count : ''
      stCount.hidden = view !== 'projects'
      stKeys.textContent = STATUS_KEYS[view]
      live.textContent =
        view === 'projects'
          ? `${pad2(i + 1)} of ${total}: ${p.name}, ${p.kind}. ${p.line}`
          : view === 'work'
            ? `work history: ${work.jobs.length} roles, newest first.`
            : `${profile.hello} ${profile.lines.join(' ')}`
    },
    setStats(s) {
      const text = `${s.backend} t${s.tier} ${Math.round(s.fps)}fps`
      if (text === lastStats) return
      lastStats = text
      stGpu.textContent = text
    },
    toggleHelp(force) {
      const open = force ?? help.hidden
      help.hidden = !open
    },
    helpOpen: () => !help.hidden,
  }
}

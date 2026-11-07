import { HOME, type Ui, type UiOptions, type View } from '../contract'
import { reducedMotion } from './dom'
import { renderFallback } from './fallback'
import { createHud } from './hud'
import { bindInput } from './input'
import { createIntro } from './intro'
import { parseRoute, routeHref, routeUrl } from './route'

// Three views of one hall: home, projects, work. The URL hash is the source
// of truth for where you are; keys, the nav and links all route through go().

export function createUI(opts: UiOptions): Ui {
  const { root, projects, profile, work } = opts
  const n = projects.length
  const reduced = reducedMotion()

  const initial = parseRoute(location.hash, projects)
  let view: View = initial.view
  let index = initial.project ?? 0
  let caseOpen = initial.caseOpen
  // Old #<id> links: rewrite to the new form without adding history.
  if (initial.view === 'projects' && location.hash !== routeHref('projects', projects[index]!, caseOpen)) {
    history.replaceState(null, '', routeUrl('projects', projects[index]!, caseOpen))
  }

  /** The scene has been told to reveal: from here on, view changes reach it. */
  let live = false
  /** The intro is gone: keys, wheel and swipe act. */
  let entered = false
  let failed = false

  const notify = (viewChanged: boolean, indexChanged: boolean) => {
    if (!live) return
    if (viewChanged) opts.onView(view)
    if (view === 'projects' && (viewChanged || indexChanged)) opts.onSelect(index)
  }

  type Write = 'push' | 'replace' | 'none'
  const apply = (nextView: View, nextIndex: number, write: Write, tell: boolean, nextCase = false) => {
    const viewChanged = nextView !== view
    const indexChanged = nextIndex !== index
    const wasCase = caseOpen
    view = nextView
    index = nextIndex
    caseOpen = nextView === 'projects' && nextCase
    hud.set(view, index, entered && !reduced, caseOpen)
    const url = routeUrl(view, projects[index]!, caseOpen)
    if (write === 'push' && (viewChanged || caseOpen !== wasCase)) history.pushState(null, '', url)
    else if (write !== 'none') history.replaceState(null, '', url)
    if (tell) notify(viewChanged, indexChanged)
    if (viewChanged && view === 'work') {
      hud.workScroll.scrollTop = 0
      if (entered) hud.workScroll.focus({ preventScroll: true })
      hud.workOpened()
    }
    if (caseOpen !== wasCase) {
      // The hall freezes under the case page once the index change has
      // reached the scene (notify above), so the still shows the right form.
      if (caseOpen) {
        hud.caseScroll.scrollTop = 0
        if (entered) hud.caseScroll.focus({ preventScroll: true })
      }
      if (live) opts.onFrozen(caseOpen)
    }
  }

  /** Open or close the current project's case page. */
  const showCase = (on: boolean) => {
    if (!entered || view !== 'projects' || on === caseOpen) return
    apply('projects', index, 'push', true, on)
  }

  /** Change view, as a new history entry. */
  const go = (v: View, i = index) => {
    if (!entered) return
    if (v === view && (v !== 'projects' || i === index) && !caseOpen) return
    apply(v, i, 'push', true)
  }

  /** A project, in the projects view. Steps replace history so back leaves the view. */
  const select = (i: number) => {
    if (!entered) return
    const next = Math.min(n - 1, Math.max(0, i))
    if (view !== 'projects') return go('projects', next)
    // From one case page to the next: the hall thaws for the morph, then freezes again.
    if (next !== index) apply('projects', next, caseOpen ? 'push' : 'replace', true, caseOpen)
  }

  const scrollWork = (by: number | 'top' | 'bottom') => {
    const s = caseOpen ? hud.caseScroll : hud.workScroll
    const top = by === 'top' ? 0 : by === 'bottom' ? s.scrollHeight : s.scrollTop + by
    s.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
  }

  const step = (dir: 1 | -1, source: 'key' | 'wheel' | 'swipe' = 'key') => {
    if (view === 'work' || caseOpen) {
      // The wheel and swipes scroll the page natively; keys scroll it here.
      if (source === 'key') scrollWork(dir * 96)
      return
    }
    if (view === 'home') {
      if (dir > 0) go('projects', 0)
      return
    }
    // In projects: k on the first one goes back home; j stops at the last.
    if (dir < 0 && index === 0) go('home')
    else select(index + dir)
  }

  const hud = createHud(projects, profile, work, {
    pick: (i) => select(i),
    go: (v) => go(v),
    step: (d) => step(d),
    openCase: (i) => {
      if (i !== index) apply('projects', i, 'push', true, true)
      else showCase(true)
    },
    closeCase: () => showCase(false),
    scrolled: (t) => {
      if (live && view === 'work') opts.onWorkScroll(t)
    },
  })
  hud.set(view, index, false, caseOpen)

  const intro = createIntro({
    reduced,
    horizonY: opts.horizonY,
    onSubmit: () => {
      opts.onEnter()
      live = true
      // The scene reveals onto HOME; move it to wherever the URL points.
      notify(true, true)
      if (view === 'work') hud.workOpened()
      // A deep link to a case page: let the reveal play out, then freeze.
      if (caseOpen) setTimeout(() => opts.onFrozen(true), 3600)
    },
    onDone: () => {
      entered = true
      hud.show()
      if (view === 'work') hud.workScroll.focus({ preventScroll: true })
    },
  })

  root.append(hud.el, intro.el)

  // Back and forward move between views; the URL decides.
  const onPop = () => {
    const r = parseRoute(location.hash, projects)
    apply(r.view, r.project ?? index, 'none', true, r.caseOpen)
  }
  addEventListener('popstate', onPop)

  const unbind = bindInput({
    active: () => entered && !failed,
    step,
    view: (v) => go(v),
    first: () => (view === 'work' || caseOpen ? scrollWork('top') : view === 'projects' ? select(0) : undefined),
    last: () => (view === 'work' || caseOpen ? scrollWork('bottom') : select(n - 1)),
    jump: (i) => {
      if (i < n) select(i)
    },
    // Enter opens the project's page; o goes straight to github.
    open: (direct) => {
      if (view !== 'projects') return
      if (direct || caseOpen) window.open(projects[index]!.url, '_blank', 'noopener')
      else showCase(true)
    },
    help: () => hud.toggleHelp(),
    escape: () => {
      if (hud.helpOpen()) hud.toggleHelp(false)
      else if (caseOpen) showCase(false)
      else if (view === 'work') go('home')
    },
    pointer: (p) => {
      opts.onPointer(p)
      hud.setPointer(p)
    },
  })

  return {
    setReady: () => intro.setReady(),
    setFailed(reason) {
      if (failed) return
      failed = true
      unbind()
      removeEventListener('popstate', onPop)
      intro.destroy()
      hud.el.remove()
      root.append(renderFallback(projects, profile, work, reason))
    },
    setActive(i) {
      if (i === HOME) apply('home', index, 'replace', false)
      else apply('projects', Math.min(n - 1, Math.max(0, i)), 'replace', false, caseOpen)
    },
    setView(v) {
      apply(v, index, 'replace', false)
    },
    setStats: (s) => hud.setStats(s),
    setProgress: (t) => intro.setProgress(t),
    setAnchor: (p) => hud.setAnchor(p),
  }
}

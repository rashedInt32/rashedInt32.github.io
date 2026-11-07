import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/manrope'
import './styles.css'
import type { Scene, Ui } from './contract'
import { profile, work } from './about'
import { projects } from './projects'
import { createUI } from './ui'

const params = new URLSearchParams(location.search)

// ?noscene runs the overlay against a stub, so the UI can be worked on
// without a GPU in the loop.
function stubScene(): Scene {
  return {
    ready: new Promise((r) => setTimeout(r, 1200)),
    reveal: () => 2400,
    setView: () => {},
    setWorkScroll: () => {},
    setProject: () => {},
    setPointer: () => {},
    setFrozen: () => {},
    horizonY: () => innerHeight * 0.62,
    stats: () => ({ fps: 60, tier: 3, backend: 'none', particles: 0 }),
  }
}

async function loadScene(): Promise<Scene> {
  if (params.has('noscene')) return stubScene()
  const { createScene } = await import('./scene')
  return createScene({
    host: document.getElementById('scene')!,
    projects,
    params,
    onProgress: (t) => ui.setProgress(t),
    onAnchor: (p) => ui.setAnchor(p),
  })
}

const scenePromise = loadScene()
let scene: Scene | null = null
const queue: Array<(s: Scene) => void> = []
const withScene = (fn: (s: Scene) => void) => (scene ? fn(scene) : queue.push(fn))

const ui: Ui = createUI({
  root: document.getElementById('ui')!,
  projects,
  profile,
  work,
  onEnter: () => withScene((s) => s.reveal()),
  onView: (v) => withScene((s) => s.setView(v)),
  onWorkScroll: (t) => scene?.setWorkScroll(t),
  onSelect: (i) => withScene((s) => s.setProject(i)),
  onPointer: (p) => scene?.setPointer(p),
  onFrozen: (on) => {
    // The still is blurred by the compositor, once; nothing renders behind it.
    document.getElementById('scene')!.classList.toggle('frozen', on)
    withScene((s) => s.setFrozen(on))
  },
  horizonY: () => scene?.horizonY() ?? innerHeight * 0.62,
})

scenePromise
  .then(async (s) => {
    scene = s
    // ?perf also exposes the scene for poking at views from the console.
    if (params.has('perf')) (window as unknown as { __scene: Scene }).__scene = s
    for (const fn of queue.splice(0)) fn(s)
    await s.ready
    ui.setReady()
    setInterval(() => {
      if (!document.hidden) ui.setStats(s.stats())
    }, 500)
  })
  .catch((err: unknown) => {
    console.error(err)
    ui.setFailed(err instanceof Error ? err.message : String(err))
  })

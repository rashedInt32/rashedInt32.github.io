import type { Project, View } from '../contract'

// Hash routes, so the site works on any static host:
//   #/ or nothing        home
//   #/projects           projects, on the last one viewed
//   #/projects/<id>      projects, on that one
//   #/projects/<id>/case that project's page, over a still of the hall
//   #/work               work history
// Old links of the form #<id> still open that project.

export interface Route {
  view: View
  /** A project index, or null when the route doesn't name one. */
  project: number | null
  /** The project's case page is open. */
  caseOpen: boolean
}

export function parseRoute(hash: string, projects: Project[]): Route {
  let path = hash.replace(/^#/, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // A malformed escape: treat the raw text as the path.
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (path === '') return { view: 'home', project: null, caseOpen: false }
  if (path === 'work') return { view: 'work', project: null, caseOpen: false }
  if (path === 'projects') return { view: 'projects', project: null, caseOpen: false }
  const m = /^projects\/([^/]+)(\/case)?$/.exec(path)
  const id = m?.[1] ?? path
  const i = projects.findIndex((p) => p.id === id)
  return i >= 0 ? { view: 'projects', project: i, caseOpen: !!m?.[2] } : { view: 'home', project: null, caseOpen: false }
}

/** The link target for a view, for href attributes. */
export function routeHref(view: View, project: Project | null = null, caseOpen = false): string {
  if (view === 'home') return '#/'
  if (view === 'work') return '#/work'
  if (!project) return '#/projects'
  return caseOpen ? `#/projects/${project.id}/case` : `#/projects/${project.id}`
}

/** The URL to put in history for a view: home is the bare path, no hash. */
export function routeUrl(view: View, project: Project | null, caseOpen = false): string {
  return view === 'home' ? location.pathname + location.search : routeHref(view, project, caseOpen)
}

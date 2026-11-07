// The seam between the 3D scene (src/scene) and the DOM overlay (src/ui).
// main.ts wires one to the other. Neither side imports the other.

export type FormId = 'lazydiff' | 'glass' | 'zen' | 'hive' | 'auth' | 'sluice' | 'eddy' | 'watchglass' | 'quilt' | 'loom'

export interface Project {
  id: FormId
  /** Display name, e.g. 'quilt.nvim'. */
  name: string
  /** What it is, e.g. 'neovim plugin'. */
  kind: string
  year: number
  /** One-line pitch, first person. */
  line: string
  /** What the shape in the water is, e.g. 'a curl-noise vortex'. */
  form: string
  url: string
  /** GitHub stars when the list was last refreshed. 0 hides the badge. */
  stars: number
  /** CSS hex. Matches the form's main color in the scene. */
  accent: string
  /** The case page (#/projects/<id>/case). Every field is optional; the page shows what is there. */
  case?: ProjectCase
}

export interface ProjectCase {
  /** One or two sentences, where `line` is one. */
  summary?: string
  /** e.g. 'design · code' */
  role?: string
  stack?: string[]
  /** What it does, one line each. */
  points?: string[]
  /** Screenshots, served from /public. Shown numbered, in order. */
  shots?: Array<{ src: string; alt: string; caption?: string }>
}

/** Who the site is about. The home view shows this. */
export interface Profile {
  name: string
  /** One short line under the name, e.g. 'frontend engineer · full-stack typescript · 10+ yrs'. */
  role: string
  /** Where and how, e.g. 'dhaka, bangladesh · remote, utc+6'. */
  place: string
  /** The first thing the home view says, e.g. "hi, i'm rashed." */
  hello: string
  /** One short line for the home panel, two lines wrapped at most. */
  summary: string
  /** A few short paragraphs, first person, lowercase like the rest of the UI. Shown on the work page. */
  lines: string[]
  contact: Contact
}

export interface Contact {
  github: string
  linkedin: string
  email: string
  /** Path to the downloadable CV, served from /public. */
  cv: string
}

/** One role. Newest first in the list. */
export interface Job {
  role: string
  company: string
  /** e.g. 'remote, contract' or 'dhaka'. */
  where: string
  /** e.g. 'may 2025'. */
  from: string
  /** e.g. 'present'. */
  to: string
  /** Optional context line, e.g. 'placed as a contract engineer with iqvia for most of this period.' */
  note?: string
  /** What I did, one line each. When a role had distinct parts, use `parts` instead. */
  points: string[]
  /** Named sub-sections, e.g. IQVIA work and Adeva internal work. */
  parts?: Array<{ title: string; points: string[] }>
  stack: string[]
  /** The numbers worth putting large, straight from the CV. */
  highlights?: Array<{ value: string; label: string }>
}

export interface Education {
  degree: string
  school: string
  years: string
}

/** Client work from earlier years, with live links. */
export interface ClientProject {
  name: string
  line: string
  url: string
}

export interface WorkHistory {
  jobs: Job[]
  education: Education[]
  earlier: ClientProject[]
  /** Skills grouped the way the CV groups them. */
  skills: Array<{ group: string; items: string[] }>
}

/** The three views of the hall. */
export type View = 'home' | 'projects' | 'work'

/** Index of the home view: the grains spell the name, the panel says hello. */
export const HOME = -1
/** Accent for the home view, in the scene and the overlay: tidepool's text color. */
export const HOME_ACCENT = '#9bb5c7'

export type Tier = 0 | 1 | 2 | 3

export interface SceneStats {
  fps: number
  tier: Tier
  backend: 'webgpu' | 'webgl2' | 'none'
  particles: number
  /** True when the hall came from the Blender bake (public/hall/). */
  baked?: boolean
}

export interface Point {
  /** Normalised device coords, -1..1. */
  x: number
  /** Normalised device coords, -1..1, up is positive. */
  y: number
}

/** What the 3D scene exposes. */
export interface Scene {
  /** Resolves after GPU init and shader warm-up. Rejects when no GPU path works. */
  ready: Promise<void>
  /** Camera rises out of the water and the lights come up. Call once. Returns its duration in ms. */
  reveal(): number
  /**
   * Which view the hall is showing. home: the grains spell the name.
   * projects: the current project's form. work: the grains sink into the pool,
   * the camera turns along the hall and the scene calms to 30 fps for reading.
   */
  setView(view: View): void
  /** A project index, or HOME. Shown when the view is 'projects' (HOME also works there). */
  setProject(index: number): void
  /** How far down the work timeline the reader is, 0..1. The camera glides along the hall with it. */
  setWorkScroll(t: number): void
  /** Pointer over the page, or null when it leaves. */
  setPointer(p: Point | null): void
  /**
   * Hold the last frame and stop the loop, for pages that sit over a still
   * of the hall. Input doesn't wake it until it is released.
   */
  setFrozen(on: boolean): void
  /** CSS px from the top of the viewport where the water horizon sits before reveal. */
  horizonY(): number
  stats(): SceneStats
}

/** What the DOM overlay exposes. */
export interface Ui {
  /** The scene finished loading. The prompt accepts Enter from now on. */
  setReady(): void
  /** No GPU path. Show the plain-HTML project list instead. */
  setFailed(reason: string): void
  /** Select a project (or HOME) without the user asking, e.g. from the URL hash. */
  setActive(index: number): void
  /** Loading progress before ready, 0..1. Shown next to the prompt. */
  setProgress(t: number): void
  /** Where the current form is on screen (NDC), or null when no form shows. The callout line follows it. */
  setAnchor(p: Point | null): void
  /** Switch view without the user asking. */
  setView(view: View): void
  setStats(s: SceneStats): void
}

export interface UiOptions {
  root: HTMLElement
  projects: Project[]
  profile: Profile
  work: WorkHistory
  /** The user typed the command and pressed Enter. */
  onEnter(): void
  /** The user picked a project (or HOME) by key, wheel, swipe, or click. */
  onSelect(index: number): void
  /** The user switched view: nav, a home link, a key, or the URL. Called before onSelect when both change. */
  onView(view: View): void
  /** Work view scroll progress, 0 at the top to 1 at the bottom. Send it on scroll, throttled to frames. */
  onWorkScroll(t: number): void
  onPointer(p: Point | null): void
  /** A page that sits over a still of the hall opened or closed. */
  onFrozen(on: boolean): void
  /** Where to put the prompt line so it lands on the water. */
  horizonY(): number
}

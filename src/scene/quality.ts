import type { Tier } from '../contract'

export interface Quality {
  tier: Tier
  /** Particles in the forms. */
  particles: number
  /** Dust motes drifting through the light shafts. */
  motes: number
  /** Water reflection render scale, 0..1 of the canvas. */
  reflectScale: number
  bloom: boolean
  /** MSAA samples on the main pass. Lets the grains use alpha-to-coverage. */
  samples: number
  /** Cap on devicePixelRatio. The scene is dark and grainy, so 1x holds up. */
  dpr: number
  shafts: boolean
}

const TIERS: Record<Tier, Quality> = {
  3: { tier: 3, particles: 120_000, motes: 5000, reflectScale: 0.5, bloom: true, samples: 4, dpr: 1, shafts: true },
  2: { tier: 2, particles: 80_000, motes: 3500, reflectScale: 0.4, bloom: true, samples: 4, dpr: 1, shafts: true },
  1: { tier: 1, particles: 40_000, motes: 1800, reflectScale: 0.3, bloom: false, samples: 0, dpr: 0.85, shafts: true },
  0: { tier: 0, particles: 16_000, motes: 0, reflectScale: 0.25, bloom: false, samples: 0, dpr: 0.75, shafts: false },
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render/i
const INTEGRATED = /intel|mali|adreno|powervr|uhd|iris/i

export interface GpuInfo {
  backend: 'webgpu' | 'webgl2'
  /** vendor/architecture/description joined, for logs and the governor's memory key. */
  id: string
}

export async function probeGpu(forceWebGL: boolean): Promise<GpuInfo> {
  if (!forceWebGL && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (adapter) {
        const info = adapter.info
        return { backend: 'webgpu', id: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') }
      }
    } catch {
      // Fall through to WebGL2.
    }
  }
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) throw new Error('This browser has neither WebGPU nor WebGL2.')
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const id = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { backend: 'webgl2', id }
}

export function pickTier(gpu: GpuInfo, params: URLSearchParams): Tier {
  const forced = Number(params.get('tier'))
  if (params.has('tier') && [0, 1, 2, 3].includes(forced)) return forced as Tier
  if (SOFTWARE.test(gpu.id)) return 0
  const coarse = matchMedia('(pointer: coarse)').matches
  if (gpu.backend === 'webgl2') return coarse ? 0 : 1
  if (coarse) return /apple/i.test(gpu.id) ? 2 : 1
  if (INTEGRATED.test(gpu.id)) return 1
  if (/apple|nvidia|amd|radeon/i.test(gpu.id)) return 3
  return 2
}

export function qualityFor(tier: Tier): Quality {
  const q = { ...TIERS[tier] }
  // Phones are ~390 CSS px wide at 3x. At 1x the picture and its reflection
  // go blocky, and there are far fewer pixels to fill than on a desktop.
  if (matchMedia('(pointer: coarse)').matches && tier >= 1) {
    q.dpr = tier >= 2 ? 1.5 : 1.2
    q.reflectScale = Math.max(q.reflectScale, 0.55)
  }
  return q
}

// The governor watches real frame times and steps quality down when the
// machine can't hold the floor. Each rung is cheaper than the last. The rung
// is remembered per GPU for a week, so a slow laptop doesn't relearn it on
// every visit.
export interface Rung {
  renderScale: number
  bloom: boolean
  reflectScale: number
  particleShare: number
}

const RUNGS: Rung[] = [
  { renderScale: 1, bloom: true, reflectScale: 1, particleShare: 1 },
  { renderScale: 0.85, bloom: true, reflectScale: 0.8, particleShare: 1 },
  { renderScale: 0.85, bloom: false, reflectScale: 0.6, particleShare: 0.75 },
  { renderScale: 0.7, bloom: false, reflectScale: 0.5, particleShare: 0.5 },
]

// v2: v1 could store a rung learned from shader-compile stutter at load.
const KEY = 'harbor.quality.v2'
const WEEK = 7 * 24 * 3600 * 1000

export class Governor {
  rung = 0
  private samples: number[] = []
  private lowSince = -1
  private readonly floor: number
  private readonly enabled: boolean

  constructor(
    private readonly gpuId: string,
    params: URLSearchParams,
    private readonly onChange: (r: Rung) => void,
  ) {
    this.enabled = params.get('gov') !== 'off' && !params.has('tier')
    this.floor = Number(params.get('gov')) > 0 ? Number(params.get('gov')) : 48
    if (this.enabled) this.rung = this.recall()
  }

  current(): Rung {
    return RUNGS[this.rung]!
  }

  /**
   * Feed one rendered frame's lateness: its duration over the frame time it
   * was capped at (1 = on time). Caps vary, so a fixed fps floor won't do.
   */
  sample(lateness: number, now: number) {
    if (!this.enabled) return
    this.samples.push(lateness)
    if (this.samples.length < 60) return
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    this.samples.length = 0
    // ?gov=N keeps its old meaning, a floor in fps at 60: 48 allows 25% late.
    if (avg <= 60 / this.floor) {
      this.lowSince = -1
      return
    }
    if (this.lowSince < 0) this.lowSince = now
    if (now - this.lowSince > 2500 && this.rung < RUNGS.length - 1) {
      this.rung++
      this.lowSince = -1
      this.remember()
      this.onChange(this.current())
    }
  }

  /** Forget measurements, e.g. after the tab was hidden or the idle cap toggled. */
  reset() {
    this.samples.length = 0
    this.lowSince = -1
  }

  private recall(): number {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { rung: number; gpu: string; at: number } | null
      if (!raw || raw.gpu !== this.gpuId || Date.now() - raw.at > WEEK) return 0
      return Math.max(0, Math.min(RUNGS.length - 1, raw.rung))
    } catch {
      return 0
    }
  }

  private remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ rung: this.rung, gpu: this.gpuId, at: Date.now() }))
    } catch {
      // Private mode. Nothing to keep.
    }
  }
}

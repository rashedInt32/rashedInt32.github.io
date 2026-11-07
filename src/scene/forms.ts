// Every project is a shape the particles hold. Each shape is pure math on the
// GPU: given a particle's random seeds and the time, where should it be, what
// color is it, and how much does it glow. Nothing is downloaded.
//
// Shapes are written as plain functions that emit TSL statements into vars
// owned by the compute shader. evalForm() picks one with an If-chain on a
// uniform, so every invocation takes the same branch.

import * as THREE from 'three/webgpu'
import {
  If,
  PI,
  abs,
  clamp,
  color,
  cos,
  exp,
  float,
  floor,
  fract,
  int,
  log,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uniformArray,
  vec3,
  vec4,
} from './tsl'
import type { FormId } from '../contract'
import { KEY_DIR as KEY } from './layout'

// TSL node graphs are dynamically typed; the published typings fight swizzles
// and mixed scalar/vector math, so helpers take and return `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export const FORM_ORDER: FormId[] = ['lazydiff', 'glass', 'zen', 'hive', 'auth', 'sluice', 'eddy', 'watchglass', 'quilt', 'loom']
/** The home view: the grains spell the name. */
export const NAME = FORM_ORDER.length
/** The resting state before the reveal: everything under the water. */
export const SUBMERGED = FORM_ORDER.length + 1

export function formIndex(id: FormId): number {
  return FORM_ORDER.indexOf(id)
}

export interface FormCtx {
  h1: N
  h2: N
  h3: N
  h4: N
  h5: N
  t: N
  /** This grain's spot in the sampled name (vec4: local xyz, w = 0..1 across the text). */
  name: N
}

const TAU = Math.PI * 2

// PRISM, from the glass mod: the seven beams out of the prism.
const PRISM = ['#ff6b6b', '#e28f2a', '#ff9f1a', '#43b581', '#4eb4d3', '#4d96ff', '#8c6ff0']
// A warm quilt drawn from tidepool and PRISM.
const QUILT = ['#ff6b6b', '#e06c75', '#e09cb0', '#e0af68', '#c678dd', '#ff9f1a']

const toVec3 = (hex: string) => {
  const c = new THREE.Color(hex)
  return new THREE.Vector3(c.r, c.g, c.b)
}
const palette = uniformArray([...PRISM, ...QUILT].map(toVec3), 'vec3')
const prismColor = (k: N): N => palette.element(int(k))
const quiltColor = (k: N): N => palette.element(int(k).add(PRISM.length))

const c = (hex: string): N => color(hex)

function rotX(p: N, a: N): N {
  const s = sin(a)
  const k = cos(a)
  return vec3(p.x, p.y.mul(k).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(k)))
}

function rotY(p: N, a: N): N {
  const s = sin(a)
  const k = cos(a)
  return vec3(p.x.mul(k).add(p.z.mul(s)), p.y, p.z.mul(k).sub(p.x.mul(s)))
}

function rotZ(p: N, a: N): N {
  const s = sin(a)
  const k = cos(a)
  return vec3(p.x.mul(k).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(k)), p.z)
}

/** A point on the surface of an axis-aligned box of the given size, centered at 0. */
function boxSurface(a: N, b: N, d: N, size: N): N {
  const p = vec3(a, b, d).sub(0.5).mul(size).toVar()
  const q = abs(p.div(size))
  const half = size.mul(0.5)
  If(q.x.greaterThanEqual(q.y).and(q.x.greaterThanEqual(q.z)), () => {
    p.x.assign(select(p.x.greaterThan(0), half.x, half.x.negate()))
  })
    .ElseIf(q.y.greaterThanEqual(q.z), () => {
      p.y.assign(select(p.y.greaterThan(0), half.y, half.y.negate()))
    })
    .Else(() => {
      p.z.assign(select(p.z.greaterThan(0), half.z, half.z.negate()))
    })
  return p
}

const jitter = (h: N, amount: number): N => h.sub(0.5).mul(amount)

// ---------------------------------------------------------------- eddy
// A whirlpool on the water and a spout twisting up out of it, banded by
// three helices. Both turn rigidly, so the arms never wind into rings.
function eddy(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  If(h1.lessThan(0.42), () => {
    const r = float(0.2).add(pow(h2, 0.7).mul(2.6))
    const haze = h1.lessThan(0.1)
    const arm = floor(h3.mul(4))
    const width = select(haze, float(TAU), r.mul(0.1).add(0.2))
    const a = arm
      .mul(TAU / 4)
      .add(log(r.add(0.2)).mul(2.6))
      .add(jitter(h4, 1).mul(width))
      .sub(t.mul(0.5))
    const y = float(0.03).add(h5.mul(0.05)).add(pow(r.div(2.8), 2).mul(0.12))
    P.assign(vec3(cos(a).mul(r), y, sin(a).mul(r)))
    const k = r.div(2.8)
    C.assign(vec4(mix(c('#dff6ff'), c('#4d96ff'), smoothstep(0.1, 1, k)), float(1).sub(k).mul(select(haze, float(0.15), float(0.55)))))
  })
    .ElseIf(h1.lessThan(0.93), () => {
      const s = h2
      const y = s.mul(4.6)
      const r = float(0.1).add(pow(s, 2.2).mul(1.75)).add(jitter(h5, 1).mul(s.mul(0.25).add(0.05)))
      const band = floor(h3.mul(3))
      const a = band
        .mul(TAU / 3)
        .add(s.mul(7))
        .add(jitter(h4, 1).mul(0.95))
        .sub(t.mul(1.5))
      P.assign(vec3(cos(a).mul(r), y, sin(a).mul(r)))
      C.assign(vec4(mix(c('#eefaff'), c('#4eb4d3'), smoothstep(0, 0.7, s)), float(0.75).sub(s.mul(0.45))))
    })
    .Else(() => {
      const ph = fract(h2.add(t.mul(0.35)))
      const a = h3.mul(TAU).sub(t.mul(1.5))
      const r = float(1.85).add(ph.mul(1.3))
      const y = float(4.6).add(sin(ph.mul(PI)).mul(0.5)).sub(ph.mul(ph).mul(1.4))
      P.assign(vec3(cos(a).mul(r), y, sin(a).mul(r)).add(vec3(jitter(h4, 0.1), 0, jitter(h5, 0.1))))
      C.assign(vec4(c('#e6f7ff'), float(1).sub(ph).mul(0.5)))
    })
}

// --------------------------------------------------------------- sluice
// A concrete gate with its panel raised, and a sheet of water pouring
// through it and breaking into spray on the surface.
function sluice(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  If(h1.lessThan(0.2), () => {
    const part = floor(h2.mul(3))
    const lintel = part.equal(2)
    const size = select(lintel, vec3(3.84, 0.34, 0.34), vec3(0.34, 4.7, 0.34))
    const side = select(part.equal(0), float(-1.75), float(1.75))
    const center = select(lintel, vec3(0, 4.62, 0), vec3(side, 2.35, 0))
    P.assign(boxSurface(h3, h4, h5, size).add(center))
    C.assign(vec4(c('#6f94a6'), 0.04))
  })
    .ElseIf(h1.lessThan(0.3), () => {
      const slat = floor(h2.mul(4))
      P.assign(vec3(mix(-1.58, 1.58, h3), slat.mul(0.16).add(3.4).add(jitter(h4, 0.07)), jitter(h5, 0.12).sub(0.06)))
      C.assign(vec4(c('#3e80a8'), 0.08))
    })
    .ElseIf(h1.lessThan(0.92), () => {
      const strand = floor(h2.mul(96)).add(0.5).add(jitter(h5, 0.9))
      const px = mix(-1.5, 1.5, strand.div(96))
      const ph = fract(h4.add(t.mul(h3.mul(0.16).add(0.4))))
      const y = float(3.3).sub(ph.mul(ph).mul(3.45))
      const z = ph
        .mul(0.62)
        .add(0.05)
        .add(sin(px.mul(2.3).add(t.mul(1.7))).mul(0.035))
        .add(jitter(h5, 0.06).mul(ph))
      P.assign(vec3(px, y, z))
      C.assign(vec4(mix(c('#d4e6ff'), c('#4d96ff'), ph), float(1).sub(ph).mul(0.45).add(0.12)))
    })
    .Else(() => {
      const ph = fract(h2.add(t.mul(h3.mul(0.5).add(0.9))))
      const a = h4.mul(TAU)
      const r = ph.mul(h5.mul(0.5).add(0.25))
      P.assign(vec3(mix(-1.5, 1.5, h3).add(cos(a).mul(r).mul(0.6)), sin(ph.mul(PI)).mul(h5.mul(0.45).add(0.12)), sin(a).mul(r).add(0.66)))
      C.assign(vec4(c('#eef5ff'), float(1).sub(ph).mul(0.55)))
    })
}

// ---------------------------------------------------------------- glass
// A crystal, a hexagonal bipyramid, turning slowly. Moonlight from the
// opening in the ceiling hits its tip and leaves as seven PRISM beams that
// fall to the water and sweep around it as it turns.
export const GLASS = { y: 3.1, girdle: 0.85, top: 1.45, bottom: 1.25, spin: 0.3 }
const beamElevation = (k: number) => -(0.88 + 0.1 * Math.sin(k * 1.7))

/** Where the seven beams land on the water at time t, for ripple rings. */
export function glassHits(t: number): Array<[number, number]> {
  return PRISM.map((_, k) => {
    const el = beamElevation(k)
    const az = (k * TAU) / PRISM.length + t * GLASS.spin
    const y0 = GLASS.y + 0.1 + GLASS.girdle * Math.sin(el)
    const reach = GLASS.girdle * Math.cos(el) + y0 / Math.tan(-el)
    return [Math.cos(az) * reach, Math.sin(az) * reach]
  })
}

function glass(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const spin = t.mul(GLASS.spin)
  const center = vec3(0, GLASS.y, 0)
  const top = vec3(0, GLASS.top, 0)
  const bottom = vec3(0, -GLASS.bottom, 0)
  const corner = (k: N): N => {
    const a = k.mul(TAU / 6)
    return vec3(cos(a).mul(GLASS.girdle), 0.1, sin(a).mul(GLASS.girdle))
  }
  const crystal = (p: N): N => rotY(rotX(p, 0.14), spin).add(center)
  If(h1.lessThan(0.28), () => {
    // 18 edges: tip to girdle, bottom to girdle, around the girdle.
    const e = floor(h2.mul(18))
    const k = mod(e, 6)
    const g = corner(k)
    const g2 = corner(k.add(1))
    const a = select(e.lessThan(6), top, select(e.lessThan(12), bottom, g))
    const b = select(e.lessThan(12), g, g2)
    P.assign(crystal(mix(a, b, h3)))
    C.assign(vec4(c('#ece6ff'), 0.7))
  })
    .ElseIf(h1.lessThan(0.4), () => {
      // 12 faces, sampled sparsely so the crystal reads as glass.
      const f = floor(h2.mul(12))
      const k = mod(f, 6)
      const tip = select(f.lessThan(6), top, bottom)
      const u = h3.toVar()
      const v = h4.toVar()
      If(u.add(v).greaterThan(1), () => {
        u.assign(float(1).sub(u))
        v.assign(float(1).sub(v))
      })
      const g = corner(k)
      const g2 = corner(k.add(1))
      P.assign(crystal(tip.add(g.sub(tip).mul(u)).add(g2.sub(tip).mul(v))))
      C.assign(vec4(mix(c('#8c6ff0'), c('#4d96ff'), h5), 0.07))
    })
    .ElseIf(h1.lessThan(0.48), () => {
      // The moonbeam coming down onto the tip. World space: it doesn't turn.
      const tip = vec3(0, GLASS.y + GLASS.top, 0)
      const from = tip.add(vec3(KEY.x, KEY.y, KEY.z).mul(9))
      const s = fract(h2.sub(t.mul(0.3)))
      P.assign(mix(from, tip, s).add(vec3(jitter(h3, 0.05), 0, jitter(h4, 0.05))))
      // Fades out toward the opening: the beam has no hard end at the frame edge.
      C.assign(vec4(c('#f4f8ff'), smoothstep(0.0, 0.35, s).mul(0.35)))
    })
    .Else(() => {
      const k = floor(h2.mul(7))
      const el = sin(k.mul(1.7)).mul(-0.1).sub(0.88)
      const az = k.mul(TAU / 7).add(spin)
      const dir = vec3(cos(el).mul(cos(az)), sin(el), cos(el).mul(sin(az)))
      const origin = vec3(0, GLASS.y + 0.1, 0).add(dir.mul(GLASS.girdle))
      const len = origin.y.div(sin(el).negate())
      const s = fract(h3.add(t.mul(0.32)))
      const spread = s.mul(2.5).add(1).mul(0.022)
      P.assign(origin.add(dir.mul(s.mul(len))).add(vec3(jitter(h4, 1).mul(spread), 0, jitter(h5, 1).mul(spread))))
      // Brightest leaving the crystal, thinning toward the water.
      C.assign(vec4(prismColor(k), float(0.66).sub(s.mul(0.3))))
    })
}

// ----------------------------------------------------------- watchglass
// An hourglass. The sand is conserved: each grain has a rank, and the
// drained fraction decides whether it sits in the top bulb, falls through the
// neck, or rests in the pile. At the end of the cycle time runs backwards.
function hourglassRadius(s: N): N {
  const a = abs(s)
  return float(0.09).add(pow(sin(a.mul(Math.PI / 2)), 1.6).mul(1.15).mul(float(1).sub(pow(a, 10).mul(0.3))))
}

function watchglass(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const cy = 2.5
  const half = 2.0
  const ph = fract(t.div(22))
  const drained = select(ph.lessThan(0.82), smoothstep(0, 0.82, ph), float(1).sub(smoothstep(0.86, 1, ph)))
  const sway = sin(t.mul(0.31)).mul(0.08)
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  If(h1.lessThan(0.26), () => {
    const s = h2.mul(2).sub(1)
    const r = hourglassRadius(s).add(0.03)
    const a = h3.mul(TAU)
    local.assign(vec3(cos(a).mul(r), s.mul(half), sin(a).mul(r)))
    col.assign(vec4(c('#9bb5c7'), 0.05))
  })
    .ElseIf(h1.lessThan(0.32), () => {
      If(h2.lessThan(0.55), () => {
        const a = h3.mul(TAU)
        const r = mix(0.3, 1.2, sqrt(h4))
        const y = select(h5.lessThan(0.5), float(half + 0.14), float(-half - 0.14))
        local.assign(vec3(cos(a).mul(r), y, sin(a).mul(r)))
      }).Else(() => {
        const a = floor(h3.mul(3)).mul(TAU / 3).add(0.5)
        local.assign(vec3(cos(a).mul(1.26), mix(-half - 0.14, half + 0.14, h4), sin(a).mul(1.26)))
      })
      col.assign(vec4(c('#c9a96e'), 0.04))
    })
    .Else(() => {
      const rank = h2
      const stream = 0.035
      const sTop = float(0.06).add(float(0.86).mul(float(1).sub(drained)))
      const sPile = float(-0.94).add(float(0.84).mul(drained))
      const a = h4.mul(TAU)
      If(rank.greaterThan(drained), () => {
        const s = mix(0.06, sTop, h3)
        const r = hourglassRadius(s).mul(0.9).mul(sqrt(h5))
        local.assign(vec3(cos(a).mul(r), s.mul(half), sin(a).mul(r)))
        col.assign(vec4(mix(c('#e28f2a'), c('#ff9f1a'), h5), 0.22))
      })
        .ElseIf(rank.greaterThan(drained.sub(stream)), () => {
          const f = drained.sub(rank).div(stream)
          const y = mix(0, sPile.mul(half), f.mul(f))
          const r = h5.mul(0.035)
          local.assign(vec3(cos(a).mul(r), y, sin(a).mul(r)))
          col.assign(vec4(c('#ffd08a'), 0.9))
        })
        .Else(() => {
          const s = mix(-0.94, sPile, h3)
          const mound = float(1).sub(pow(h3, 3).mul(0.7))
          const r = hourglassRadius(s).mul(0.9).mul(sqrt(h5)).mul(mound)
          local.assign(vec3(cos(a).mul(r), s.mul(half), sin(a).mul(r)))
          col.assign(vec4(mix(c('#e28f2a'), c('#ff9f1a'), h5), 0.2))
        })
    })
  P.assign(rotZ(local, sway).add(vec3(0, cy, 0)))
  C.assign(col)
}

// ---------------------------------------------------------------- quilt
// A sheet of patches stitched with dashed thread. Patches lift out one at a
// time and settle back, and the whole sheet moves like cloth.
function quilt(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const cols = 6
  const rows = 4
  const w = 5.2 / cols
  const h = 3.6 / rows
  const gap = 0.05
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  const patch = floor(h2.mul(cols * rows))
  const pc = mod(patch, cols)
  const pr = floor(patch.div(cols))
  const x0 = pc.mul(w).sub(2.6)
  const y0 = pr.mul(h).sub(1.8)
  If(h1.lessThan(0.82), () => {
    local.assign(vec3(x0.add(mix(gap, w - gap, h3)), y0.add(mix(gap, h - gap, h4)), jitter(h5, 0.03)))
    const k = mod(patch.mul(7).add(pr.mul(3)), QUILT.length)
    col.assign(vec4(quiltColor(k), 0.1))
  }).Else(() => {
    const side = floor(h3.mul(4))
    const s = h4
    const onX = side.lessThan(2)
    const along = select(onX, vec3(x0.add(s.mul(w)), y0.add(select(side.equal(0), float(gap * 0.5), float(h - gap * 0.5))), 0), vec3(x0.add(select(side.equal(2), float(gap * 0.5), float(w - gap * 0.5))), y0.add(s.mul(h)), 0))
    local.assign(along.add(vec3(0, 0, 0.03)))
    const dash = smoothstep(0.35, 0.5, abs(fract(s.mul(10).add(t.mul(0.4))).sub(0.5)).mul(2))
    col.assign(vec4(c('#ffe6e6'), dash.mul(0.55)))
  })
  const lift = pow(max(sin(t.mul(0.55).add(patch.mul(1.37))), 0), 8).mul(0.45)
  const wave = sin(local.x.mul(1.2).add(t.mul(0.8))).mul(cos(local.y.mul(1.4).sub(t.mul(0.5)))).mul(0.16)
  const p = vec3(local.x, local.y, local.z.add(lift).add(wave))
  P.assign(rotX(p, -0.22).add(vec3(0, 2.7, 0)))
  C.assign(col)
}

// ----------------------------------------------------------------- loom
// Warp threads strung top to bottom, weft woven over and under them row by
// row. The shuttle carries the newest row. At the end it unravels back onto
// the spool.
function loom(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const warps = 18
  const rowsN = 22
  const x0 = -2.25
  const span = 4.5
  const yBottom = 0.55
  const rowH = 0.19
  const ph = fract(t.div(24))
  const woven = select(ph.lessThan(0.84), smoothstep(0, 0.84, ph), float(1).sub(smoothstep(0.88, 1, ph))).mul(rowsN)
  const fell = float(yBottom).add(woven.mul(rowH))
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  const spool = vec3(3.05, 2.6, 0)
  If(h1.lessThan(0.3), () => {
    const k = floor(h2.mul(warps))
    const y = mix(0.25, 5.1, h3)
    const shed = smoothstep(0, 0.7, y.sub(fell)).mul(select(mod(k, 2).equal(0), float(0.16), float(-0.16)))
    local.assign(vec3(k.mul(span / (warps - 1)).add(x0), y, shed))
    col.assign(vec4(c('#a890c4'), 0.08))
  })
    .ElseIf(h1.lessThan(0.86), () => {
      const row = floor(h2.mul(rowsN))
      const dir = select(mod(row, 2).equal(0), float(1), float(-1))
      const progress = clamp(woven.sub(row), 0, 1)
      const xs = select(dir.greaterThan(0), mix(x0, x0 + span, progress), mix(x0 + span, x0, progress))
      const u = h3
      const xOf = select(dir.greaterThan(0), mix(x0, x0 + span, u), mix(x0 + span, x0, u))
      const y = row.mul(rowH).add(yBottom)
      If(u.lessThan(progress), () => {
        const over = sin(xOf.sub(x0).div(span / (warps - 1)).mul(PI).add(row.mul(PI))).mul(0.07)
        local.assign(vec3(xOf, y.add(jitter(h4, 0.03)), over.add(jitter(h5, 0.02))))
        col.assign(vec4(mix(c('#cbb4ff'), c('#8c6ff0'), mod(row, 2)), 0.22))
      }).Else(() => {
        // Not woven yet: wound on the spool, or trailing from the shuttle.
        const trailing = progress.greaterThan(0).and(progress.lessThan(1))
        const sh = vec3(xs, y, 0)
        const onSpool = vec3(cos(h4.mul(TAU)).mul(0.24), mix(-0.5, 0.5, h5), sin(h4.mul(TAU)).mul(0.24)).add(spool)
        const trail = mix(sh, spool, u.sub(progress).div(float(1).sub(progress).max(0.001)))
        local.assign(select(trailing, trail, onSpool))
        col.assign(vec4(c('#cbb4ff'), select(trailing, float(0.5), float(0.12))))
      })
    })
    .ElseIf(h1.lessThan(0.94), () => {
      const row = min(floor(woven), rowsN - 1)
      const dir = select(mod(row, 2).equal(0), float(1), float(-1))
      const progress = clamp(woven.sub(row), 0, 1)
      const xs = select(dir.greaterThan(0), mix(x0, x0 + span, progress), mix(x0 + span, x0, progress))
      const a = h3.mul(TAU)
      const r = sqrt(h4).mul(0.09)
      local.assign(vec3(xs.add(cos(a).mul(r).mul(2)), row.mul(rowH).add(yBottom).add(sin(a).mul(r)), jitter(h5, 0.08)))
      col.assign(vec4(c('#ffffff'), 1))
    })
    .Else(() => {
      const a = h3.mul(TAU)
      local.assign(vec3(cos(a).mul(0.26), mix(-0.55, 0.55, h4), sin(a).mul(0.26)).add(spool))
      col.assign(vec4(c('#8c6ff0'), 0.15))
    })
  P.assign(rotY(local, -0.1).add(vec3(0, 0, 0)))
  C.assign(col)
}

// ------------------------------------------------------------ submerged
function submerged(x: FormCtx, P: N, C: N) {
  const { h2, h3, h4 } = x
  const a = h2.mul(TAU)
  const r = sqrt(h3).mul(3.4)
  P.assign(vec3(cos(a).mul(r), float(-0.5).sub(h4.mul(1.6)), sin(a).mul(r)))
  C.assign(vec4(c('#0b2233'), 0))
}

// ------------------------------------------------------------- lazydiff
// A floating page of code. Two hunks: the deleted rows (coral) sink into the
// water while the added rows (emerald) rise out of it into the same slots,
// then it all reverses. Tokens with gaps, indentation, a gutter of line
// numbers and +/- marks, and faint diff bands behind the changed rows.
const LD_TOP = 4.75
const LD_ROW = 0.19
const LD_X0 = -1.92
const LD_INDENT = 0.3
const LD_GUTTER = -2.32
// [indent, length m, kind]; kind n = unchanged, d = deleted, b = blank
const LD_FILE: Array<[number, number, 'n' | 'd' | 'b']> = [
  [0, 2.2, 'n'], [0, 2.7, 'n'], [0, 0, 'b'], [0, 1.9, 'n'], [1, 2.4, 'n'],
  [1, 3.0, 'd'], [2, 2.6, 'd'], [2, 1.8, 'd'],
  [1, 2.2, 'n'], [1, 0.5, 'n'], [0, 0, 'b'], [1, 2.8, 'n'], [2, 2.1, 'n'],
  [2, 3.1, 'd'], [3, 2.0, 'd'],
  [2, 1.4, 'n'], [1, 0.5, 'n'], [0, 0.3, 'n'], [0, 0, 'b'], [0, 2.4, 'n'], [1, 1.7, 'n'], [0, 0.3, 'n'],
]
// [slot, indent, length m]: what replaces each deleted row
const LD_ADDED: Array<[number, number, number]> = [
  [5, 1, 2.7], [6, 2, 3.2], [7, 2, 2.0], [13, 2, 2.5], [14, 3, 2.7],
]
const LD_ROWS = uniformArray(
  [
    ...LD_FILE.map(([indent, len], i) => new THREE.Vector4(indent, len, i, i * 0.37 + 0.11)),
    ...LD_ADDED.map(([slot, indent, len], k) => new THREE.Vector4(indent, len, slot, k * 0.53 + 0.29)),
  ],
  'vec4',
)
// Changed slots: (slot, deleted row, added row, hunk order)
const LD_CHANGED = uniformArray(
  LD_ADDED.map(([slot], k) => new THREE.Vector4(slot, slot, LD_FILE.length + k, k)),
  'vec4',
)
// 128 bins over the unchanged rows, weighted by length, so long rows get
// as many grains per meter as short ones. Packed four to a vec4.
const LD_BINS = (() => {
  const rows = LD_FILE.map(([, len, kind], i) => ({ i, w: kind === 'n' ? Math.max(len, 0.25) : 0 })).filter((r) => r.w > 0)
  const total = rows.reduce((a, r) => a + r.w, 0)
  const bins: number[] = []
  for (let b = 0; b < 128; b++) {
    let at = ((b + 0.5) / 128) * total
    const row = rows.find((r) => (at -= r.w) <= 0) ?? rows[rows.length - 1]!
    bins.push(row.i)
  }
  const packed: THREE.Vector4[] = []
  for (let b = 0; b < 128; b += 4) packed.push(new THREE.Vector4(bins[b], bins[b + 1], bins[b + 2], bins[b + 3]))
  return uniformArray(packed, 'vec4')
})()

/** Cheap hash for small inputs, 0..1. */
const fh = (v: N): N => fract(sin(v.mul(12.9898)).mul(43758.5453))

function ldNormalRow(h: N): N {
  const k = floor(h.mul(128))
  const v = LD_BINS.element(int(floor(k.div(4))))
  const m = mod(k, 4)
  return LD_ROWS.element(int(select(m.equal(0), v.x, select(m.equal(1), v.y, select(m.equal(2), v.z, v.w)))))
}

/** x of a grain along a row of tokens; grains that land in a gap move into the token. */
function ldTokenX(row: N, u: N, h: N): { x: N; tk: N } {
  const seed = row.w
  const period = fract(seed.mul(7.13)).mul(0.18).add(0.3)
  const d0 = u.mul(row.y)
  const q = d0.add(seed.mul(3)).div(period)
  const tk = floor(q)
  const fill = fh(tk.add(seed.mul(31))).mul(0.42).add(0.5)
  const d = select(fract(q).greaterThan(fill), tk.add(h.mul(fill)).mul(period).sub(seed.mul(3)), d0)
  return { x: float(LD_X0).add(row.x.mul(LD_INDENT)).add(clamp(d, 0, row.y)), tk }
}

/**
 * Where hunk rows hit the water between two times: the deleted rows on their
 * way down (cycle 0.28), the added rows on theirs (0.78). For ripple rings.
 */
export function lazydiffHits(t0: number, t1: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const phase = (t: number, k: number) => ((((t - k * 0.2) / 16) % 1) + 1) % 1
  LD_ADDED.forEach(([slot, indent, len], k) => {
    const p0 = phase(t0, k)
    const p1 = phase(t1, k)
    for (const edge of [0.28, 0.78]) {
      if (p0 < edge && p1 >= edge && p1 - p0 < 0.5) {
        const deleted = LD_FILE[slot]!
        const width = edge < 0.5 ? deleted[1] : len
        const x0 = LD_X0 + (edge < 0.5 ? deleted[0] : indent) * LD_INDENT
        for (let i = 0; i < 4; i++) out.push([x0 + Math.random() * width, (Math.random() - 0.5) * 0.4])
      }
    }
  })
  return out
}

const ldSlotY = (slot: N): N => float(LD_TOP).sub(slot.mul(LD_ROW))
/** 0 = the deleted row is showing, 1 = the added row is. Staggered per hunk row, reverses each cycle. */
const ldState = (k: N, t: N): N => {
  const ph = fract(t.sub(k.mul(0.2)).div(16))
  return smoothstep(0.2, 0.36, ph).sub(smoothstep(0.7, 0.86, ph))
}

function lazydiff(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  If(h1.lessThan(0.58), () => {
    const row = ldNormalRow(h2)
    const { x: px, tk } = ldTokenX(row, h3, h5)
    local.assign(vec3(px, ldSlotY(row.z).add(jitter(h4, 0.075)), jitter(h5, 0.03)))
    const pick = fh(tk.mul(1.7).add(row.w.mul(13)))
    const tint = select(pick.lessThan(0.55), c('#9bb5c7'), select(pick.lessThan(0.7), c('#7aa2f7'), select(pick.lessThan(0.85), c('#cbb4ff'), c('#6fb1a0'))))
    col.assign(vec4(tint, 0.05))
  })
    .ElseIf(h1.lessThan(0.85), () => {
      // Changed rows: a deleted one and an added one per slot. Whichever is
      // not showing waits under the water.
      const added = h1.greaterThan(0.715)
      const k = floor(h2.mul(5))
      const ch = LD_CHANGED.element(int(k))
      const row = LD_ROWS.element(int(select(added, ch.z, ch.y)))
      const s = ldState(k, t)
      const gone = select(added, float(1).sub(s), s)
      const { x: px } = ldTokenX(row, h3, h5)
      const y0 = ldSlotY(ch.x)
      const fall = pow(gone, 1.6).mul(y0.add(1.2))
      local.assign(
        vec3(
          px.add(jitter(h4, 0.3).mul(gone)),
          y0.sub(fall).add(jitter(h4, 0.075)).add(jitter(h5, 0.22).mul(gone)),
          sin(gone.mul(PI)).mul(0.4).add(jitter(h5, 0.03)),
        ),
      )
      col.assign(vec4(select(added, c('#43b581'), c('#ff6b6b')), select(added, float(0.42), float(0.36))))
    })
    .ElseIf(h1.lessThan(0.93), () => {
      // Diff bands behind the changed slots, red before, green after.
      const k = floor(h2.mul(5))
      const ch = LD_CHANGED.element(int(k))
      const s = ldState(k, t)
      local.assign(vec3(mix(LD_GUTTER, 2.25, h3), ldSlotY(ch.x).add(jitter(h4, 0.17)), -0.07))
      col.assign(vec4(mix(c('#5a2028'), c('#14482f'), s), 0.02))
    })
    .Else(() => {
      If(h2.lessThan(0.45), () => {
        // Line numbers: two dim digits per unchanged row.
        const row = ldNormalRow(h3)
        const digit = select(h4.lessThan(0.5), float(0), float(1))
        local.assign(vec3(float(LD_GUTTER).add(digit.mul(0.09)).add(h5.mul(0.06)), ldSlotY(row.z).add(jitter(fract(h4.mul(7.31)), 0.07)), 0))
        col.assign(vec4(c('#48708c'), 0))
      }).Else(() => {
        // The - and + marks ride with their rows.
        const added = h2.greaterThan(0.72)
        const k = floor(h3.mul(5))
        const ch = LD_CHANGED.element(int(k))
        const s = ldState(k, t)
        const gone = select(added, float(1).sub(s), s)
        const y0 = ldSlotY(ch.x).sub(pow(gone, 1.6).mul(ldSlotY(ch.x).add(1.2)))
        const vertical = added.and(h4.lessThan(0.45))
        const mx = float(LD_GUTTER + 0.07)
        const px = select(vertical, mx.add(jitter(h5, 0.035)), mx.add(jitter(h5, 0.15)))
        const py = select(vertical, y0.add(jitter(fract(h4.mul(5.7)), 0.15)), y0.add(jitter(fract(h4.mul(5.7)), 0.035)))
        local.assign(vec3(px, py, sin(gone.mul(PI)).mul(0.4)))
        col.assign(vec4(select(added, c('#6ee7a0'), c('#ff8a8a')), 0.7))
      })
    })
  const center = vec3(0, 2.7, 0)
  P.assign(rotY(rotX(local.sub(center), -0.04), sin(t.mul(0.17)).mul(0.08).sub(0.1)).add(center))
  C.assign(col)
}

// ------------------------------------------------------------------ zen
// An ensō in one stroke: thick and wet where the brush lands, thinning and
// breaking into dry bristle streaks toward the end. It draws itself, holds,
// then runs back into the brush and draws again. Grains not on the paper yet
// wait in the ink at the brush tip. A small red seal sits lower right.
const ZEN_R = 1.85
const ZEN_A0 = -0.36 * Math.PI
const ZEN_SWEEP = 1.86 * Math.PI

function zen(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const ph = fract(t.div(15))
  const drawn = select(ph.lessThan(0.8), smoothstep(0.03, 0.42, ph), float(1).sub(smoothstep(0.84, 0.99, ph)))
  const angleAt = (s: N): N => float(ZEN_A0).sub(s.mul(ZEN_SWEEP))
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  If(h1.lessThan(0.93), () => {
    const across = h3.mul(2).sub(1)
    const bristle = floor(h3.mul(26))
    const dryRaw = smoothstep(0.4, 1, h2)
    // Dry brush: toward the end whole bristles run out of ink. Their grains
    // go back to the wet start of the stroke instead.
    const kept = fh(bristle.add(3.7)).greaterThan(dryRaw.mul(0.82))
    const s = select(kept, h2, h2.mul(0.5))
    If(s.lessThan(drawn), () => {
      const a = angleAt(s)
      // Heavy where the brush lands, thinning out; edges ragged per bristle.
      const width = mix(0.4, 0.05, pow(s, 1.15))
        .add(exp(s.mul(-55)).mul(0.14))
        .add(sin(s.mul(23)).mul(0.014))
      const ragged = fh(floor(s.mul(150)).add(bristle.mul(0.37))).mul(0.3).add(0.82)
      // Not a perfect circle: a hand drew it.
      const r = float(ZEN_R)
        .mul(sin(a.add(0.8)).mul(0.05).add(sin(a.mul(2).add(1.3)).mul(0.025)).add(1))
        .add(across.mul(width).mul(0.5).mul(ragged))
      local.assign(vec3(cos(a).mul(r), sin(a).mul(r), jitter(h4, 0.05).add(cos(a).mul(0.12))))
      const streak = fh(bristle.mul(1.31)).mul(0.35).add(0.65)
      col.assign(vec4(mix(c('#eef3f6'), c('#9bb5c7'), smoothstep(0.4, 1, s).mul(0.55)).mul(streak), 0.05))
    }).Else(() => {
      If(h4.lessThan(0.05), () => {
        // The wet brush tip, where the stroke is being laid down.
        const a = angleAt(drawn)
        const rr = sqrt(h5).mul(0.085)
        const ra = h3.mul(TAU)
        const r0 = float(ZEN_R).mul(sin(a.add(0.8)).mul(0.05).add(sin(a.mul(2).add(1.3)).mul(0.025)).add(1))
        local.assign(vec3(cos(a).mul(r0).add(cos(ra).mul(rr)), sin(a).mul(r0).add(sin(ra).mul(rr)), 0.1))
        col.assign(vec4(c('#ffffff'), 0.7))
      }).Else(() => {
        // Ink not on the paper yet waits under the pool.
        const a = h5.mul(TAU)
        local.assign(vec3(cos(a).mul(0.6), float(-4.2), sin(a).mul(0.6)))
        col.assign(vec4(c('#eef3f6'), 0.05))
      })
    })
  }).Else(() => {
    // The seal: a square of red with a few lines carved out of it.
    const u = h2
    const v = h3
    const carved = abs(u.sub(0.5))
      .lessThan(0.07)
      .and(v.greaterThan(0.2))
      .and(v.lessThan(0.8))
      .or(abs(v.sub(0.36)).lessThan(0.06).and(u.greaterThan(0.2)).and(u.lessThan(0.8)))
      .or(abs(v.sub(0.66)).lessThan(0.06).and(u.greaterThan(0.2)).and(u.lessThan(0.5)))
    const uu = select(carved, select(h4.lessThan(0.5), float(0.05), float(0.95)), u)
    local.assign(vec3(uu.sub(0.5).mul(0.46).add(1.62), v.sub(0.5).mul(0.46).sub(1.58), 0.03))
    col.assign(vec4(c('#e06c75'), 0.32))
  })
  P.assign(rotY(local, sin(t.mul(0.18)).mul(0.22)).add(vec3(0, 2.75, 0)))
  C.assign(col)
}

// ----------------------------------------------------------------- hive
// A honeycomb slab of hexagonal cells. Some cells hold honey that rises and
// falls; bright message grains fly between cells on arcs, each one leaving
// from the cell the last one arrived at; honey drips from the bottom.
const HEX_R = 0.5
const HIVE_CELLS = (() => {
  const w = Math.sqrt(3) * HEX_R
  const out: THREE.Vector4[] = []
  for (let r = -3; r <= 3; r++) {
    for (let q = -4; q <= 4; q++) {
      const x = (q + (r & 1 ? 0.5 : 0)) * w
      const y = r * 1.5 * HEX_R
      if ((x / 2.45) ** 2 + (y / 2.05) ** 2 > 1) continue
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      const rand = n - Math.floor(n)
      out.push(new THREE.Vector4(x, y, (rand - 0.5) * 0.14, rand > 0.35 ? 1 : 0))
    }
  }
  return out
})()
const HIVE = uniformArray(HIVE_CELLS, 'vec4')
const HIVE_BOTTOM = Math.min(...HIVE_CELLS.map((v) => v.y)) - HEX_R
// Drips leave from the lowest row of cells.
const HIVE_DRIPS = HIVE_CELLS.filter((v) => v.y - HEX_R <= HIVE_BOTTOM + 0.01).map((v) => v.x)
const HIVE_Y = 2.75

function hexCorner(k: N): N {
  const a = k.mul(Math.PI / 3).add(Math.PI / 6)
  return vec3(cos(a).mul(HEX_R), sin(a).mul(HEX_R), 0)
}

function hive(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const n = HIVE_CELLS.length
  const cellAt = (h: N): N => HIVE.element(int(floor(h.mul(n))))
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  If(h1.lessThan(0.46), () => {
    // Wax walls: the six faces of each hexagonal prism.
    const cc = cellAt(h2)
    const k = floor(h3.mul(6))
    const p = mix(hexCorner(k), hexCorner(k.add(1)), h4)
    local.assign(vec3(cc.x, cc.y, cc.z).add(vec3(p.x, p.y, mix(-0.28, 0.28, h5))))
    col.assign(vec4(mix(c('#7a5c34'), c('#c9a96e'), h5), select(h5.greaterThan(0.9), float(0.12), float(0.03))))
  })
    .ElseIf(h1.lessThan(0.84), () => {
      // Inside a cell: honey up to its level, dark wax behind the rest.
      const cc = cellAt(h2)
      const k = floor(h3.mul(6))
      const u = h4.toVar()
      const v = h5.toVar()
      If(u.add(v).greaterThan(1), () => {
        u.assign(float(1).sub(u))
        v.assign(float(1).sub(v))
      })
      const p = hexCorner(k).mul(u).add(hexCorner(k.add(1)).mul(v)).mul(0.9)
      const level = sin(t.mul(0.16).add(cc.x.mul(1.3)).add(cc.y.mul(2.1))).mul(0.5).add(0.5).mul(cc.w)
      const honey = cc.w.greaterThan(0.5).and(p.y.lessThan(mix(-HEX_R, HEX_R * 0.95, level)))
      const depth = fract(h1.mul(97.31))
      local.assign(vec3(cc.x, cc.y, cc.z).add(vec3(p.x, p.y, select(honey, mix(-0.24, 0.16, depth), float(-0.27)))))
      col.assign(select(honey, vec4(mix(c('#ff9f1a'), c('#ffc04d'), depth), 0.45), vec4(c('#4a3820'), 0)))
    })
    .ElseIf(h1.lessThan(0.95), () => {
      // Messages. Each one is a chain: it leaves from where it last landed.
      const m = floor(h2.mul(12))
      const period = 2.4
      const tt = t.add(m.mul(0.53)).div(period)
      const e = floor(tt)
      const f = fract(tt)
      const from = HIVE.element(int(floor(fh(m.mul(7.1).add(e.sub(1).mul(1.37))).mul(n))))
      const to = HIVE.element(int(floor(fh(m.mul(7.1).add(e.mul(1.37))).mul(n))))
      const ft = clamp(f.sub(h3.mul(0.12)), 0, 1)
      const ease = smoothstep(0, 1, ft)
      const at = mix(vec3(from.x, from.y, 0.32), vec3(to.x, to.y, 0.32), ease).add(vec3(0, 0, sin(ft.mul(PI)).mul(0.75)))
      local.assign(at.add(vec3(jitter(h4, 0.04), jitter(h5, 0.04), 0)))
      col.assign(vec4(c('#fff3d6'), mix(1, 0.35, h3)))
    })
    .Else(() => {
      // Honey dripping from the bottom cells into the water.
      const d = floor(h2.mul(HIVE_DRIPS.length))
      let dx: N = float(HIVE_DRIPS[0] ?? 0)
      HIVE_DRIPS.forEach((v, i) => {
        if (i > 0) dx = select(d.equal(i), float(v), dx)
      })
      const ph = fract(h3.add(t.mul(0.32)).add(d.mul(0.37)))
      const y0 = float(HIVE_BOTTOM + 0.02)
      const y = y0.sub(ph.mul(ph).mul(y0.add(HIVE_Y + 0.4)))
      local.assign(vec3(dx.add(jitter(h4, 0.03)), y, jitter(h5, 0.03)))
      col.assign(vec4(c('#ffb347'), 0.55))
    })
  P.assign(rotY(local, sin(t.mul(0.2)).mul(0.14).sub(0.08)).add(vec3(0, HIVE_Y, 0)))
  C.assign(col)
}

// ----------------------------------------------------------------- auth
// A padlock. The shackle lifts, swings open around its left leg, holds,
// swings back and drops in. The keyhole lights while it's open. A thin ring
// of session grains orbits the whole thing.
function roundedBox(a: N, b: N, d: N, size: N, r: number): N {
  const p = boxSurface(a, b, d, size)
  const inner = size.mul(0.5).sub(r)
  const q = clamp(p, inner.negate(), inner)
  return q.add(normalize(p.sub(q).add(vec3(0, 0, 0.00001))).mul(r))
}

const LOCK = { y: 1.95, w: 2.3, h: 1.9, d: 0.75, leg: 0.72, legTop: 3.5, legBottom: 2.45, tube: 0.14 }

function auth(x: FormCtx, P: N, C: N) {
  const { h1, h2, h3, h4, h5, t } = x
  const ph = fract(t.div(10))
  const lift = smoothstep(0.1, 0.24, ph).sub(smoothstep(0.78, 0.92, ph))
  const swing = smoothstep(0.26, 0.4, ph).sub(smoothstep(0.62, 0.76, ph))
  const open = max(lift.mul(0.6), swing)
  const local = vec3(0).toVar()
  const col = vec4(0).toVar()
  If(h1.lessThan(0.5), () => {
    const p = roundedBox(h2, h3, h4, vec3(LOCK.w, LOCK.h, LOCK.d), 0.22)
    local.assign(p.add(vec3(0, LOCK.y, 0)))
    col.assign(vec4(mix(c('#4f8f80'), c('#6fb1a0'), h5), 0.04))
  })
    .ElseIf(h1.lessThan(0.76), () => {
      // The shackle: left leg, half circle, right leg, as one tube.
      const leg = LOCK.legTop - LOCK.legBottom
      const arc = Math.PI * LOCK.leg
      const s = h2.mul(2 * leg + arc)
      const centre = vec3(0).toVar()
      const normal = vec3(1, 0, 0).toVar()
      If(s.lessThan(leg), () => {
        centre.assign(vec3(-LOCK.leg, s.add(LOCK.legBottom), 0))
      })
        .ElseIf(s.lessThan(leg + arc), () => {
          const th = float(Math.PI).sub(s.sub(leg).div(LOCK.leg))
          centre.assign(vec3(cos(th).mul(LOCK.leg), sin(th).mul(LOCK.leg).add(LOCK.legTop), 0))
          normal.assign(vec3(cos(th), sin(th), 0))
        })
        .Else(() => {
          centre.assign(vec3(LOCK.leg, float(LOCK.legTop).sub(s.sub(leg + arc)), 0))
        })
      const phi = h3.mul(TAU)
      const p = centre.add(normal.mul(cos(phi).mul(LOCK.tube))).add(vec3(0, 0, sin(phi).mul(LOCK.tube)))
      const lifted = p.add(vec3(0, lift.mul(0.62), 0))
      const pivot = vec3(-LOCK.leg, 0, 0)
      local.assign(rotY(lifted.sub(pivot), swing.mul(-1.25)).add(pivot))
      col.assign(vec4(mix(c('#9fb4c2'), c('#dfe9ef'), pow(sin(phi.add(0.6)).mul(0.5).add(0.5), 3)), 0.1))
    })
    .ElseIf(h1.lessThan(0.83), () => {
      // Keyhole on the front face: a round head over a tapering slot.
      const head = vec3(cos(h4.mul(TAU)).mul(sqrt(h3).mul(0.17)), sin(h4.mul(TAU)).mul(sqrt(h3).mul(0.17)).add(2.12), 0)
      const sy = mix(1.55, 2.05, h3)
      const slot = vec3(h4.mul(2).sub(1).mul(mix(0.12, 0.06, h3)), sy, 0)
      const p = select(h2.lessThan(0.45), head, slot)
      local.assign(vec3(p.x, p.y, LOCK.d / 2 + 0.012))
      col.assign(vec4(mix(c('#06161b'), c('#b5d98c'), open), open.mul(0.95)))
    })
    .Else(() => {
      // Sessions: a dashed ring orbiting the lock.
      const a = h2.mul(TAU).add(t.mul(0.4))
      const ring = vec3(cos(a).mul(2.45), jitter(h3, 0.03), sin(a).mul(0.62))
      const dash = smoothstep(0.1, 0.7, sin(a.mul(14).sub(t.mul(2))))
      local.assign(rotX(ring, 0.3).add(vec3(jitter(h4, 0.03), 2.4, jitter(h5, 0.03))))
      col.assign(vec4(c('#6fb1a0'), dash.mul(0.5).add(0.12)))
    })
  const centre = vec3(0, 2.4, 0)
  P.assign(rotY(local.sub(centre), sin(t.mul(0.21)).mul(0.18).sub(0.12)).add(centre))
  C.assign(col)
}

// ----------------------------------------------------------------- name
// The home view: the grains spell the name, sampled from the page's own
// monospace font (see particles.ts). A slow band of light moves through it.
function nameForm(x: FormCtx, P: N, C: N) {
  const { t, name } = x
  const band = fract(t.mul(0.085)).mul(1.7).sub(0.35)
  const d = name.w.sub(band).mul(6)
  const shine = exp(d.mul(d).negate())
  const wave = sin(name.w.mul(7).add(t.mul(0.7))).mul(0.035)
  P.assign(rotY(vec3(name.x, name.y, name.z.add(wave)), sin(t.mul(0.13)).mul(0.22)).add(vec3(0, 2.75, 0)))
  C.assign(vec4(mix(c('#a9c4d6'), c('#e6f7ff'), shine), shine.mul(0.6).add(0.12)))
}

type Builder = (x: FormCtx, P: N, C: N) => void
const BY_ID: Record<FormId, Builder> = {
  lazydiff,
  glass,
  zen,
  hive,
  auth,
  sluice,
  eddy,
  watchglass,
  quilt,
  loom,
}
const BUILDERS: Builder[] = [...FORM_ORDER.map((id) => BY_ID[id]), nameForm, submerged]

/** Emit the If-chain that evaluates the form selected by `form` (an int uniform). */
export function evalForm(form: N, x: FormCtx, P: N, C: N) {
  let chain: N = If(form.equal(0), () => BUILDERS[0]!(x, P, C))
  for (let i = 1; i < BUILDERS.length - 1; i++) {
    chain = chain.ElseIf(form.equal(i), () => BUILDERS[i]!(x, P, C))
  }
  chain.Else(() => BUILDERS[BUILDERS.length - 1]!(x, P, C))
}

/** Where on the water each form drops things, for ripple rings. x/z, plus a rate in drops per second. */
export interface Splash {
  x: [number, number]
  z: [number, number]
  rate: number
  amp: number
}

export const SPLASHES: Record<number, Splash[]> = {
  [formIndex('eddy')]: [{ x: [-0.6, 0.6], z: [-0.6, 0.6], rate: 2.5, amp: 0.5 }],
  [formIndex('sluice')]: [{ x: [-1.5, 1.5], z: [0.55, 0.8], rate: 7, amp: 0.55 }],
  [formIndex('hive')]: HIVE_DRIPS.map((dx) => ({ x: [dx - 0.05, dx + 0.05] as [number, number], z: [-0.05, 0.05] as [number, number], rate: 0.9, amp: 0.3 })),
}

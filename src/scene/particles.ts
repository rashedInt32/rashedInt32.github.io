// The particles. One compute pass per frame moves every grain:
//
//   position = target(form A → form B) + offset
//
// The target comes straight from the form math, so flowing shapes (the sluice
// sheet, the hourglass sand) are tracked with no lag. The offset is a damped
// spring that carries everything organic: the cloud a shape dissolves into
// between forms, the push from the pointer, and the settle afterwards.

import * as THREE from 'three/webgpu'
import {
  Fn,
  PI,
  If,
  cameraPosition,
  dot,
  float,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  mix,
  mx_noise_vec3,
  normalize,
  pow,
  reflect,
  saturate,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from './tsl'
import { SUBMERGED, evalForm, type FormCtx } from './forms'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export interface ParticleUniforms {
  time: N
  dt: N
  formA: N
  formB: N
  morph: N
  lightsUp: N
  pointerOrigin: N
  pointerDir: N
  pointerOn: N
  keyDir: N
}

export function createParticles(count: number, alphaToCoverage: boolean, stateless = false) {
  const u: ParticleUniforms = {
    time: uniform(0),
    dt: uniform(1 / 60),
    formA: uniform(SUBMERGED, 'int'),
    formB: uniform(SUBMERGED, 'int'),
    morph: uniform(1),
    lightsUp: uniform(0),
    pointerOrigin: uniform(new THREE.Vector3()),
    pointerDir: uniform(new THREE.Vector3(0, 0, -1)),
    pointerOn: uniform(0),
    keyDir: uniform(new THREE.Vector3(-0.25, 1, -0.1).normalize()),
  }

  const pos = instancedArray(count, 'vec4') // xyz, w unused
  const name = instancedArray(count, 'vec4') // home view: local xyz, w = 0..1 across the text
  fillName(name.value as THREE.StorageInstancedBufferAttribute, count)
  const off = instancedArray(count, 'vec4') // spring offset xyz
  const vel = instancedArray(count, 'vec4') // offset velocity xyz
  const col = instancedArray(count, 'vec4') // rgb, w = glow

  const seeds = (): FormCtx & { h6: N } => {
    const i = float(instanceIndex)
    return {
      h1: hash(i),
      h2: hash(i.add(7919)),
      h3: hash(i.add(104729)),
      h4: hash(i.add(1299709)),
      h5: hash(i.add(15485863)),
      // Offsets stay under 2^24 - count: past that, float32 can't tell
      // neighbouring indices apart and grains would share seeds.
      h6: hash(i.add(5000011)),
      t: u.time,
      name: name.element(instanceIndex),
    }
  }

  const init = Fn(() => {
    const s = seeds()
    const P = vec3(0).toVar()
    const C = vec4(0).toVar()
    evalForm(u.formB, s, P, C)
    pos.element(instanceIndex).assign(vec4(P, 1))
    off.element(instanceIndex).assign(vec4(0))
    vel.element(instanceIndex).assign(vec4(0))
    col.element(instanceIndex).assign(C)
  })().compute(count)

  // WebGL2 records compute output through transform feedback, which is only
  // guaranteed four separate outputs; the stateless path keeps no springs,
  // so its init writes position and color only.
  const initStateless = Fn(() => {
    const s = seeds()
    const P = vec3(0).toVar()
    const C = vec4(0).toVar()
    evalForm(u.formB, s, P, C)
    pos.element(instanceIndex).assign(vec4(P, 1))
    col.element(instanceIndex).assign(C)
  })().compute(count)

  const update = Fn(() => {
    const s = seeds()
    const dt = u.dt
    const tA = vec3(0).toVar()
    const cA = vec4(0).toVar()
    const tB = vec3(0).toVar()
    const cB = vec4(0).toVar()
    evalForm(u.formB, s, tB, cB)
    // At rest both ends of the morph are the same form: evaluate it once.
    If(u.morph.lessThan(1), () => {
      evalForm(u.formA, s, tA, cA)
    }).Else(() => {
      tA.assign(tB)
      cA.assign(cB)
    })

    // Each grain leaves on its own schedule, so the shape peels apart
    // instead of moving as one block.
    const stagger = float(0.55)
    const p = saturate(u.morph.mul(stagger.add(1)).sub(s.h6.mul(stagger)))
    const blend = smoothstep(0.3, 0.85, p)
    const transit = sin(p.mul(PI)) // 0 at rest, 1 mid-flight
    const target = mix(tA, tB, blend)

    const O = off.element(instanceIndex)
    const V = vel.element(instanceIndex)
    const o = O.xyz.toVar()
    const v = V.xyz.toVar()

    // Spring back to the shape. Stiff at rest, loose mid-flight.
    const k = mix(float(26), float(2.2), transit)
    const acc = o.mul(k.negate()).sub(v.mul(sqrt(k).mul(1.7))).toVar()

    If(transit.greaterThan(0.002), () => {
      // Dissolve: burst out into a cloud, drift on noise, rise a little.
      const dir = normalize(vec3(s.h3.sub(0.5), s.h4.sub(0.5), s.h5.sub(0.5)).add(0.0001))
      const burst = dir.mul(s.h1.mul(1.4).add(0.6)).mul(transit).mul(3.2)
      const swirl = mx_noise_vec3(target.add(o).mul(0.45).add(vec3(0, u.time.mul(0.2), 0))).mul(5.5)
      acc.addAssign(burst.add(swirl.mul(transit)).add(vec3(0, 1.4, 0).mul(transit)))
    })

    // The pointer is a ray from the camera. Grains near it get pushed off it.
    If(u.pointerOn.greaterThan(0.001), () => {
      const rel = target.add(o).sub(u.pointerOrigin)
      const along = dot(rel, u.pointerDir)
      const perp = rel.sub(u.pointerDir.mul(along))
      const d = length(perp)
      const radius = float(0.85)
      If(d.lessThan(radius), () => {
        const f = pow(float(1).sub(d.div(radius)), 2).mul(34).mul(u.pointerOn)
        acc.addAssign(perp.div(max(d, 0.001)).mul(f))
      })
    })

    v.addAssign(acc.mul(dt))
    o.addAssign(v.mul(dt))
    O.assign(vec4(o, 0))
    V.assign(vec4(v, 0))
    pos.element(instanceIndex).assign(vec4(target.add(o), 1))

    const C = col.element(instanceIndex)
    C.assign(mix(C, mix(cA, cB, blend), saturate(dt.mul(5))))
  })().compute(count)

  // WebGL2 runs compute through transform feedback, where a pass that reads
  // and rewrites its own state doesn't hold. This version keeps no state:
  // the cloud and the pointer push are computed fresh each frame.
  const updateStateless = Fn(() => {
    const s = seeds()
    const tA = vec3(0).toVar()
    const cA = vec4(0).toVar()
    const tB = vec3(0).toVar()
    const cB = vec4(0).toVar()
    evalForm(u.formB, s, tB, cB)
    If(u.morph.lessThan(1), () => {
      evalForm(u.formA, s, tA, cA)
    }).Else(() => {
      tA.assign(tB)
      cA.assign(cB)
    })
    const stagger = float(0.55)
    const p = saturate(u.morph.mul(stagger.add(1)).sub(s.h6.mul(stagger)))
    const blend = smoothstep(0.3, 0.85, p)
    const transit = sin(p.mul(PI))
    const target = mix(tA, tB, blend)
    const dir = normalize(vec3(s.h3.sub(0.5), s.h4.sub(0.5), s.h5.sub(0.5)).add(0.0001))
    const cloud = dir
      .mul(s.h1.mul(1.4).add(0.6))
      .mul(1.3)
      .add(mx_noise_vec3(target.mul(0.45).add(vec3(0, u.time.mul(0.2), 0))).mul(0.9))
      .add(vec3(0, 0.6, 0))
      .mul(transit)
    const at = target.add(cloud).toVar()
    If(u.pointerOn.greaterThan(0.001), () => {
      const rel = at.sub(u.pointerOrigin)
      const perp = rel.sub(u.pointerDir.mul(dot(rel, u.pointerDir)))
      const d = length(perp)
      If(d.lessThan(0.85), () => {
        at.addAssign(perp.div(max(d, 0.001)).mul(pow(float(1).sub(d.div(0.85)), 2).mul(0.4).mul(u.pointerOn)))
      })
    })
    pos.element(instanceIndex).assign(vec4(at, 1))
    col.element(instanceIndex).assign(mix(cA, cB, blend))
  })().compute(count)

  // ------------------------------------------------------------- render
  const material = new THREE.SpriteNodeMaterial()
  const P = pos.toAttribute().xyz
  const Cv = col.toAttribute()
  const seed = hash(float(instanceIndex).add(15485863))
  const twinkleSeed = hash(float(instanceIndex).add(7000003))
  const glow = Cv.w

  material.positionNode = P
  material.scaleNode = float(0.03).mul(seed.mul(0.5).add(0.75)).mul(glow.mul(0.3).add(1))

  // Shading is per grain, so it happens in the vertex stage and rides a varying.
  const shade = Fn(() => {
    // Light from the opening in the ceiling. The grain's normal is faked as
    // pointing out from the middle of the form, which reads as volume.
    const n = normalize(P.sub(vec3(0, 2.6, 0)).add(vec3(0, 0, 0.0001)))
    const lambert = dot(n, u.keyDir).mul(0.5).add(0.5)
    const facing = dot(n, normalize(cameraPosition.sub(P))).mul(0.25).add(0.75)
    // Grains on the far side of the form sit in its own shadow: up to 55%
    // darker the deeper they are behind its middle, seen from the camera.
    const toEye = normalize(cameraPosition.sub(vec3(0, 2.6, 0)))
    const behind = dot(P.sub(vec3(0, 2.6, 0)), toEye).negate()
    const occluded = float(1).sub(smoothstep(-0.3, 1.4, behind).mul(0.55))
    // The halo above lights the tops.
    const fromRing = max(n.y, 0).mul(0.18)
    const lit = pow(lambert, 1.6).mul(0.85).add(0.12).add(fromRing).mul(facing).mul(occluded)
    // A few grains catch the light and flash.
    const tw = sin(u.time.mul(twinkleSeed.mul(2).add(0.6)).add(twinkleSeed.mul(40)))
    // Glints are rare and follow the light: a grain flashes only when its
    // facet would mirror the opening toward the camera.
    const toCam = normalize(cameraPosition.sub(P))
    const mirrorDir = reflect(toCam.negate(), n)
    const align = pow(max(dot(mirrorDir, u.keyDir), 0), 24)
    const glint = pow(saturate(tw), 40).mul(smoothstep(0.985, 1, twinkleSeed)).mul(align.mul(3).add(0.15)).mul(4)
    const emissive = glow.mul(glow).mul(2.6)
    const base = Cv.xyz.mul(lit.add(emissive)).add(vec3(glint))
    return base.mul(u.lightsUp.mul(0.94).add(0.06))
  })
  const vColor = varying(shade())

  const disc = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2)
    const bead = sqrt(saturate(float(1).sub(d.mul(d)))).mul(0.35).add(0.65)
    return vec4(vColor.mul(bead), smoothstep(1, 0.7, d))
  })
  material.colorNode = disc()
  if (alphaToCoverage) {
    material.alphaToCoverage = true
    material.transparent = false
  } else {
    material.alphaTest = 0.5
  }
  material.depthWrite = true

  const sprite = new THREE.Sprite(material)
  sprite.count = count
  sprite.frustumCulled = false

  return { sprite, init: stateless ? initStateless : init, update: stateless ? updateStateless : update, uniforms: u, count }
}

export type Particles = ReturnType<typeof createParticles>

// ------------------------------------------------------------------ name
// The home view spells the name in grains. Glyph pixels are sampled from a
// 2D canvas in the page's own monospace font, one target per particle, with
// sub-pixel jitter so the strokes read solid. The first fill uses whatever
// the font stack gives right now; once JetBrains Mono has loaded it fills
// again, and the GPU buffer is re-uploaded.
const NAME_LINES = ['rashed', 'parvez']
const NAME_FONT = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace'
const NAME_WIDTH = 5.5

function fillName(attr: THREE.StorageInstancedBufferAttribute, count: number) {
  const write = () => {
    sampleName(attr.array as Float32Array, count)
    attr.needsUpdate = true
  }
  write()
  document.fonts
    ?.load(`500 200px "JetBrains Mono Variable"`)
    .then((faces) => {
      if (faces.length > 0) write()
    })
    .catch(() => {})
}

function sampleName(out: Float32Array, count: number) {
  const W = 1400
  const H = 660
  const size = 250
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.font = `500 ${size}px ${NAME_FONT}`
  NAME_LINES.forEach((line, i) => g.fillText(line, W / 2, 300 + i * 270))
  const data = g.getImageData(0, 0, W, H).data
  const lit: number[] = []
  let minX = W
  let maxX = 0
  let minY = H
  let maxY = 0
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (data[(y * W + x) * 4 + 3]! > 140) {
        lit.push(x, y)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const n = lit.length / 2
  if (n === 0) return
  const scale = NAME_WIDTH / Math.max(1, maxX - minX)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  // A small deterministic PRNG, so the layout is the same on every load.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const k = Math.floor(rand() * n) * 2
    const px = lit[k]! + rand()
    const py = lit[k + 1]! + rand()
    out[i * 4] = (px - cx) * scale
    out[i * 4 + 1] = -(py - cy) * scale
    // Letters 45 cm deep: a volume, not a sign. Grains fill it, so the
    // sides show as the name turns.
    out[i * 4 + 2] = (rand() - 0.5) * 0.45
    out[i * 4 + 3] = (px - minX) / Math.max(1, maxX - minX)
  }
}

/** Unit vector from the pointer ray, reused by the water. */
export function rayFrom(camera: THREE.PerspectiveCamera, ndc: THREE.Vector2, outOrigin: THREE.Vector3, outDir: THREE.Vector3) {
  outOrigin.setFromMatrixPosition(camera.matrixWorld)
  outDir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(outOrigin).normalize()
}


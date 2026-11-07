// Static detail is computed once, at load, into textures. Every frame after
// that reads a texel instead of evaluating noise. This is most of why the
// room can look busy and still cost little.

import * as THREE from 'three/webgpu'
import { Fn, abs, clamp, dot, exp, float, floor, fract, hash, length, max, min, mix, mx_noise_float, smoothstep, uv, vec2, vec3, vec4 } from './tsl'
import { COPING, FLOOR_MAP, PILLAR_SIZE, PILLAR_X, PILLAR_Z, POOL_HALF, PUDDLES, WALL } from './layout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

interface BakeOptions {
  mipmaps?: boolean
  repeat?: boolean
}

export function bake(renderer: THREE.WebGPURenderer, size: number, node: N, opts: BakeOptions = {}): THREE.Texture {
  const rt = new THREE.RenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: !!opts.mipmaps,
    minFilter: opts.mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })
  const wrap = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  rt.texture.wrapS = wrap
  rt.texture.wrapT = wrap
  rt.texture.anisotropy = 8
  const material = new THREE.MeshBasicNodeMaterial()
  material.fragmentNode = node
  const quad = new THREE.QuadMesh(material)
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(rt)
  quad.render(renderer)
  renderer.setRenderTarget(prev)
  material.dispose()
  return rt.texture
}

/** Fractal noise, `octaves` deep, roughly in -1..1. */
function fbm(p: N, octaves: number): N {
  let sum: N = float(0)
  let amp = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum = sum.add(mx_noise_float(p.mul(f).add(i * 17.3)).mul(amp))
    amp *= 0.5
    f *= 2.03
  }
  return sum
}

/** Signed distance to an axis-aligned box of half-size `b` centered at 0, in 2D. */
function sdBox2(p: N, b: number): N {
  const d = abs(p).sub(b)
  return length(max(d, 0)).add(min(max(d.x, d.y), 0))
}

/**
 * A noise function made seamless over a `period` x `period` tile by
 * blending four shifted copies. `f` takes a vec2 in tile meters.
 */
function tileable(f: (p: N) => N, p: N, period: number): N {
  const t = p.div(period)
  const a = f(p)
  const b = f(p.sub(vec2(period, 0)))
  const c = f(p.sub(vec2(0, period)))
  const d = f(p.sub(vec2(period, period)))
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y)
}

/**
 * The floor, world-mapped over FLOOR_MAP.
 * r: concrete tone, g: wetness (1 = standing water), b: ambient occlusion, a: slab seam.
 */
export function floorMaps(): N {
  return Fn(() => {
    const q = uv()
    const p = vec2(q.x.mul(FLOOR_MAP.size).add(FLOOR_MAP.x0), q.y.mul(FLOOR_MAP.size).add(FLOOR_MAP.z0))

    // Poured slabs, 2 m, seams on the pool's edges.
    const cell = floor(p.div(2))
    const f = fract(p.div(2))
    const toSeam = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(2)
    const seam = float(1).sub(smoothstep(0.003, 0.011, toSeam))
    const slab = hash(cell.x.mul(31).add(cell.y.mul(7)).add(1000))
    const stains = fbm(vec3(p.mul(0.32), 1.7), 5)
    const trowel = mx_noise_float(vec3(p.x.mul(0.9), p.y.mul(3.2), 4.1)).mul(0.06)
    const tone = float(0.5).add(slab.sub(0.5).mul(0.22)).add(stains.mul(0.42)).add(trowel)

    // Wet: a damp field, noise puddles, placed puddles, the splash zone
    // around the pool, and water sitting in the seams.
    // After rain: most of the ground is damp and glossy, standing water
    // collects in the low spots, and only scattered patches have dried.
    const dry = smoothstep(0.12, 0.3, fbm(vec3(p.mul(0.09), 7.3), 4))
    const damp = mix(float(0.62), float(0.06), dry)
    const noisePuddles = smoothstep(0.16, 0.2, fbm(vec3(p.mul(0.17), 19.1), 4))
    let placed: N = float(0)
    for (const [px, pz, r] of PUDDLES) {
      const edge = fbm(vec3(p.mul(0.85), px * 3.1 + pz), 3).mul(r * 0.55)
      const d = length(p.sub(vec2(px, pz))).add(edge)
      placed = max(placed, smoothstep(r, r * 0.78, d))
    }
    const poolOut = sdBox2(p, POOL_HALF + COPING)
    const splash = smoothstep(1.1, 0.0, poolOut).mul(0.7)
    const wet = max(max(max(damp, noisePuddles), max(placed, splash)), seam.mul(0.55))

    // Contact darkening at pillar feet and along the walls.
    let ao: N = float(1)
    for (const x of PILLAR_X) {
      for (const z of PILLAR_Z) {
        const d = sdBox2(p.sub(vec2(x, z)), PILLAR_SIZE / 2)
        ao = ao.mul(float(1).sub(exp(d.mul(-3.2)).mul(0.55)))
      }
    }
    const toSide = float(WALL.x).sub(abs(p.x))
    const toBack = p.y.sub(WALL.back)
    ao = ao.mul(float(1).sub(exp(toSide.mul(-1.6)).mul(0.5))).mul(float(1).sub(exp(toBack.mul(-1.6)).mul(0.5)))

    return vec4(tone, wet, ao, seam)
  })()
}

/**
 * Board-formed concrete for walls, pillars and ceiling: an 8 m seamless tile.
 * r: tone, g: board seam, b: tie hole, a: vertical grime streaks.
 */
export function wallMaps(): N {
  return Fn(() => {
    const p = uv().mul(8)
    const tone = tileable((x) => fbm(vec3(x.mul(0.45), 2.2), 5), p, 8).mul(0.5).add(0.5)
    const board = floor(p.y.div(0.5))
    const boardTone = hash(board.add(77)).sub(0.5).mul(0.12)
    const seam = float(1).sub(smoothstep(0.003, 0.009, abs(fract(p.y.div(0.5)).sub(0.5)).mul(-0.5).add(0.25)))
    const holeAt = vec2(fract(p.x.div(1.0)).sub(0.5), fract(p.y.div(0.5).add(0.5)).sub(0.5).mul(0.5))
    const hole = float(1).sub(smoothstep(0.012, 0.02, length(holeAt)))
    const streak = tileable((x) => mx_noise_float(vec3(x.x.mul(2.6), x.y.mul(0.14), 5.5)), p, 8).mul(0.5).add(0.5)
    return vec4(tone.add(boardTone), seam, hole, streak)
  })()
}

/**
 * Small seamless noise for animated effects (caustics, mist) and fine floor
 * grain. Sampled with repeat. r/g: two scales of smooth noise, b: speckle,
 * a: medium noise.
 */
export function detailMaps(): N {
  return Fn(() => {
    const p = uv()
    const a = tileable((x) => mx_noise_float(vec3(x.mul(6), 1.3)), p, 1).mul(0.5).add(0.5)
    const b = tileable((x) => mx_noise_float(vec3(x.mul(14), 8.1)), p, 1).mul(0.5).add(0.5)
    const texel = floor(p.mul(512))
    const speck = hash(texel.x.add(texel.y.mul(512)))
    const c = tileable((x) => fbm(vec3(x.mul(3), 4.4), 3), p, 1).mul(0.5).add(0.5)
    return vec4(a, b, speck, c)
  })()
}

/**
 * Shadows the pillars cast on the floor from the form's light, which hangs
 * over the middle of the pool and is about two meters across, so the
 * penumbra widens with distance behind each pillar. r: 1 lit, 0 in shadow.
 */
export function shadowMaps(): N {
  return Fn(() => {
    const q = uv()
    const p = vec2(q.x.mul(FLOOR_MAP.size).add(FLOOR_MAP.x0), q.y.mul(FLOOR_MAP.size).add(FLOOR_MAP.z0))
    const toLight = vec2(0, 0).sub(p)
    const len = max(length(toLight), 0.001)
    const dir = toLight.div(len)
    let lit: N = float(1)
    for (const x of PILLAR_X) {
      for (const z of PILLAR_Z) {
        const c = vec2(x, z).sub(p)
        // How far along the way to the light the pillar sits, and how far off the line.
        const along = clamp(dot(c, dir), 0, len)
        const off = length(c.sub(dir.mul(along)))
        const between = smoothstep(0.2, 0.9, along).mul(smoothstep(len, len.sub(1.2), along))
        const behind = along
        const penumbra = behind.mul(0.09).add(0.06)
        const d = off.sub(PILLAR_SIZE * 0.62)
        const shade = float(1).sub(smoothstep(penumbra, penumbra.negate(), d).mul(between).mul(0.85))
        lit = lit.mul(shade)
      }
    }
    return vec4(lit, 0, 0, 1)
  })()
}

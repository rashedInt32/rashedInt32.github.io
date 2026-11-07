// The floor: poured concrete slabs, wet in places, with a flush pool under
// the forms. One mesh, one material, three behaviours:
//
//   pool and puddles  sharp mirror, ripples, almost black where nothing reflects
//   damp concrete     darker, glossy, a blurred reflection (mip level from roughness)
//   dry concrete      matte, lit by the room, only a faint sheen at grazing angles
//
// The reflection is one extra render of the scene from below at a fraction of
// the resolution, with mipmaps so rough areas can read a blurrier level.

import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  abs,
  cameraPosition,
  color,
  cos,
  distance,
  dot,
  exp,
  floor,
  fract,
  fwidth,
  hash,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  reflector,
  saturate,
  select,
  sin,
  smoothstep,
  texture,
  uniformArray,
  vec2,
  vec3,
} from './tsl'
import { COPING, FLOOR_MAP, KEY_DIR, MOON_COLOR, POOL_HALF, SHAFTS } from './layout'
import { ALBEDO_MATCH, FLOOR_BAKE, bakedLight } from './hall'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export const RIPPLES = 16
// ?floor=wet|tone|ao|rough paints that channel instead of the floor, for tuning.
const DEBUG = new URLSearchParams(location.search).get('floor')

export interface FloorShared {
  time: N
  lightsUp: N
  accent: N
  formGlow: N
  cursor: N
}

export interface FloorOptions {
  reflectScale: number
  /** Second noise octave on the water. Off on low tiers. */
  detail: boolean
  floorMap: THREE.Texture
  detailMap: THREE.Texture
  /** Pillar shadows from the form's light, r: 1 lit. Only for the analytic light. */
  shadowMap?: THREE.Texture
  light: (p: N, n: N, shadow: N) => N
  /**
   * The hall's haze, applied here instead of by scene fog: the mirror pass
   * already hazes each reflection over its whole path, so fog on the floor
   * would haze reflections twice. Only the floor's own light gets this.
   */
  haze?: { color: N; density: number }
  /** Baked light from the Blender hall (hall.ts). Replaces `light` and the map's occlusion. */
  baked?: {
    still: THREE.Texture
    form: THREE.Texture
    /** The halo's and the pointer's light. */
    live: (p: N, n: N) => N
  }
}

export function createFloor(shared: FloorShared, opts: FloorOptions) {
  const reflection = reflector({ resolutionScale: opts.reflectScale, generateMipmaps: true, samples: 4 })
  reflection.target.rotateX(-Math.PI / 2)

  const sources = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -1000, 0))
  const ripples = uniformArray(sources, 'vec4') // x, z, start time, amplitude
  let next = 0

  const { time, lightsUp, accent } = shared

  // The water's surface slope, computed directly. The slow swell is an
  // analytic sine; the fine chop reads the baked noise texture (cheap) with a
  // small finite difference; each ripple ring adds its own slope in a single
  // pass. No live noise, one loop.
  const chop = (xz: N, near: N): N => {
    const t = time
    // Explicit mip level: this runs inside a branch, where WGSL forbids
    // implicit-LOD sampling (Chrome relaxes the rule; other browsers don't).
    const a = texture(opts.detailMap, xz.mul(0.35).add(vec2(t.mul(0.012), t.mul(0.007)))).level(0).x.mul(0.014)
    const b = opts.detail ? texture(opts.detailMap, xz.mul(1.1).sub(vec2(t.mul(0.02), t.mul(0.01)))).level(0).y.mul(0.005).mul(near) : float(0)
    return a.add(b)
  }
  const waterNormal = Fn(([xz]: [N]) => {
    const t = time
    const near = smoothstep(26, 5, distance(xz, cameraPosition.xz))
    const ax = xz.x.mul(0.7).add(t.mul(0.6))
    const bz = xz.y.mul(0.5).sub(t.mul(0.4))
    const g = vec2(cos(ax).mul(sin(bz)).mul(0.7 * 0.012), sin(ax).mul(cos(bz)).mul(0.5 * 0.012)).toVar()
    const e = 0.03
    const h0 = chop(xz, near)
    g.addAssign(vec2(chop(xz.add(vec2(e, 0)), near).sub(h0), chop(xz.add(vec2(0, e)), near).sub(h0)).div(e))
    Loop(RIPPLES, ({ i }: { i: N }) => {
      const r = ripples.element(i)
      const age = t.sub(r.z)
      // Rings older than ~4.5 s have faded below a pixel's worth: skip them.
      If(age.greaterThan(0).and(age.lessThan(4.5)), () => {
        const rel = xz.sub(r.xy)
        const d = max(length(rel), 0.001)
        const x = d.sub(age.mul(0.95))
        const env = exp(x.mul(x).mul(-6)).mul(exp(age.mul(-1.15))).mul(r.w).div(d.mul(1.6).add(1))
        // d/dd of sin(17x)·env, keeping the dominant term.
        const slope = cos(x.mul(17)).mul(17).mul(env).mul(0.05)
        g.addAssign(rel.div(d).mul(slope))
      })
    })
    return normalize(vec3(g.x.negate(), 1, g.y.negate()))
  })

  const shaftFeet = Fn(([xz]: [N]) => {
    const total = float(0).toVar()
    for (const s of SHAFTS) {
      const d = length(xz.sub(vec2(s.foot.x, s.foot.z)))
      total.addAssign(smoothstep(s.radius * 1.6, s.radius * 0.2, d).mul(s.strength))
    }
    return total
  })

  const material = new THREE.MeshBasicNodeMaterial()
  // With `haze` the floor hazes itself (see FloorOptions.haze).
  material.fog = !opts.haze
  const baseUV = reflection.uvNode
  material.colorNode = Fn(() => {
    const p = positionWorld
    const xz = p.xz
    const mapUV = vec2(xz.x.sub(FLOOR_MAP.x0).div(FLOOR_MAP.size), xz.y.sub(FLOOR_MAP.z0).div(FLOOR_MAP.size))
    const m = texture(opts.floorMap, mapUV) // tone, wet, ao, seam
    const formShadow = opts.shadowMap ? texture(opts.shadowMap, mapUV).x : float(1)
    // Baked light is read here, outside the branches below: WGSL only
    // samples textures in uniform control flow.
    const baked = opts.baked
    const bakedUV = vec2(xz.x.sub(FLOOR_BAKE.x0).div(FLOOR_BAKE.x1 - FLOOR_BAKE.x0), xz.y.sub(FLOOR_BAKE.z0).div(FLOOR_BAKE.z1 - FLOOR_BAKE.z0))
    const lightFromBake = baked
      ? bakedLight(shared, texture(baked.still, bakedUV).rgb, texture(baked.form, bakedUV).x).mul(ALBEDO_MATCH)
      : null
    const lightAt = (n: N): N => (baked ? lightFromBake.add(baked.live(p, n)) : opts.light(p, n, formShadow))
    // Fine grain repeats every meter, so each 2 m slab turns and shifts its
    // copy: neighbouring slabs never show the same pattern.
    const slab = floor(xz.div(2))
    const turn = hash(slab.x.mul(17).add(slab.y.mul(131)).add(5))
    const shift = vec2(hash(slab.x.add(slab.y.mul(57)).add(11)), hash(slab.y.add(slab.x.mul(23)).add(29)))
    const grainUV = select(turn.greaterThan(0.5), xz, vec2(xz.y, xz.x.negate())).add(shift)
    const grain = texture(opts.detailMap, grainUV).toVar()
    const grain2 = texture(opts.detailMap, xz.mul(0.31).add(0.37))

    // Slab seams drawn here, antialiased to the pixel, not baked. Computed
    // before any branch: derivatives need every pixel in the quad to run them.
    const f = fract(xz.div(2))
    const toSeam = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(2)
    const aa = max(fwidth(toSeam), 0.0005)
    const seam = float(1).sub(smoothstep(float(0.005).sub(aa), float(0.005).add(aa), toSeam)).toVar()

    // Pool: signed distance to its rim, negative inside.
    const q = abs(xz).sub(POOL_HALF)
    const poolD = length(max(q, 0)).add(min(max(q.x, q.y), 0))
    // How much of the pixel is water, and how much is water or stone: the
    // rim and the coping's edge blend over one pixel instead of stepping.
    // Computed before any branch (fwidth needs the whole pixel quad).
    const rimAA = max(fwidth(poolD), 0.0005)
    const inWater = smoothstep(rimAA, rimAA.negate(), poolD)
    const onStone = smoothstep(rimAA.add(COPING), rimAA.negate().add(COPING), poolD)

    const wet = mix(mix(m.y, float(0.08), onStone), float(1), inWater)
    const standing = smoothstep(0.8, 0.9, wet)

    // Surface normal: moving water where it stands, a faint grain bump elsewhere.
    const n = vec3(0, 1, 0).toVar()
    If(standing.greaterThan(0.01), () => {
      n.assign(normalize(mix(vec3(0, 1, 0), waterNormal(xz), standing)))
    }).Else(() => {
      const bump = vec2(grain.x.sub(0.5), grain.y.sub(0.5)).mul(float(0.06).mul(float(1).sub(wet)))
      n.assign(normalize(vec3(bump.x, 1, bump.y)))
    })

    const roughDry = mix(float(0.9), float(0.34), smoothstep(0.0, 0.8, wet))
    const rough = mix(roughDry, float(0.02), standing)
    // A distorted, mip-selected copy of the mirror. The shared node stays untouched.
    const mirror = reflection.level(rough.mul(rough).mul(7.5))
    // Ripples shift the reflection less the farther away the water is.
    const camDist = max(distance(p, cameraPosition), 3)
    const shiftUV = baseUV.add(n.xz.mul(float(0.32).div(camDist)))
    mirror.uvNode = shiftUV
    // Lights on wet ground smear into vertical streaks: a few extra taps
    // down the screen, fading out. Wetter ground streaks longer.
    // Damp ground smears longest; standing water stays closer to a mirror.
    const streakLen = smoothstep(0.3, 0.7, wet).mul(float(1).sub(standing.mul(0.55))).mul(0.013)
    // Each outer tap reads a blurrier level than the centre, about as wide as
    // the gap between taps (~9 px of the mirror), so they merge into one
    // smear instead of stacking as bars.
    const tap = (k: number): N => {
      const t = reflection.level(max(rough.mul(rough).mul(7.5), 2.6).add(0.35 * Math.abs(k)))
      t.uvNode = shiftUV.add(vec2(0, streakLen.mul(k)))
      return t.rgb.mul(Math.exp(-0.55 * Math.abs(k)))
    }
    const weights = 1 + 2 * (Math.exp(-0.55) + Math.exp(-1.1))
    // Dry ground doesn't streak: skip its four taps (explicit-LOD reads, so
    // they're allowed in a branch).
    const refl = mirror.rgb.toVar()
    If(streakLen.greaterThan(0.00001), () => {
      refl.assign(refl.add(tap(1)).add(tap(-1)).add(tap(2)).add(tap(-2)).div(weights))
    })


    const view = normalize(cameraPosition.sub(p))
    const ndv = max(dot(n, view), 0)
    const fresnel = pow(float(1).sub(ndv), 5).mul(0.98).add(0.02)
    const up = lightsUp.mul(0.92).add(0.08)
    const haze = opts.haze
    const hazeK = haze ? float(1).sub(exp(distance(p, cameraPosition).mul(-haze.density))) : null
    const hazed = (c: N): N => (haze ? mix(c, haze.color, hazeK) : c)
    // The three surfaces are all shaded and blended by coverage (see
    // inWater). The costly parts (mirror taps, textures) are shared above.

    // The pool: a black mirror, lit near the rim by the LED under the coping.
    // Light falling on the water (the moon's patches) shows faintly in it.
    const deep = color('#011627').mul(0.16).mul(up).add(baked ? lightFromBake.mul(0.012) : vec3(0))
    // Water reflects ~2% looking straight down and nearly all of it at a
    // graze: dark where it faces you, mirror toward the far edge.
    const strength = saturate(fresnel.add(0.05))
    // Light from under the coping, spilling into the first ~30 cm of water.
    const rimGlow = exp(min(poolD, 0).mul(4)).mul(0.18).mul(lightsUp)
    const water = mix(hazed(deep), refl, strength).add(hazed(accent.mul(rimGlow)))

    // Honed stone coping: lighter, dry, a soft sheen. The lip's inner edge
    // catches the light from below, softly.
    const stoneAlbedo = vec3(0.24, 0.245, 0.245).mul(grain2.w.mul(0.2).add(0.9))
    const lip = smoothstep(0.09, 0.0, max(poolD, 0)).mul(lightsUp).mul(0.1)
    const stone = hazed(stoneAlbedo.mul(lightAt(vec3(0, 1, 0))).add(accent.mul(lip))).add(refl.mul(fresnel.mul(0.25)))

    // Concrete: damp to standing wet, from the baked map.
    const tone = m.x.mul(0.55).add(0.62)
    const speck = grain.z.mul(0.22).add(0.89)
    const seamDark = float(1).sub(seam.mul(0.45))
    const albedo = vec3(0.22, 0.23, 0.23).mul(tone).mul(speck).mul(seamDark).mul(mix(float(1), float(0.3), smoothstep(0.1, 0.8, wet)))
    // The bake has real occlusion; the map's is a stand-in for it.
    const diffuse = albedo.mul(lightAt(n)).mul(baked ? float(1) : m.z)
    const amount = mix(float(0.03), float(1), smoothstep(0.3, 0.85, wet))
    // Wet concrete keeps a glossy layer even looking down at it.
    const weight = saturate(fresnel.mul(amount).add(smoothstep(0.3, 0.9, wet).mul(0.14)))
    const concrete = mix(hazed(diffuse), refl, weight)

    const out = mix(mix(concrete, stone, onStone), water, inWater).toVar()

    if (DEBUG === 'wet') out.assign(vec3(wet))
    if (DEBUG === 'tone') out.assign(vec3(m.x))
    if (DEBUG === 'ao') out.assign(vec3(m.z))
    if (DEBUG === 'rough') out.assign(vec3(rough))

    // The pointer's light glints on anything wet under it.
    const toCursor = shared.cursor.xyz.sub(p)
    const cd2 = dot(toCursor, toCursor)
    const cursorGlint = pow(max(dot(reflect(view.negate(), n), toCursor.div(cd2.sqrt().max(0.001))), 0), 48)
      .mul(smoothstep(0.3, 0.9, wet))
      .mul(shared.cursor.w)
      .div(cd2.mul(0.5).add(1))
      .mul(3.5)
    out.addAssign(color('#d6ecff').mul(cursorGlint).mul(lightsUp))

    // Moonlight glinting on standing water where the shafts land.
    const spec = pow(max(dot(reflect(view.negate(), n), vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z)), 0), 90)
    out.addAssign(color(MOON_COLOR).mul(spec.mul(3).mul(standing).add(0.02)).mul(shaftFeet(xz)).mul(lightsUp))
    return out
  })()

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(64, 64, 1, 1), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.z = -3

  return {
    mesh,
    target: reflection.target,
    /** The pass that renders the mirror, for code that wants to know when it runs. */
    mirror: reflection.reflector,
    /** Start a ring at x/z with the given strength. `now` is the scene's time uniform value. */
    drop(x: number, z: number, amp: number, now: number) {
      sources[next]!.set(x, z, now, amp)
      next = (next + 1) % RIPPLES
    },
    setReflectScale(scale: number) {
      reflection.reflector.resolutionScale = scale
    },
  }
}

export type Floor = ReturnType<typeof createFloor>

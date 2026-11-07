// The room around the pool: board-formed concrete, a grid of pillars, beams
// under the ceiling, galleries along both side walls, an opening in the
// ceiling with moonlight falling through, a halo hanging over the pool, LED
// strips that the wet floor turns into long streaks, dust in the light and a
// low mist.
//
// No scene lights and no per-frame noise on big surfaces: concrete detail is
// baked once (bake.ts), light comes from lighting.ts. Everything sharing a
// material is merged into one geometry, so the whole room is a handful of
// draw calls.

import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { dissolveCut } from './cloud'
import {
  Discard,
  Fn,
  If,
  Loop,
  abs,
  attribute,
  cameraPosition,
  color,
  distance,
  dot,
  exp,
  float,
  hash,
  instanceIndex,
  length,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  saturate,
  select,
  sin,
  smoothstep,
  texture,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
  screenCoordinate,
} from './tsl'
import {
  CEILING_Y,
  FORM_CENTER,
  KEY_DIR,
  LAMPS,
  LAMP_COLOR,
  LAMP_LEVELS,
  MEZZ,
  MOON_COLOR,
  OPENING,
  PILLAR_SIZE,
  PILLAR_X,
  PILLAR_Z,
  RING,
  RING_COLOR,
  SHAFTS,
  STRIP_COLOR,
  WALL,
  WINDOWS,
} from './layout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export interface BasinShared {
  time: N
  lightsUp: N
  accent: N
  formGlow: N
  /** 1 while the floor's mirror pass renders. Haze layers skip it. */
  inMirror: N
  /** 0 = the hall stands; 1 = it has gone to points (the work page). */
  dissolve: N
}

export interface BasinOptions {
  shafts: boolean
  motes: number
  mist: boolean
  wallMap: THREE.Texture
  detailMap: THREE.Texture
  light: (p: N, n: N, shadow: N) => N
  /** The baked hall (hall.ts) supplies walls, pillars and lamps; only the halo, glass and haze come from here. */
  baked?: boolean
}

const BOTTOM = -0.4

/**
 * Cast concrete, world-mapped. `lit` replaces the analytic light model (and
 * its fake occlusion) with a light function, for surfaces that carry baked
 * light: it gets the point and the relief-tilted normal.
 */
export function concreteMaterial(s: BasinShared, opts: Pick<BasinOptions, 'wallMap' | 'detailMap' | 'light'>, lit?: (p: N, n: N) => N) {
  const m = new THREE.MeshBasicNodeMaterial()
  m.colorNode = Fn(() => {
    const p = positionWorld
    dissolveCut(s, p, screenCoordinate)
    const nrm = normalize(normalWorld)
    const t = s.time

    // World-mapped: the horizontal coordinate along the face, and height.
    // Faces pointing up or down (ceiling, beam soffits) map on x/z.
    const facingX = abs(nrm.x).greaterThan(0.5)
    const facingY = abs(nrm.y).greaterThan(0.5)
    const along = select(facingX, p.z, p.x)
    const vert = select(facingY, p.z, p.y)
    const wuv = vec2(along, vert).div(8)
    const w = texture(opts.wallMap, wuv)
    const seam = w.y
    const hole = w.z
    const streak = w.w

    // Relief: board seams and tie holes are recessed, the pour is uneven.
    // Two extra reads give a slope, which tilts the normal so raking light
    // (the lamps, the pointer) picks the texture out of the wall.
    const relief = (t4: N): N => t4.x.mul(0.35).sub(t4.y.mul(0.9)).sub(t4.z.mul(1.2))
    const e = 1.5 / 1024
    const h0 = relief(w)
    const hA = relief(texture(opts.wallMap, wuv.add(vec2(e, 0))))
    const hB = relief(texture(opts.wallMap, wuv.add(vec2(0, e))))
    const slopeA = hA.sub(h0).mul(1.6)
    const slopeB = hB.sub(h0).mul(1.6)
    // Tangents along the face's own axes: x/z faces vary along z or x, and
    // all wall faces vary in y; floors and soffits vary in x and z.
    const tA = select(facingX, vec3(0, 0, 1), vec3(1, 0, 0))
    const tB = select(facingY, vec3(0, 0, 1), vec3(0, 1, 0))
    const n = normalize(nrm.sub(tA.mul(slopeA)).sub(tB.mul(slopeB)))

    // Occlusion where surfaces meet: the foot of every wall and pillar, the
    // underside near the ceiling, and the corners of the hall.
    const aoFloor = smoothstep(0.0, 1.6, p.y).mul(0.55).add(0.45)
    const aoCeil = smoothstep(0.0, 1.8, float(12).sub(p.y)).mul(0.5).add(0.5)
    const toBack = p.z.sub(-19)
    const toSide = float(14.5).sub(abs(p.x))
    const aoCorner = select(facingX, smoothstep(0, 2.5, toBack), smoothstep(0, 2.5, toSide)).mul(0.45).add(0.55)
    const ao = aoFloor.mul(aoCeil).mul(aoCorner)

    const lowGrime = mix(float(1), streak.mul(0.45).add(0.55), smoothstep(6, 0.5, p.y))
    const wetFoot = smoothstep(-0.05, 0.75, p.y).mul(0.5).add(0.5)
    const albedo = vec3(0.13, 0.14, 0.145)
      .mul(w.x.mul(0.7).add(0.55))
      .mul(float(1).sub(seam.mul(0.3)))
      .mul(float(1).sub(hole.mul(0.5)))
      .mul(lowGrime)
      .mul(wetFoot)

    // Caustics: the form's light bounced off the pool, crawling on nearby
    // concrete. Two scrolling texture reads, no noise evaluation.
    const near = smoothstep(8, 3.5, length(p.xz)).mul(exp(max(p.y, 0).mul(-1.1))).mul(smoothstep(-0.05, 0.15, p.y))
    const c1 = texture(opts.detailMap, vec2(along.mul(0.85).add(t.mul(0.03)), p.y.mul(0.8).sub(t.mul(0.05)))).x
    const c2 = texture(opts.detailMap, vec2(along.mul(0.7).sub(t.mul(0.02)), p.y.mul(0.95).add(t.mul(0.04)))).y
    const caustic = pow(saturate(float(1).sub(abs(c1.sub(c2)).mul(4))), 6).mul(near)
    const causticLight = mix(s.accent, vec3(1), 0.35).mul(caustic).mul(s.formGlow).mul(0.05)

    // A faint sheen where concrete faces the form: honed surfaces catch the
    // main light at a glancing angle. One highlight, no loop.
    const toForm = vec3(FORM_CENTER.x, FORM_CENTER.y, FORM_CENTER.z).sub(p)
    const dForm = length(toForm)
    const view = normalize(cameraPosition.sub(p))
    const half = normalize(toForm.div(dForm).add(view))
    const sheen = pow(max(dot(n, half), 0), 28).mul(s.formGlow.div(dForm.mul(dForm).mul(0.12).add(1))).mul(0.05)

    const diffuse = lit ? albedo.mul(lit(p, n)) : albedo.mul(opts.light(p, n, float(1))).mul(ao)
    return diffuse.add(s.accent.mul(sheen).mul(s.lightsUp)).add(causticLight.mul(s.lightsUp))
  })()
  return m
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}

/** Cast concrete never has a knife edge: a small radius catches the light. */
function cast(w: number, h: number, d: number, x: number, y: number, z: number, radius = 0.025) {
  return new RoundedBoxGeometry(w, h, d, 2, radius).translate(x, y, z)
}

/** Tag a geometry with an emissive color for the merged LED mesh. */
function glow(geo: THREE.BufferGeometry, c: THREE.Color, intensity: number) {
  const n = geo.getAttribute('position').count
  const data = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    data[i * 3] = c.r * intensity
    data[i * 3 + 1] = c.g * intensity
    data[i * 3 + 2] = c.b * intensity
  }
  geo.setAttribute('color', new THREE.BufferAttribute(data, 3))
  return geo
}

export function createBasin(s: BasinShared, opts: BasinOptions) {
  const group = new THREE.Group()
  const concrete = concreteMaterial(s, opts)
  const solid: THREE.BufferGeometry[] = []
  const leds: THREE.BufferGeometry[] = []

  const H = CEILING_Y - BOTTOM
  const midY = (CEILING_Y + BOTTOM) / 2
  const o = OPENING
  const ledMat = new THREE.MeshBasicNodeMaterial()
  ledMat.colorNode = attribute('color', 'vec3').mul(s.lightsUp.mul(0.97).add(0.03))

  if (!opts.baked) {
    // Walls. The back wall has a channel cut through it at floor level, where
    // the water drains off into the dark.
    // Back wall: solid below the windows, a band of glazing with concrete
    // mullions, solid again up to the ceiling.
    const lowH = WINDOWS.y0 - BOTTOM
    solid.push(box(12, lowH, 1, -8.5, BOTTOM + lowH / 2, WALL.back - 0.5))
    solid.push(box(12, lowH, 1, 8.5, BOTTOM + lowH / 2, WALL.back - 0.5))
    solid.push(box(5, WINDOWS.y0 - 4.2, 1, 0, (WINDOWS.y0 + 4.2) / 2, WALL.back - 0.5))
    solid.push(box(29.2, CEILING_Y - WINDOWS.y1, 1, 0, (CEILING_Y + WINDOWS.y1) / 2, WALL.back - 0.5))
    for (let x = -WALL.x; x <= WALL.x + 0.01; x += WINDOWS.mullion) {
      solid.push(cast(0.3, WINDOWS.y1 - WINDOWS.y0, 1.0, x, (WINDOWS.y0 + WINDOWS.y1) / 2, WALL.back - 0.5, 0.02))
    }
    solid.push(box(29.2, 0.1, 0.25, 0, (WINDOWS.y0 + WINDOWS.y1) / 2 + 0.6, WALL.back - 0.55))
    solid.push(box(1, H, 34, -WALL.x - 0.5, midY, -3))
    solid.push(box(1, H, 34, WALL.x + 0.5, midY, -3))
    solid.push(box(5, 1, 12, 0, 4.7, WALL.back - 6.5))
    solid.push(box(1, 5, 12, -2.9, 2.1, WALL.back - 6.5))
    solid.push(box(1, 5, 12, 2.9, 2.1, WALL.back - 6.5))
    solid.push(box(5, 0.2, 12, 0, -0.1, WALL.back - 6.5))

    // Ceiling with a square opening, and beams on the pillar grid beneath it.
    const half = o.size / 2
    const cy = CEILING_Y + 0.5
    const x0 = -15
    const x1 = 15
    const z0 = -20
    const z1 = 14
    solid.push(box(o.x - half - x0, 1, z1 - z0, (x0 + o.x - half) / 2, cy, (z0 + z1) / 2))
    solid.push(box(x1 - (o.x + half), 1, z1 - z0, (o.x + half + x1) / 2, cy, (z0 + z1) / 2))
    solid.push(box(o.size, 1, o.z - half - z0, o.x, cy, (z0 + o.z - half) / 2))
    solid.push(box(o.size, 1, z1 - (o.z + half), o.x, cy, (o.z + half + z1) / 2))
    for (const z of PILLAR_Z) solid.push(cast(29, 1.1, 0.7, 0, CEILING_Y - 0.55, z, 0.03))
    for (const x of PILLAR_X) solid.push(cast(0.7, 1.1, 33, x, CEILING_Y - 0.55, -3, 0.03))

    // Pillars.
    for (const x of PILLAR_X) {
      for (const z of PILLAR_Z) solid.push(cast(PILLAR_SIZE, H, PILLAR_SIZE, x, midY, z, 0.03))
    }

    // Galleries along both side walls: a slab, a rail on posts, and an LED
    // strip under the slab's edge.
    const mezzW = MEZZ.outer - MEZZ.inner
    const mezzL = MEZZ.z1 - MEZZ.z0
    const mezzZ = (MEZZ.z0 + MEZZ.z1) / 2
    for (const side of [-1, 1]) {
      const xc = side * (MEZZ.inner + mezzW / 2)
      const edge = side * MEZZ.inner
      solid.push(cast(mezzW, 0.36, mezzL, xc, MEZZ.y - 0.18, mezzZ, 0.02))
      solid.push(box(0.06, 0.06, mezzL, edge + side * 0.05, MEZZ.y + 1.05, mezzZ))
      solid.push(box(0.03, 0.03, mezzL, edge + side * 0.05, MEZZ.y + 0.55, mezzZ))
      for (let z = MEZZ.z0 + 1; z <= MEZZ.z1 - 1; z += 2) solid.push(box(0.05, 1.05, 0.05, edge + side * 0.05, MEZZ.y + 0.52, z))
      leds.push(glow(box(0.03, 0.025, mezzL, edge + side * 0.04, MEZZ.y - 0.37, mezzZ), STRIP_COLOR, 2.4))
      // Cove light where the wall meets the floor.
      leds.push(glow(box(0.025, 0.03, 31, side * (WALL.x - 0.02), 0.04, -3.5), STRIP_COLOR, 1.8))
    }
    // A catwalk across the back of the hall at gallery height, joining the two
    // galleries: deck, rails both sides, a light line under its front edge.
    const bridgeZ = -12.5
    const span = MEZZ.inner * 2
    solid.push(cast(span, 0.3, 2.0, 0, MEZZ.y - 0.15, bridgeZ, 0.02))
    for (const dz of [-0.97, 0.97]) {
      solid.push(box(span, 0.05, 0.05, 0, MEZZ.y + 1.05, bridgeZ + dz))
      solid.push(box(span, 0.025, 0.025, 0, MEZZ.y + 0.55, bridgeZ + dz))
      for (let x = -MEZZ.inner + 1; x <= MEZZ.inner - 1; x += 2) solid.push(box(0.045, 1.05, 0.045, x, MEZZ.y + 0.52, bridgeZ + dz))
    }
    leds.push(glow(box(span, 0.025, 0.03, 0, MEZZ.y - 0.31, bridgeZ - 0.2), STRIP_COLOR, 0.3))

    for (const side of [-1, 1]) {
      leds.push(glow(box(12, 0.03, 0.025, side * 8.5, 0.04, WALL.back + 0.02), STRIP_COLOR, 1.8))
    }

    // Lamps low on the pillars.
    // Not every fixture in an old hall burns the same: a few run low, one is out.
    LAMPS.forEach((l, i) => leds.push(glow(box(0.04, 0.5, 0.09, l.x, l.y, l.z), LAMP_COLOR, 1.9 * (LAMP_LEVELS[i] ?? 1))))
  }

  // The halo over the pool, on four cables.
  const ring = new THREE.TorusGeometry(RING.radius, 0.032, 8, 192).rotateX(Math.PI / 2).translate(0, RING.y, 0)
  glow(ring, RING_COLOR, 1.25)
  const cables: THREE.BufferGeometry[] = []
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const len = CEILING_Y - RING.y
    cables.push(new THREE.CylinderGeometry(0.008, 0.008, len, 4).translate(Math.cos(a) * RING.radius, RING.y + len / 2, Math.sin(a) * RING.radius))
  }

  if (opts.baked) {
    // Thin enough that only their silhouette reads.
    const dark = new THREE.MeshBasicNodeMaterial()
    dark.colorNode = vec3(0.004, 0.005, 0.006)
    group.add(new THREE.Mesh(mergeGeometries(cables), dark))
  } else {
    solid.push(...cables)
    group.add(new THREE.Mesh(mergeGeometries(solid.map((g) => (g.index ? g.toNonIndexed() : g))), concrete))
  }

  // Glazing in the window band: barely there, a few vertical streaks of
  // reflected light so the openings read as glass rather than holes.
  const glassMat = new THREE.MeshBasicNodeMaterial()
  glassMat.transparent = true
  glassMat.depthWrite = false
  glassMat.blending = THREE.AdditiveBlending
  glassMat.colorNode = Fn(() => {
    const p = positionWorld
    const streak = texture(opts.detailMap, vec2(p.x.mul(0.35), p.y.mul(0.02))).y
    const sheen = smoothstep(0.55, 0.9, streak).mul(0.05).add(0.008)
    return vec4(color(MOON_COLOR).mul(sheen).mul(s.lightsUp.mul(0.8).add(0.2)), 1)
  })()
  const glazing = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL.x * 2, WINDOWS.y1 - WINDOWS.y0).translate(0, (WINDOWS.y0 + WINDOWS.y1) / 2, WALL.back - 0.42),
    glassMat,
  )
  glazing.name = 'haze'
  glazing.renderOrder = 2
  group.add(glazing)

  if (leds.length) group.add(new THREE.Mesh(mergeGeometries(leds), ledMat))
  // The halo is its own mesh: on portrait screens the wide view brings it
  // down across the header, so it hides there and only its light remains.
  const halo = new THREE.Mesh(ring, ledMat)
  halo.name = 'halo'
  group.add(halo)

  // The night sky seen through the opening.
  const sky = new THREE.MeshBasicNodeMaterial()
  sky.colorNode = Fn(() => {
    const p = positionWorld
    const cloud = texture(opts.detailMap, vec2(p.x.mul(0.04).add(s.time.mul(0.002)), p.z.mul(0.04))).w
    return color(MOON_COLOR).mul(cloud.mul(0.5).add(0.3)).mul(s.lightsUp.mul(0.9).add(0.1)).mul(0.08)
  })()
  sky.fog = false
  const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(o.size + 1, o.size + 1), sky)
  skyMesh.rotation.x = Math.PI / 2
  skyMesh.position.set(o.x, CEILING_Y + 3, o.z)
  group.add(skyMesh)

  // Low mist over the floor: two additive sheets of scrolling baked noise,
  // faded out near the camera so you never see a sheet's edge.
  if (opts.mist) {
    const mistMat = new THREE.MeshBasicNodeMaterial()
    mistMat.transparent = true
    mistMat.depthWrite = false
    mistMat.blending = THREE.AdditiveBlending
    mistMat.side = THREE.DoubleSide
    mistMat.colorNode = Fn(() => {
      If(s.inMirror.greaterThan(0.5), () => {
        Discard()
      })
      const p = positionWorld
      const t = s.time
      const a = texture(opts.detailMap, p.xz.mul(0.045).add(vec2(t.mul(0.004), t.mul(0.0025)))).w
      const b = texture(opts.detailMap, p.xz.mul(0.09).sub(vec2(t.mul(0.003), 0))).x
      const density = saturate(a.mul(1.3).sub(0.35)).mul(b.mul(0.6).add(0.4))
      const fadeNear = smoothstep(2.5, 7, distance(p, cameraPosition))
      const fadeEdge = smoothstep(14, 9, abs(p.x)).mul(smoothstep(-19, -14, p.z))
      // Keep the pool clear (mist over it reads as frosted glass), except a
      // low pocket at the form's foot that glows with the form.
      const offPool = smoothstep(3.5, 5, max(abs(p.x), abs(p.z)))
      const foot = smoothstep(2.8, 0.5, length(p.xz)).mul(smoothstep(0.9, 0.2, p.y)).mul(s.formGlow.mul(0.3))
      const where = max(offPool, foot)
      const lit = mix(mix(color(MOON_COLOR), s.accent, 0.3), s.accent, foot.mul(0.6))
      return vec4(lit.mul(density).mul(fadeNear).mul(fadeEdge).mul(where).mul(s.lightsUp).mul(0.07), 1)
    })()
    const mistGeo = mergeGeometries([
      new THREE.PlaneGeometry(30, 34).rotateX(-Math.PI / 2).translate(0, 0.28, -3),
      new THREE.PlaneGeometry(30, 34).rotateX(-Math.PI / 2).translate(0, 0.85, -3),
    ])
    const mist = new THREE.Mesh(mistGeo, mistMat)
    mist.name = 'haze'
    mist.renderOrder = 4
    group.add(mist)
  }

  // Dust motes. No compute: each drifts on its own slow sines, and only
  // shows when it's inside a shaft.
  if (opts.motes > 0) {
    const feet = uniformArray(
      SHAFTS.map((sh) => new THREE.Vector4(sh.foot.x, sh.foot.z, sh.radius, sh.strength)),
      'vec4',
    )
    const mat = new THREE.SpriteNodeMaterial()
    mat.transparent = true
    mat.depthWrite = false
    mat.blending = THREE.AdditiveBlending
    const i = float(instanceIndex)
    const a = hash(i.add(11))
    const b = hash(i.add(23))
    const c2 = hash(i.add(37))
    const d = hash(i.add(51))
    const t = s.time
    const base = vec3(a.mul(11).sub(6.5), b.mul(10).add(0.3), c2.mul(10).sub(6.5))
    const drift = vec3(
      sin(t.mul(d.mul(0.06).add(0.03)).add(a.mul(40))).mul(0.7),
      sin(t.mul(d.mul(0.05).add(0.02)).add(b.mul(40))).mul(0.4),
      sin(t.mul(d.mul(0.06).add(0.025)).add(c2.mul(40))).mul(0.7),
    )
    const p = base.add(drift)
    mat.positionNode = p
    // Big enough to cover a few pixels at the shafts' distance, and faint:
    // a 1 px point at full strength reads as a dead pixel, not dust.
    mat.scaleNode = d.mul(0.026).add(0.022)
    const lit = Fn(() => {
      const total = float(0).toVar()
      Loop(SHAFTS.length, ({ i: k }: { i: N }) => {
        const f = feet.element(k)
        // Slide the point down the light direction to the floor to test the footprint.
        const foot = p.xz.sub(vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z).xz.mul(p.y.div(KEY_DIR.y)))
        const dist = length(foot.sub(f.xy))
        total.addAssign(smoothstep(f.z, f.z.mul(0.3), dist).mul(f.w))
      })
      // Only inside a shaft: outside, a lit speck reads as a dead pixel.
      return total.mul(0.9)
    })
    const twinkle = sin(t.mul(a.mul(1.5).add(0.5)).add(b.mul(30))).mul(0.35).add(0.65)
    mat.colorNode = Fn(() => {
      If(s.inMirror.greaterThan(0.5), () => {
        Discard()
      })
      const r = length(uv().sub(0.5)).mul(2)
      const soft = smoothstep(1, 0, r)
      return vec4(color(MOON_COLOR).mul(lit()).mul(twinkle).mul(s.lightsUp).mul(soft).mul(0.45), 1)
    })()
    const motes = new THREE.Sprite(mat)
    motes.name = 'haze'
    motes.count = opts.motes
    motes.frustumCulled = false
    motes.renderOrder = 3
    group.add(motes)
  }

  return group
}

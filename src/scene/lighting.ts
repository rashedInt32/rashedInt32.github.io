// One light model for every opaque surface in the room. No scene lights:
// each surface asks this function how much light reaches a point with a
// given normal. Kept to cheap math so the full-screen floor and walls stay
// inexpensive.

import * as THREE from 'three/webgpu'
import { Fn, Loop, color, dot, exp, float, length, max, min, mix, smoothstep, uniformArray, vec2, vec3 } from './tsl'
import { FORM_CENTER, KEY_DIR, LAMPS, LAMP_COLOR, LAMP_LEVELS, MEZZ, MOON_COLOR, RING, RING_COLOR, SHAFTS, STRIP_COLOR, WALL } from './layout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

export interface LightShared {
  lightsUp: N
  accent: N
  formGlow: N
  /** xyz: the pointer's light, w: strength 0..1. */
  cursor: N
}

/**
 * The form's colour as it falls on concrete: muted, since full chroma would
 * dye the room. The pool rim and caustics keep the saturated accent.
 */
export const formTint = (accent: N): N => mix(accent, vec3(dot(accent, vec3(0.2126, 0.7152, 0.0722))), 0.6)

/**
 * formGlow at which the baked form maps match: the Blender bake lights the
 * form at 1500 W, which is what formGlow 2.2 looks like (art/bake_hall.py).
 */
export const FORM_REF = 2.2

export function createLighting(s: LightShared) {
  const lamps = uniformArray(
    LAMPS.map((l, i) => new THREE.Vector4(l.x, l.y, l.z, LAMP_LEVELS[i] ?? 1)),
    'vec4',
  )
  const key = vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z)

  /** Moonlight pooled where the shafts reach the floor. */
  const shaftFeet = Fn(([xz]: [N]) => {
    const total = float(0).toVar()
    for (const sh of SHAFTS) {
      const d = length(xz.sub(vec2(sh.foot.x, sh.foot.z)))
      total.addAssign(smoothstep(sh.radius * 1.5, sh.radius * 0.25, d).mul(sh.strength))
    }
    return total
  })

  /** The halo: light from the nearest point on the ring. */
  const ringLight = Fn(([p, n]: [N, N]) => {
    const flat = vec2(p.x, p.z)
    const r = max(length(flat), 0.001)
    const onRing = vec3(flat.x.div(r).mul(RING.radius), RING.y, flat.y.div(r).mul(RING.radius))
    const toRing = onRing.sub(p)
    const dRing2 = dot(toRing, toRing)
    const ndlRing = max(dot(n, toRing.div(dRing2.sqrt())), 0)
    return color(RING_COLOR).mul(ndlRing.div(dRing2.mul(0.05).add(1))).mul(0.07)
  })

  /** The pointer carries a small cool light across whatever it points at. */
  const pointerLight = Fn(([p, n]: [N, N]) => {
    const toCursor = s.cursor.xyz.sub(p)
    const dc2 = dot(toCursor, toCursor)
    const ndlCursor = max(dot(n, toCursor.div(dc2.sqrt().max(0.001))), 0)
    return mix(color('#d6ecff'), s.accent, 0.2).mul(ndlCursor.mul(s.cursor.w).div(dc2.mul(2.6).add(1))).mul(2.2)
  })

  /** Light reaching point p with normal n. `shadow` (0..1) dims only the form's light. */
  const light = Fn(([p, n, shadow]: [N, N, N]) => {
    const up = s.lightsUp.mul(0.94).add(0.06)

    // Lamps by the pillars: short reach.
    const lampSum = float(0).toVar()
    Loop(LAMPS.length, ({ i }: { i: N }) => {
      const lamp4 = lamps.element(i)
      const l = lamp4.xyz.sub(p)
      const d2 = dot(l, l)
      const ndl = max(dot(n, l.div(d2.sqrt())), 0)
      // A fixture also washes the face it's mounted on, which plain N·L misses
      // because the light sits in that face's plane.
      const dy = p.y.sub(lamp4.y)
      const lateral = length(p.xz.sub(lamp4.xz))
      // Each fixture throws a narrow wash up its own pillar, fading with
      // height, and a little down to the floor: an uplight, not a dot.
      const up = exp(max(dy, 0).mul(-0.45)).mul(smoothstep(-0.6, 0.0, dy))
      const down = exp(min(dy, 0).mul(dy).mul(-6))
      const wash = exp(lateral.mul(lateral).mul(-28)).mul(up.add(down).mul(0.55))
      lampSum.addAssign(ndl.div(d2.mul(2.0).add(1)).add(wash).mul(lamp4.w))
    })
    const lamp = color(LAMP_COLOR).mul(lampSum).mul(0.42)

    // The form: the main light, colored by the active project.
    const toForm = vec3(FORM_CENTER.x, FORM_CENTER.y, FORM_CENTER.z).sub(p)
    const dForm = length(toForm)
    const ndlForm = max(dot(n, toForm.div(dForm)), 0)
    const form = formTint(s.accent).mul(ndlForm).mul(s.formGlow.div(dForm.mul(dForm).mul(0.18).add(1))).mul(0.62).mul(shadow)

    const ring = ringLight(p, n)

    // Moon through the opening: soft patches on the floor, a little everywhere.
    const moonFloor = shaftFeet(p.xz).mul(max(n.y, 0)).mul(0.22)
    const moon = color(MOON_COLOR).mul(max(dot(n, key), 0).mul(0.05).add(moonFloor))

    // Cove strips at the foot of the walls and under the galleries.
    const toSide = float(WALL.x).sub(p.x.abs())
    const toBack = p.z.sub(WALL.back)
    const cove = smoothstep(2.2, 0.0, toSide)
      .add(smoothstep(2.2, 0.0, toBack))
      .mul(smoothstep(1.6, 0.0, p.y))
      .mul(0.045)
    const underGallery = smoothstep(MEZZ.inner - 2.5, MEZZ.inner + 0.5, p.x.abs())
      .mul(smoothstep(MEZZ.y, 0.0, p.y))
      .mul(smoothstep(MEZZ.z1 + 1, MEZZ.z1 - 1, p.z))
      .mul(0.05)
    const strips = color(STRIP_COLOR).mul(cove.add(underGallery))

    const ambient = vec3(0.0035, 0.0062, 0.0085)
    return ambient.add(lamp).add(form).add(ring).add(moon).add(strips).mul(up).add(pointerLight(p, n).mul(s.lightsUp))
  })

  /** Only the light a bake can't hold: the halo's and the pointer's. */
  const live = Fn(([p, n]: [N, N]) => {
    const up = s.lightsUp.mul(0.94).add(0.06)
    return ringLight(p, n).mul(up).add(pointerLight(p, n).mul(s.lightsUp))
  })

  return { light, live }
}

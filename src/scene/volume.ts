// Light you can see in the air: the moon falling through the gaps in the
// skylight, a faint haze around the form, and a glow around the pointer.
//
// A post pass takes each view ray from the camera to whatever the pixel hit
// (read from the depth buffer), so beams stop at forms and pillars. Every
// term is integrated exactly along that segment, with no marching: the result
// is smooth (no jitter, no speckle) and costs the same everywhere. It runs at
// low resolution; the soft result upscales cleanly.

import * as THREE from 'three/webgpu'
import { CEILING_Y, FORM_CENTER, KEY_DIR, MOON_COLOR, SHAFTS } from './layout'
import {
  Fn,
  abs,
  atan,
  clamp,
  color,
  dot,
  exp,
  float,
  getViewPosition,
  length,
  max,
  min,
  mix,
  rtt,
  screenUV,
  select,
  sign,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from './tsl'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

// ?vol=depth paints the ray length instead of the light, for tuning.
const DEBUG = new URLSearchParams(location.search).get('vol')

/** How bright the moon shafts read. */
const MOON_GAIN = 0.09

export interface VolumeShared {
  time: N
  lightsUp: N
  accent: N
  formGlow: N
  /** xyz: the pointer's light in the world, w: its strength 0..1. */
  cursor: N
}

/** erf, to about 1e-4 (Winitzki's approximation). */
const erf = (x: N): N => {
  const x2 = x.mul(x)
  const k = x2.mul(0.147)
  return sign(x).mul(sqrt(float(1).sub(exp(x2.negate().mul(k.add(4 / Math.PI)).div(k.add(1))))))
}

export function createVolume(s: VolumeShared, camera: THREE.PerspectiveCamera, depth: N, detail: THREE.Texture) {
  // The quad that renders this pass has its own camera, so the scene
  // camera's matrices come in as uniforms that track it in place.
  const projInv = uniform(camera.projectionMatrixInverse)
  const world = uniform(camera.matrixWorld)
  const eye = uniform(camera.position)
  const key = vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z)
  const formC = vec3(FORM_CENTER.x, FORM_CENTER.y, FORM_CENTER.z)

  /**
   * Light scattered toward the eye by a glow with falloff 1/(1 + k·r²)
   * around `c`, integrated exactly along the ray segment [0, len].
   */
  const glowAlong = (dir: N, len: N, c: N, k: number): N => {
    const w = c.sub(eye)
    const t0 = dot(w, dir)
    const b2 = max(dot(w, w).sub(t0.mul(t0)), 0)
    const a = b2.mul(k).add(1)
    const s1 = float(k).div(a).sqrt()
    return atan(len.sub(t0).mul(s1)).sub(atan(t0.negate().mul(s1))).div(a.mul(k).sqrt())
  }

  /**
   * A moon shaft as a soft beam: density exp(-d²/σ²) at distance d from its
   * axis. Along the ray, d² is a quadratic in t, so the integral is a
   * Gaussian one, in closed form with erf. Limited to the part of the ray
   * between the floor and the ceiling.
   */
  const shaftAlong = (dir: N, len: N, foot: THREE.Vector3, sigma: number): N => {
    const w = eye.sub(vec3(foot.x, foot.y, foot.z))
    const vp = dir.sub(key.mul(dot(dir, key)))
    const wp = w.sub(key.mul(dot(w, key)))
    const a = max(dot(vp, vp), 0.0001)
    const b = dot(wp, vp)
    const m = b.negate().div(a) // where the ray passes closest to the axis
    const d2 = max(dot(wp, wp).sub(b.mul(b).div(a)), 0)
    const dy = select(abs(dir.y).lessThan(0.0001), float(0.0001), dir.y)
    const tA = float(0.2).sub(eye.y).div(dy)
    const tB = float(CEILING_Y - 0.5).sub(eye.y).div(dy)
    const t0 = max(min(tA, tB), 0)
    const t1 = min(max(tA, tB), len)
    const k = sqrt(a).div(sigma)
    const span = erf(k.mul(t1.sub(m))).sub(erf(k.mul(t0.sub(m)))).max(0)
    const amount = exp(d2.div(-sigma * sigma)).mul(span).mul(float((sigma * Math.sqrt(Math.PI)) / 2).div(sqrt(a)))
    // Drifting smoke, read once where the ray passes closest.
    const q = eye.add(dir.mul(clamp(m, t0, max(t1, t0))))
    const smoke = texture(detail, vec2(q.x.mul(0.06).add(q.y.mul(0.025)).add(s.time.mul(0.006)), q.z.mul(0.06).sub(s.time.mul(0.004)))).w
    return amount.mul(smoke.mul(1.1).add(0.35))
  }

  const march = Fn(() => {
    const uv = screenUV
    const d = depth.sample(uv).x
    const viewPos = getViewPosition(uv, d, projInv)
    const hit = world.mul(vec4(viewPos, 1)).xyz
    const toHit = hit.sub(eye)
    const dist = min(length(toHit), 42)
    const dir = toHit.div(max(length(toHit), 0.0001))
    const tint = mix(s.accent, vec3(dot(s.accent, vec3(0.2126, 0.7152, 0.0722))), 0.4)

    const haze = tint.mul(s.formGlow).mul(glowAlong(dir, dist, formC, 0.9)).mul(0.0011)
    const glow = color('#d6ecff').mul(s.cursor.w).mul(glowAlong(dir, dist, s.cursor.xyz, 7)).mul(0.2)
    let moon: N = float(0)
    for (const sh of SHAFTS) moon = moon.add(shaftAlong(dir, dist, sh.foot, sh.radius * 0.55).mul(sh.strength))
    const acc = haze.add(glow).add(color(MOON_COLOR).mul(moon).mul(MOON_GAIN))

    if (DEBUG === 'depth') return vec4(vec3(dist.div(42)), 1)
    return vec4(acc.mul(s.lightsUp), 1)
  })

  const node = rtt(march(), null, null, { resolutionScale: 0.35 })
  return {
    node,
    /** Kept for callers; nothing here changes per frame anymore. */
    tick() {},
  }
}

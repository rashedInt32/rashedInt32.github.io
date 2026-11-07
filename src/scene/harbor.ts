// The harbor outside, seen through the windows and down the drain channel:
// a night sky, gantry cranes and container stacks against a faint glow on
// the horizon, dock lights in sodium orange and cold white, and their
// reflections stretched down the black water.
//
// One plane, far away, unaffected by the hall's fog. Most of it sits behind
// the wall, so only the pixels visible through the openings cost anything.

import * as THREE from 'three/webgpu'
import { Fn, abs, color, exp, float, floor, fract, hash, length, max, mix, select, sin, smoothstep, texture, uv, vec2, vec3 } from './tsl'
import { HARBOR } from './layout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

interface HarborShared {
  time: N
  lightsUp: N
}

const W = 240
const H = 80
const BOTTOM = -30

/** 2D box: 1 inside, 0 outside, antialiased over `soft` meters. */
function boxMask(p: N, center: [number, number], half: [number, number], soft: number): N {
  const d = abs(p.sub(vec2(center[0], center[1]))).sub(vec2(half[0], half[1]))
  return float(1).sub(smoothstep(-soft, soft, max(d.x, d.y)))
}

// Gantry cranes: x, height to the boom, boom left reach, boom right reach.
// Booms sit 16-22 m up: that's the slice of sky the hall's windows frame.
const CRANES: Array<[number, number, number, number]> = [
  [-38, 19, 22, 9],
  [-14, 16, 15, 8],
  [19, 21, 10, 22],
  [43, 17, 18, 9],
]

export function createHarbor(s: HarborShared, detail: THREE.Texture) {
  const material = new THREE.MeshBasicNodeMaterial()
  material.fog = false
  material.colorNode = Fn(() => {
    const q = uv()
    // World meters on the plane; y is height above the water.
    const p = vec2(q.x.mul(W).sub(W / 2), q.y.mul(H).add(BOTTOM))
    const hz = float(HARBOR.horizon)
    const above = smoothstep(hz.sub(0.05), hz.add(0.05), p.y)

    // Sky: a low glow over the docks fading to night.
    const up = max(p.y.sub(hz), 0)
    // The city behind the docks lights the low cloud: the glow reaches high
    // enough that the windows, which see 12-25 m up, frame the crane booms.
    const glowCol = color('#1d2a35')
    const night = color('#060c13')
    const cloud = texture(detail, vec2(p.x.mul(0.004).add(s.time.mul(0.0004)), p.y.mul(0.012))).w
    const starCell = floor(p.mul(1.6))
    const starOn = smoothstep(0.994, 1, hash(starCell.x.add(starCell.y.mul(613))))
    const starDot = smoothstep(0.16, 0.0, length(fract(p.mul(1.6)).sub(0.5)))
    const star = starOn.mul(starDot).mul(smoothstep(16, 30, up)).mul(0.7)
    const sky = mix(glowCol, night, smoothstep(0, 26, up)).mul(cloud.mul(0.4).add(0.7)).add(vec3(star))

    // Silhouettes: container stacks along the quay, then the cranes.
    let solid: N = float(0)
    for (let i = 0; i < 18; i++) {
      const x = -96 + i * 11.3 + ((i * 37) % 7)
      const h = 2.2 + ((i * 53) % 5) * 0.9
      solid = max(solid, boxMask(p, [x, HARBOR.horizon + h / 2], [4.2 + ((i * 13) % 3), h / 2], 0.08))
    }
    const redLights: N[] = []
    for (const [x, h, left, right] of CRANES) {
      const top = HARBOR.horizon + h
      solid = max(solid, boxMask(p, [x - 3, HARBOR.horizon + h / 2], [0.35, h / 2], 0.06))
      solid = max(solid, boxMask(p, [x + 3, HARBOR.horizon + h / 2], [0.35, h / 2], 0.06))
      solid = max(solid, boxMask(p, [x, top], [3.4, 0.5], 0.06))
      solid = max(solid, boxMask(p, [x + (right - left) / 2, top + 0.9], [(left + right) / 2, 0.45], 0.06))
      // Boom ties up to the A-frame.
      solid = max(solid, boxMask(p, [x - left * 0.45, top + 3.1], [left * 0.45, 0.12], 0.05))
      solid = max(solid, boxMask(p, [x + right * 0.45, top + 3.1], [right * 0.45, 0.12], 0.05))
      solid = max(solid, boxMask(p, [x, top + 3.2], [0.25, 2.8], 0.06))
      solid = max(solid, boxMask(p, [x + 1.4, top - 1.4], [1.1, 0.8], 0.06))
      redLights.push(vec2(x, top + 6.1))
    }
    const silhouette = mix(sky, color('#010305'), solid.mul(above))

    // Dock lights in a band just above the water, one per cell.
    const lamps = Fn(([pt]: [N]) => {
      const cellW = 0.7
      const cell = floor(pt.x.div(cellW))
      const total = vec3(0).toVar()
      for (const k of [-1, 0, 1]) {
        const c = cell.add(k)
        const on = hash(c.add(17)).greaterThan(0.38)
        const lx = c.add(hash(c.add(3)).mul(0.8).add(0.1)).mul(cellW)
        const ly = hz.add(hash(c.add(9)).mul(1.6).add(0.25))
        const warm = hash(c.add(29)).greaterThan(0.12)
        const tint = mix(color('#cfe2ff'), color('#ffb15c'), select(warm, float(1), float(0)))
        const d = pt.sub(vec2(lx, ly))
        const g = exp(d.x.mul(d.x).add(d.y.mul(d.y)).mul(-60)).mul(1.4).add(exp(d.x.mul(d.x).add(d.y.mul(d.y)).mul(-2.5)).mul(0.04))
        total.addAssign(tint.mul(g).mul(select(on, float(1), float(0))))
      }
      return total
    })

    // Red lights on the crane tops, slowly blinking.
    let reds: N = vec3(0)
    redLights.forEach((r, i) => {
      const d = p.sub(r)
      const blink = sin(s.time.mul(1.3).add(i * 1.7)).mul(0.5).add(0.5)
      reds = reds.add(color('#ff3b30').mul(exp(d.x.mul(d.x).add(d.y.mul(d.y)).mul(-6)).mul(blink.mul(1.5).add(0.3))))
    })

    // Water: dark, with every light pulled down into a shimmering streak.
    const depth = max(hz.sub(p.y), 0)
    const wobble = sin(p.y.mul(9).add(s.time.mul(1.6)).add(p.x.mul(0.3))).mul(0.18).mul(smoothstep(0, 3, depth))
    const mirrored = vec2(p.x.add(wobble), hz.add(depth.mul(0.22)))
    const streak = lamps(mirrored).mul(exp(depth.mul(-0.35))).mul(0.55)
    const water = color('#010407').add(glowCol.mul(0.18).mul(exp(depth.mul(-0.8)))).add(streak)

    const outside = mix(water, silhouette.add(lamps(p)).add(reds), above)
    return outside.mul(s.lightsUp.mul(0.8).add(0.2))
  })()

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), material)
  mesh.position.set(0, BOTTOM + H / 2, HARBOR.z)
  return mesh
}


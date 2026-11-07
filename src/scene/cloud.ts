// The hall as a cloud of points, for the work page: when the reader turns
// to the timeline the concrete dissolves into grains that drift apart, and
// comes back when they leave. The points are sampled once from the baked
// hall's surfaces at load; the dissolve itself is one uniform.
//
// Cheap on purpose: one instanced sprite, no compute, and the hall's own
// materials cut themselves away with a screen-door test on the same uniform.

import * as THREE from 'three/webgpu'
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'
import { Fn, If, Discard, cameraPosition, color, float, hash, instanceIndex, instancedArray, length, mix, mx_noise_vec3, normalize, smoothstep, sin, uv, vec3, vec4 } from './tsl'
import type { BasinShared } from './basin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** Points on the hall's surfaces, in world space, spread by area. */
function samplePoints(model: THREE.Object3D, count: number): Float32Array {
  const meshes: Array<{ mesh: THREE.Mesh; sampler: MeshSurfaceSampler; area: number }> = []
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return
    const sampler = new MeshSurfaceSampler(mesh).build()
    const dist = sampler.distribution
    const area = dist && dist.length ? dist[dist.length - 1]! : 0
    if (area > 0) meshes.push({ mesh, sampler, area })
  })
  const total = meshes.reduce((a, m) => a + m.area, 0)
  const out = new Float32Array(count * 4)
  const p = new THREE.Vector3()
  let i = 0
  for (const m of meshes) {
    const n = m === meshes[meshes.length - 1] ? count - i : Math.round((count * m.area) / total)
    for (let k = 0; k < n && i < count; k++, i++) {
      m.sampler.sample(p)
      p.applyMatrix4(m.mesh.matrixWorld)
      out[i * 4] = p.x
      out[i * 4 + 1] = p.y
      out[i * 4 + 2] = p.z
      out[i * 4 + 3] = 1
    }
  }
  return out
}

export function createCloud(model: THREE.Object3D, count: number, s: BasinShared) {
  const points = samplePoints(model, count)
  const home = instancedArray(points, 'vec4')

  const mat = new THREE.SpriteNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.blending = THREE.AdditiveBlending

  const i = float(instanceIndex)
  const h1 = hash(i.add(3))
  const h2 = hash(i.add(17))
  const h3 = hash(i.add(29))
  const h4 = hash(i.add(41))
  const d = s.dissolve
  const p0 = home.toAttribute().xyz
  // Each grain leaves its surface on its own schedule, along its own line,
  // and keeps drifting on noise while the page is open.
  const start = h4.mul(0.5)
  const k = smoothstep(start, start.add(0.5), d)
  const dir = normalize(vec3(h1.sub(0.5), h2.sub(0.3), h3.sub(0.5)).add(0.0001))
  const swirl = mx_noise_vec3(p0.mul(0.25).add(vec3(0, s.time.mul(0.05), 0))).mul(0.6)
  const p = p0.add(dir.mul(k.mul(h1.mul(1.4).add(0.4)))).add(swirl.mul(k)).add(vec3(0, k.mul(0.5), 0))
  mat.positionNode = p
  // Grains near the eye would swell into bokeh: smaller, and faded out close in.
  const near = smoothstep(1.5, 5, length(p.sub(cameraPosition)))
  mat.scaleNode = h2.mul(0.014).add(0.012).mul(k.mul(0.5).add(0.5))

  const twinkle = sin(s.time.mul(h3.mul(1.2).add(0.4)).add(h1.mul(30))).mul(0.3).add(0.7)
  mat.colorNode = Fn(() => {
    const r = length(uv().sub(0.5)).mul(2)
    const soft = smoothstep(1, 0.35, r)
    // Grains show as the surface goes, and fade a little as they drift.
    const show = smoothstep(0, 0.08, d).mul(k.mul(0.75).add(0.25))
    const tone = mix(color('#9bb5c7'), color('#e2edf4'), h4)
    If(show.lessThan(0.002), () => {
      Discard()
    })
    return vec4(tone.mul(twinkle).mul(soft).mul(show).mul(near).mul(s.lightsUp).mul(0.85), 1)
  })()

  const sprite = new THREE.Sprite(mat)
  sprite.name = 'cloud'
  sprite.count = count
  sprite.frustumCulled = false
  sprite.renderOrder = 2
  sprite.visible = false
  return sprite
}

/**
 * The screen-door cut the hall's materials make as they dissolve: a
 * per-pixel threshold eroded in patches of world-space noise, so surfaces
 * go in pieces rather than fading. Costs nothing while dissolve is 0.
 */
export function dissolveCut(s: BasinShared, p: N, screen: N) {
  If(s.dissolve.greaterThan(0.001), () => {
    const grain = hash(screen.x.floor().add(screen.y.floor().mul(4099)))
    const patch = mx_noise_vec3(p.mul(0.7)).x.mul(0.5).add(0.5)
    If(s.dissolve.greaterThan(grain.mul(0.5).add(patch.mul(0.5))), () => {
      Discard()
    })
  })
}

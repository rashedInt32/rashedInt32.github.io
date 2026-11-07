// The hall as built and baked in Blender (art/build_hall.py, art/bake_hall.py):
// the concrete, the props and the lamps, with every static light (pillar
// lamps, moon, strips, booth, uplights, crane) and its bounce baked into
// textures.
//
// What stays live on top: the form's light, baked in white and tinted here
// with the active project's colour and scaled by its glow; the halo; the
// pointer. Concrete keeps the site's own world-mapped albedo and relief and
// takes only its light from the bake. Props carry their baked colour.

import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { Fn, attribute, cameraPosition, exp2, length, max, mix, normalWorld, normalize, positionWorld, texture, uv, vec2, vec3 } from './tsl'
import { concreteMaterial, type BasinShared } from './basin'
import { FORM_REF, formTint } from './lighting'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

// These match art/bake_hall.py.
const LOG_MIN = -12
const LOG_MAX = 3
const EMIT_SCALE = 64
/** Where the floor bake lies, sampled by world x/z. */
export const FLOOR_BAKE = { x0: -14.5, x1: 14.5, z0: -19, z1: 14 }

// ?hall=light paints the concrete's baked light alone (no albedo), for tuning.
const DEBUG = new URLSearchParams(location.search).get('hall')

/** Blender's emission strengths, brought to the site's exposure and bloom. */
const EMIT_GAIN = 0.12
/**
 * The site's concrete and floor albedo run about 1.5x Blender's (0.12 against
 * 0.08). Baked light on them is scaled by this so albedo x light matches the
 * approved stills.
 */
export const ALBEDO_MATCH = 0.66
/** The bake holds albedo times light on props; the live light uses a typical albedo. */
const PROP_ALBEDO = 0.14

/** Linear light from a baked texel. Each channel stores log2 of the light. */
const decodeLight = (t: N): N => max(exp2(t.mul(LOG_MAX - LOG_MIN).add(LOG_MIN)).sub(2 ** LOG_MIN), 0)

/** The shared uniforms baked light depends on. */
export interface BakedShared {
  lightsUp: N
  accent: N
  formGlow: N
}

/**
 * Light at a surface from its two baked texels: every static source, coming
 * up with the lights, plus the form's light (baked in white) tinted with the
 * active project's colour and scaled by its glow. Texels are raw samples of
 * the maps; a grey form map can come in as a single channel.
 */
export const bakedLight = (s: BakedShared, still: N, form: N): N =>
  decodeLight(still)
    .mul(s.lightsUp.mul(0.94).add(0.06))
    .add(formTint(s.accent).mul(decodeLight(form)).mul(s.formGlow.div(FORM_REF)))

export interface HallMaps {
  archStatic: THREE.Texture
  archForm: THREE.Texture
  floorStatic: THREE.Texture
  floorForm: THREE.Texture
  propsStatic: THREE.Texture
  propsForm: THREE.Texture
  plantsStatic: THREE.Texture
  plantsForm: THREE.Texture
}

/** One tree or pot, as art/bake_hall.py rendered it (public/hall/plants.json). */
export interface Plant {
  x: number
  z: number
  /** Extent along the camera's right, from the anchor, in metres. */
  across: [number, number]
  /** Bottom and top, in metres. */
  up: [number, number]
  /** In the atlas: u0, v at the top, u1, v at the bottom. */
  rect: [number, number, number, number]
}

export interface HallAssets {
  model: THREE.Group
  maps: HallMaps
  plants: Plant[]
}

export async function loadHall(): Promise<HallAssets> {
  const base = `${import.meta.env.BASE_URL}hall/`
  const images = new THREE.TextureLoader()
  const map = async (name: string) => {
    const t = await images.loadAsync(`${base}${name}.webp`)
    // glTF's convention, and the way the floor maps were written.
    t.flipY = false
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 4
    return t
  }
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const [model, plants, archStatic, archForm, floorStatic, floorForm, propsStatic, propsForm, plantsStatic, plantsForm] = await Promise.all([
    gltf.loadAsync(`${base}hall.glb`).then((g) => g.scene),
    fetch(`${base}plants.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`plants.json: ${r.status}`)
        return r.json() as Promise<{ plants?: unknown }>
      })
      .then((d) => {
        if (!Array.isArray(d.plants)) throw new Error('plants.json: no plants list')
        return { plants: d.plants as Plant[] }
      }),
    map('arch_static'),
    map('arch_form'),
    map('floor_static'),
    map('floor_form'),
    map('props_static'),
    map('props_form'),
    map('plants_static'),
    map('plants_form'),
  ])
  return {
    model,
    plants: plants.plants,
    maps: { archStatic, archForm, floorStatic, floorForm, propsStatic, propsForm, plantsStatic, plantsForm },
  }
}

export interface HallOptions {
  wallMap: THREE.Texture
  detailMap: THREE.Texture
  /** The analytic light model; unused here but part of the concrete's options. */
  light: (p: N, n: N, shadow: N) => N
  /** Light the bake can't hold: the halo's and the pointer's. */
  live: (p: N, n: N) => N
  /** MSAA is on: plant edges can use alpha to coverage. */
  msaa: boolean
  /** Draw the tree and pot impostors (?off=plants measures them). */
  plants: boolean
}

/**
 * Trees and pots as impostors: one quad each, standing at the plant and
 * turned about the vertical to face the camera, showing the plant as Blender
 * rendered it in place. All of them are one mesh, one draw.
 */
function createPlants(assets: HallAssets, s: BasinShared, opts: HallOptions) {
  const plants = assets.plants
  const count = plants.length * 4
  const anchor = new Float32Array(count * 3)
  const span = new Float32Array(count * 4)
  const corner = new Float32Array(count * 2)
  const rect = new Float32Array(count * 4)
  const index: number[] = []
  const corners = [0, 0, 1, 0, 1, 1, 0, 1]
  plants.forEach((p, i) => {
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k
      anchor.set([p.x, 0, p.z], v * 3)
      span.set([p.across[0], p.across[1], p.up[0], p.up[1]], v * 4)
      corner.set([corners[k * 2]!, corners[k * 2 + 1]!], v * 2)
      rect.set(p.rect, v * 4)
    }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(anchor.slice(), 3))
  geo.setAttribute('anchor', new THREE.BufferAttribute(anchor, 3))
  geo.setAttribute('span', new THREE.BufferAttribute(span, 4))
  geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2))
  geo.setAttribute('rect', new THREE.BufferAttribute(rect, 4))
  geo.setIndex(index)

  const a = attribute('anchor', 'vec3')
  const sp = attribute('span', 'vec4')
  const cr = attribute('corner', 'vec2')
  const rc = attribute('rect', 'vec4')
  // Face the camera, turning only about the vertical. Same "right" as the
  // Blender camera that rendered the picture.
  const away = cameraPosition.xz.sub(a.xz)
  const toCam = away.div(max(length(away), 0.001))
  const right = vec3(toCam.y, 0, toCam.x.negate())

  const mat = new THREE.MeshBasicNodeMaterial()
  mat.side = THREE.DoubleSide
  mat.alphaTest = 0.5
  mat.alphaToCoverage = opts.msaa
  mat.positionNode = a.add(right.mul(mix(sp.x, sp.y, cr.x))).add(vec3(0, mix(sp.z, sp.w, cr.y), 0))
  const at = vec2(mix(rc.x, rc.z, cr.x), mix(rc.w, rc.y, cr.y))
  const still = texture(assets.maps.plantsStatic, at)
  const live = opts.live(positionWorld, vec3(toCam.x, 0, toCam.y)).mul(0.08)
  mat.colorNode = bakedLight(s, still.rgb, texture(assets.maps.plantsForm, at).rgb).add(live)
  mat.opacityNode = still.a

  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = 'plants'
  return mesh
}

export function createHall(assets: HallAssets, s: BasinShared, opts: HallOptions) {
  const { maps } = assets

  const arch = concreteMaterial(s, opts, (p, n) => {
    const light = bakedLight(s, texture(maps.archStatic, uv()).rgb, texture(maps.archForm, uv()).x)
    return light.mul(ALBEDO_MATCH).add(opts.live(p, n))
  })
  if (DEBUG === 'light') arch.colorNode = bakedLight(s, texture(maps.archStatic, uv()).rgb, texture(maps.archForm, uv()).x)

  const props = new THREE.MeshBasicNodeMaterial()
  props.colorNode = Fn(() => {
    const live = opts.live(positionWorld, normalize(normalWorld)).mul(PROP_ALBEDO)
    return bakedLight(s, texture(maps.propsStatic, uv()).rgb, texture(maps.propsForm, uv()).rgb).add(live)
  })()

  const emit = new THREE.MeshBasicNodeMaterial()
  emit.colorNode = attribute('color', 'vec3')
    .mul(EMIT_SCALE * EMIT_GAIN)
    .mul(s.lightsUp.mul(0.97).add(0.03))

  const materials: Record<string, THREE.Material> = { arch, props, emit }
  assets.model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    let owner: THREE.Object3D | null = mesh
    while (owner && !(owner.name in materials)) owner = owner.parent
    if (owner) mesh.material = materials[owner.name]!
    else console.warn('harbor: unexpected mesh in hall.glb:', mesh.name)
  })
  if (opts.plants && assets.plants.length) assets.model.add(createPlants(assets, s, opts))
  assets.model.updateMatrixWorld(true)
  assets.model.traverse((o) => (o.matrixAutoUpdate = false))
  return assets.model
}

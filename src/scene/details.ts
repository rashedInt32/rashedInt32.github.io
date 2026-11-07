// Painted marks that give the hall a sense of scale and use: grid codes
// stencilled on the pillars, the way real halls mark their structural grid,
// and the signage from art/build_hall.py build_signage(): the hall number on
// the back wall, bay codes and a no-entry stencil on the floor, the load
// limit on the catwalk. One texture atlas, one merged mesh, one draw call.

import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Discard, Fn, If, attribute, float, mix, normalWorld, normalize, positionWorld, smoothstep, texture, uv, vec3, vec4 } from './tsl'
import { PILLAR_SIZE, PILLAR_X, PILLAR_Z, WALL } from './layout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any
type RGB = [number, number, number]

// Pillar codes: a 4 x 5 grid of cells in the atlas's top left corner.
const COLS = 4
const ROWS = 5
const CELL_W = 256
const CELL_H = 96
const CODES_W = COLS * CELL_W
const CODES_H = ROWS * CELL_H
const ATLAS_W = 2048
/** Empty texels around each sign, so mip levels don't bleed between them. */
const PAD = 12

/** The signs' face: a plain grotesque at medium weight, like the stills' Blender font, squeezed a little like stencil lettering. */
const SIGN_FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
const SIGN_WEIGHT = 500
const SQUEEZE = 0.88

// Paint as a multiply factor on the light already at the surface. Grey paint
// is about 4.2x brighter than the concrete. The floor's albedo runs higher
// than the walls', so the same paint lifts it less. Red is art/build_hall.py's
// paint_red (#9b3a32) over the floor, greyed toward the concrete so it reads
// as old paint, not a glow.
const GREY: RGB = [4.2, 4.25, 4.1]
const GREY_FLOOR: RGB = [3.0, 3.0, 2.9]
const RED_FLOOR: RGB = [2.1, 0.62, 0.5]
/** Albedo of paint per unit of factor, for the lit path: 4.2 -> 0.55. */
const PAINT_ALBEDO = 0.131
/** Pillar wear lookups per meter. */
const PILLAR_WEAR = 1.7
/** Texels across the detail map (index.ts bakes it at 512). Its z channel is one random value per texel. */
const DETAIL_SIZE = 512

/** A faded coat: part of the way from bare concrete (1) to full paint. */
const fade = (c: RGB, k: number): RGB => [1 + (c[0] - 1) * k, 1 + (c[1] - 1) * k, 1 + (c[2] - 1) * k]

interface Sign {
  text: string
  /** Centre of the ink, in site coordinates. */
  at: [number, number, number]
  /** Ink height in meters. */
  height: number
  /** Ink width in meters. Without it the font sets the width, squeezed. */
  width?: number
  /** Laid on the floor, turned this much about +y. Read +x, tops toward -z at 0. */
  floor?: number
  /** Font size in the atlas, in pixels. */
  px: number
  /** Size of a paint flake in meters. Big letters get bigger flakes, still fine against the letter. */
  flake: number
  paint: RGB
}

// From art/build_hall.py build_signage(). paint_text() centres the text on
// its anchor; Blender's default font draws caps at about 0.7 of the size.
// The hall number was measured off art/renders/home.png and work.png.
const CAP = 0.7
const ON_WALL = WALL.back + 0.005
const ON_FLOOR = 0.004
/** The catwalk's front face is at z = -11.5. */
const ON_CATWALK = -11.49

const SIGNS: Sign[] = [
  // Size 3.2 at y 2.9 in Blender. The stills show ink 2.23 m tall, 3.0 m wide, centred at 3.05 m.
  { text: '04', at: [-6.4, 3.05, ON_WALL], height: 2.23, width: 3.0, px: 520, flake: 0.03, paint: fade(GREY, 0.75) },
  { text: 'HALL', at: [-6.4, 0.91, ON_WALL], height: 0.55 * CAP, px: 128, flake: 0.01, paint: fade(GREY, 0.75) },
  ...[-14, -4, 6].flatMap((z, k): Sign[] => [
    // Read along the wall, tops toward it.
    { text: `B-0${k + 1}`, at: [-12.8, ON_FLOOR, z], height: 0.5 * CAP, floor: Math.PI / 2, px: 128, flake: 0.012, paint: GREY_FLOOR },
    { text: `D-0${k + 1}`, at: [12.8, ON_FLOOR, z], height: 0.5 * CAP, floor: -Math.PI / 2, px: 128, flake: 0.012, paint: GREY_FLOOR },
  ]),
  { text: 'NO ENTRY', at: [0, ON_FLOOR, WALL.back + 1.2], height: 0.32 * CAP, floor: 0, px: 128, flake: 0.009, paint: RED_FLOOR },
  // Blender centres it at y 5.0, where the top of the letters overhangs the
  // face (4.75 to 5.05). Lowered so the whole decal lands on concrete.
  { text: 'MAX 500 KG', at: [0, 4.93, ON_CATWALK], height: 0.16 * CAP, px: 128, flake: 0.006, paint: fade(GREY, 0.8) },
]

interface Placed {
  sign: Sign
  /** Cell in the atlas, in pixels from the top left, padding included. */
  x: number
  y: number
  w: number
  h: number
  /** Where to draw the text so its ink sits inside the padding. */
  ox: number
  oy: number
}

const signFont = (px: number) => `${SIGN_WEIGHT} ${px}px ${SIGN_FONT}`

/** Measure each sign's ink and shelf-pack the cells to the right of and below the pillar codes. */
function packSigns(g: CanvasRenderingContext2D) {
  const placed: Placed[] = []
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  let x = CODES_W
  let y = 0
  let shelf = CODES_H
  for (const sign of SIGNS) {
    g.font = signFont(sign.px)
    const m = g.measureText(sign.text)
    const left = Math.ceil(m.actualBoundingBoxLeft)
    const ascent = Math.ceil(m.actualBoundingBoxAscent)
    const w = left + Math.ceil(m.actualBoundingBoxRight) + PAD * 2
    const h = ascent + Math.ceil(m.actualBoundingBoxDescent) + PAD * 2
    if (x + w > ATLAS_W) {
      x = 0
      y += shelf
      shelf = 0
    }
    placed.push({ sign, x, y, w, h, ox: x + PAD + left, oy: y + PAD + ascent })
    x += w
    shelf = Math.max(shelf, h)
  }
  return { placed, height: Math.ceil((y + shelf) / 16) * 16 }
}

function drawAtlas(canvas: HTMLCanvasElement, placed: Placed[]) {
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '600 64px "JetBrains Mono Variable", ui-monospace, monospace'
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const label = `${String.fromCharCode(65 + c)}-${String(r + 1).padStart(2, '0')}`
      g.fillText(label, c * CELL_W + CELL_W / 2, r * CELL_H + CELL_H / 2 + 3)
    }
  }
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  for (const p of placed) {
    g.font = signFont(p.sign.px)
    g.fillText(p.sign.text, p.ox, p.oy)
  }
}

/** Point a plane's 0..1 uvs at a pixel rect of the atlas. The canvas is flipped on upload. */
function mapUV(geo: THREE.BufferGeometry, x: number, y: number, w: number, h: number, W: number, H: number) {
  const a = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < a.count; i++) {
    a.setXY(i, (x + a.getX(i) * w) / W, 1 - (y + h - a.getY(i) * h) / H)
  }
}

/**
 * Per-vertex paint and wear; every quad carries both so they merge.
 * paint: rgb factor, w = how far the wear is fine flakes (1) rather than
 * the pillar codes' blotches (0). wear: xy = grain lookup, zw = flake lookup.
 */
function addPaint(geo: THREE.BufferGeometry, paint: RGB, flaky: number, wear: (x: number, y: number, z: number) => number[]) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const w = new Float32Array(pos.count * 4)
  const c = new Float32Array(pos.count * 4)
  for (let i = 0; i < pos.count; i++) {
    w.set(wear(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 4)
    c.set([...paint, flaky], i * 4)
  }
  geo.setAttribute('wear', new THREE.BufferAttribute(w, 4))
  geo.setAttribute('paint', new THREE.BufferAttribute(c, 4))
}

/**
 * With `light`, the paint is lit by the analytic light model. Without it
 * (the baked hall), the paint is a multiply decal: it scales whatever light
 * already reached the surface. Pass `inMirror` (1 while the floor's mirror
 * renders) to keep floor paint out of the reflection; wall paint stays in it.
 */
export function createStencils(detail: THREE.Texture, light?: (p: N, n: N, shadow: N) => N, inMirror?: N) {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_W
  const { placed, height } = packSigns(canvas.getContext('2d')!)
  canvas.height = height
  drawAtlas(canvas, placed)
  const atlas = new THREE.CanvasTexture(canvas)
  atlas.anisotropy = 8
  atlas.colorSpace = THREE.NoColorSpace
  // Redraw once the codes' face has loaded; the first pass may use a fallback.
  // The signs use system faces, measured above, so their cells don't move.
  document.fonts?.load('600 64px "JetBrains Mono Variable"').then(() => {
    drawAtlas(canvas, placed)
    atlas.needsUpdate = true
  })

  const quads: THREE.BufferGeometry[] = []
  PILLAR_X.forEach((x, c) => {
    PILLAR_Z.forEach((z, r) => {
      // On the face that looks toward the pool.
      const side = x > 0 ? -1 : 1
      const g = new THREE.PlaneGeometry(0.46, 0.17)
      mapUV(g, c * CELL_W, r * CELL_H, CELL_W, CELL_H, ATLAS_W, height)
      g.rotateY((side * Math.PI) / 2)
      g.translate(x + side * (PILLAR_SIZE / 2 + 0.004), 2.45, z)
      addPaint(g, GREY, 0, (_x, y, z) => [y * PILLAR_WEAR, z * PILLAR_WEAR, 0, 0])
      quads.push(g)
    })
  })

  placed.forEach((p, k) => {
    const s = p.sign
    const inkW = p.w - PAD * 2
    const inkH = p.h - PAD * 2
    const sy = s.height / inkH
    const sx = s.width ? s.width / inkW : sy * SQUEEZE
    const g = new THREE.PlaneGeometry(p.w * sx, p.h * sy)
    mapUV(g, p.x, p.y, p.w, p.h, ATLAS_W, height)
    // Wear in the sign's own plane, shifted per sign so no two wear alike.
    // The grain's tonal patches run about a letter high. A flake is one
    // texel of the detail map's speck channel, so it won't visibly repeat.
    const grain = 1 / (6 * s.height)
    const flake = 1 / (DETAIL_SIZE * s.flake)
    addPaint(g, s.paint, 1, (x, y) => [x * grain + k * 0.37, y * grain + k * 0.61, x * flake + k * 0.29, y * flake + k * 0.53])
    if (s.floor !== undefined) {
      g.rotateX(-Math.PI / 2)
      g.rotateY(s.floor)
    }
    g.translate(...s.at)
    quads.push(g)
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  if (!light) {
    // result = paint factor x what's already there
    material.blending = THREE.CustomBlending
    material.blendSrc = THREE.DstColorFactor
    material.blendDst = THREE.ZeroFactor
    material.blendSrcAlpha = THREE.ZeroFactor
    material.blendDstAlpha = THREE.OneFactor
    material.fog = false
  }
  material.colorNode = Fn(() => {
    const p = positionWorld
    const w = attribute('wear', 'vec4')
    const paint = attribute('paint', 'vec4')
    // All reads come first, as vars: WGSL samples only in uniform control flow.
    const ink = texture(atlas, uv()).x.toVar()
    const grain = texture(detail, w.xy).x.toVar()
    const speck = texture(detail, w.zw).z.toVar()
    if (inMirror) {
      // The floor's mirror would show floor paint a second time.
      If(inMirror.greaterThan(0.5).and(p.y.lessThan(0.05)), () => {
        Discard()
      })
    }
    // Worn paint. Pillar codes: the concrete's grain eats into the letters.
    // Signs: small flakes gone where the specks dip, over an uneven fade.
    const blotches = smoothstep(0.25, 0.55, grain)
    const flakes = smoothstep(0.1, 0.25, speck).mul(grain.mul(0.45).add(0.55))
    const cover = ink.mul(mix(blotches, flakes, paint.w)).mul(0.85)
    if (!light) return vec4(mix(vec3(1), paint.xyz, cover), 1)
    const lit = paint.xyz.mul(PAINT_ALBEDO).mul(light(p, normalize(normalWorld), float(1)))
    return vec4(lit, cover)
  })()

  const mesh = new THREE.Mesh(mergeGeometries(quads), material)
  mesh.renderOrder = 1
  return mesh
}

import * as THREE from 'three/webgpu'

// The room, in meters. The water is the plane y = 0. The forms hang over
// the origin. The camera sits at +z looking toward -z.

/** Direction toward the light that comes through the opening in the ceiling. */
export const KEY_DIR = new THREE.Vector3(-0.3, 1, -0.15).normalize()

export const CEILING_Y = 12
/** The square opening in the ceiling the moonlight falls through. */
export const OPENING = { x: -2.6, z: -2.2, size: 7 }

export interface Shaft {
  /** Where the shaft lands on the water. */
  foot: THREE.Vector3
  radius: number
  strength: number
}

export const SHAFTS: Shaft[] = [
  { foot: new THREE.Vector3(1.3, 0, 0.6), radius: 0.95, strength: 1 },
  { foot: new THREE.Vector3(-1.6, 0, -0.9), radius: 0.7, strength: 0.8 },
  { foot: new THREE.Vector3(0.2, 0, -2.6), radius: 1.2, strength: 0.6 },
]

export function shaftTop(s: Shaft): THREE.Vector3 {
  const k = CEILING_Y / KEY_DIR.y
  return s.foot.clone().addScaledVector(KEY_DIR, k)
}

export const PILLAR_SIZE = 0.9
export const PILLAR_X = [-11.5, -6.4, 6.4, 11.5]
export const PILLAR_Z = [-14, -9, -4, 1, 6]

/** Low lamps on the inner face of the near pillar rows, just above the water. */
export const LAMPS: THREE.Vector3[] = PILLAR_Z.flatMap((z) => [
  new THREE.Vector3(-6.4 + PILLAR_SIZE / 2 + 0.02, 0.85, z),
  new THREE.Vector3(6.4 - PILLAR_SIZE / 2 - 0.02, 0.85, z),
])

/** How bright each lamp in LAMPS burns, 0..1. A few run low, one is out. */
export const LAMP_LEVELS = [1, 0.9, 0.47, 1, 0.95, 0.03, 0.84, 1, 0.63, 0.95]

/**
 * Every form is authored at its own size, then scaled about the pool's centre
 * on the floor so the hero reads as an exhibit in the room, not a billboard:
 * about a third of the frame wide, with hall on every side. Scaling about the
 * floor keeps the forms that touch the water (sluice, jev, hive) touching it.
 */
export const FORM_SCALE = 0.7
export const FORM_CENTER = new THREE.Vector3(0, 2.6 * FORM_SCALE, 0)

/** Pillar lamps: warm, about 3500 K. */
export const LAMP_COLOR = new THREE.Color('#ffc890')
/** Strips in coves, under galleries, on the catwalk: cool white. */
export const STRIP_COLOR = new THREE.Color('#d8ecf5')
export const MOON_COLOR = new THREE.Color('#bcd3e6')
export const FOG_COLOR = new THREE.Color('#02090d')

// ------------------------------------------------------------- room v2
// The pool under the forms: flush with the floor, |x| and |z| below this.
export const POOL_HALF = 4
/** Stone coping around the pool, meters. */
export const COPING = 0.32
/** The halo hanging over the pool. */
export const RING = { y: 8.6, radius: 3.7 }
/** Galleries along both side walls. */
export const MEZZ = { y: 5.2, inner: 10.4, outer: 14.5, z0: -19, z1: 12 }
/** Inner faces of the walls. */
export const WALL = { x: 14.5, back: -19 }
/** The window band high in the back wall, looking out over the harbor. */
export const WINDOWS = { y0: 5.7, y1: 10.5, mullion: 2.9 }
/** Where the harbor backdrop hangs, and the horizon height on it. */
export const HARBOR = { z: -60, horizon: 1.4 }

/** World area the baked floor maps cover. */
export const FLOOR_MAP = { x0: -18, z0: -21, size: 36 }
/** Puddles placed where they catch the most light from the camera: x, z, radius. */
export const PUDDLES: Array<[number, number, number]> = [
  // In front of the pool, where tall forms reflect from the camera's eye.
  [0.4, 7.2, 2.5],
  [-3.1, 5.6, 1.1],
  [3.6, 6.0, 1.2],
  [-7.4, 2.6, 1.7],
  [6.9, -0.8, 1.9],
  [-6.2, -7.6, 2.1],
  [8.6, 5.2, 1.3],
  [-1.6, -9.2, 2.3],
  [4.2, -13.0, 1.9],
  [-10.5, -12.5, 1.6],
]
export const RING_COLOR = new THREE.Color('#e4f1f8')

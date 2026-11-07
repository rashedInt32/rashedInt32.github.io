import * as THREE from 'three/webgpu'
import { Fn, color, densityFogFactor, dot, exp, float, fog, hash, length, max, pass, positionView, pow, renderOutput, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from './tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { HOME, HOME_ACCENT, type Point, type Project, type Scene, type SceneStats, type View } from '../contract'
import { createBasin } from './basin'
import { NAME, SPLASHES, SUBMERGED, formIndex, glassHits, lazydiffHits } from './forms'
import { FOG_COLOR, OPENING, WALL } from './layout'
import { createParticles, rayFrom } from './particles'
import { Governor, pickTier, probeGpu, qualityFor, type Rung } from './quality'
import { bake, detailMaps, floorMaps, shadowMaps, wallMaps } from './bake'
import { createFloor } from './floor'
import { createHarbor } from './harbor'
import { createStencils } from './details'
import { createVolume } from './volume'
import { createLighting } from './lighting'
import { createHall, loadHall } from './hall'
import { createPacer } from './pacer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

interface Options {
  host: HTMLElement
  projects: Project[]
  params: URLSearchParams
}

const MORPH_SECONDS = 2.6
const REVEAL_MS = 3000
// No input and nothing changing shape for this long: drop to 30 fps.
/**
 * Arriving home, the camera drifts in from a little further back and to the
 * side, settling over ten seconds: one slow establishing move (art/SCENE.md).
 */
const ESTABLISH = { ms: 10_000, dist: 1.6, yaw: 0.07, movingUntil: 0.7 }
/** Camera lean toward the pointer: easing rates while following it, and returning home after it leaves. */
const LEAN_FOLLOW = 5
const LEAN_RETURN = 1.8
/** How long the baked hall may take to download before the code-built hall shows instead. */
const HALL_TIMEOUT_MS = 12_000
/** Haze per metre, as in the Blender scene the stills came from (art/build_hall.py). */
const HAZE_DENSITY = 0.011
/** What the haze glows with when it's thick: lamp light scattered in it. Linear. */
const HAZE_COLOR = new THREE.Color().setRGB(0.014, 0.013, 0.012, THREE.LinearSRGBColorSpace)
/** Contrast of the grade, in log space (Blender's AgX looks: Medium High Contrast is 1.2). */
const LOOK_CONTRAST = 1.2
/**
 * Frame pacing (see pacer.ts). Caps snap to whole display refreshes: on a
 * 120 Hz screen 60, 40, 30, 24; on a 60 Hz screen 60, 30, 30, 20.
 */
const PACING = {
  fps: {
    moving: 60, // the camera travelling, a form morphing
    active: 40, // pointer and keys
    reading: 30, // the work page
    idle: 24, // nothing touched for idleMs
  },
  idleMs: 4_000,
  sleepMs: 40_000,
}
// After this long with no input the loop stops entirely: zero cost until the next input.

// Per-project camera: orbit yaw around the form, and distance. Cycled for
// more projects than entries, so neighbours always differ.
interface CameraView {
  yaw: number
  dist: number
  lookY: number
}
const HOME_VIEW: CameraView = { yaw: 0, dist: 13.4, lookY: 2.05 }
// Work: the grains have sunk, the camera turns across the hall toward the
// galleries and the windows, and the page reads over it.
const WORK_VIEW: CameraView = { yaw: 0.62, dist: 10.5, lookY: 3.0 }
const VIEWS: CameraView[] = [
  { yaw: 0.14, dist: 12.8, lookY: 1.9 },
  { yaw: -0.16, dist: 13.6, lookY: 1.8 },
  { yaw: 0.2, dist: 12.6, lookY: 2.0 },
  { yaw: -0.12, dist: 13.0, lookY: 1.9 },
  { yaw: 0.1, dist: 12.8, lookY: 1.8 },
  { yaw: -0.2, dist: 12.6, lookY: 1.7 },
  { yaw: 0.0, dist: 13.0, lookY: 1.8 },
  { yaw: 0.16, dist: 12.8, lookY: 1.95 },
  { yaw: -0.22, dist: 12.8, lookY: 2.1 },
  { yaw: 0.08, dist: 13.0, lookY: 2.1 },
]
/** The work view's `current`: no form, grains under the water. */
const WORK = -3
const viewFor = (index: number): CameraView => (index === WORK ? WORK_VIEW : index < 0 ? HOME_VIEW : VIEWS[index % VIEWS.length]!)
/** Reading down the work page glides the camera across the hall, right to left. */
const workView = (t: number): CameraView => ({
  yaw: WORK_VIEW.yaw - t * 1.05,
  dist: WORK_VIEW.dist + t * 3.2,
  lookY: WORK_VIEW.lookY - t * 0.7,
})
/** `current` before anything is on screen. */
const NONE = -2

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const damp = (from: number, to: number, rate: number, dt: number) => to + (from - to) * Math.exp(-rate * dt)

export function createScene({ host, projects, params }: Options): Scene {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const stats: SceneStats = { fps: 0, tier: 0, backend: 'none', particles: 0 }

  // State the API can touch before init finishes.
  let revealAt = -1
  // When the establishing move started, if the reveal landed on home.
  let establishAt = -1
  // Before reveal, `current` is where the scene will start. HOME unless a
  // deep link says otherwise.
  let current = HOME
  let pending: number | null = null
  let lastProject = 0
  let projectAsked = false
  let workScroll = 0
  const pointer = { ndc: new THREE.Vector2(), on: false, movedAt: 0, active: 0 }
  // How far the camera leans toward the pointer, eased: it follows the mouse
  // with a little give, and glides home when the mouse leaves.
  const lean = new THREE.Vector2()
  let lastInput = performance.now()

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 140)
  camera.position.set(0, 0.06, 13)
  camera.lookAt(0, 0.06, 0)

  let started: ((index: number) => void) | null = null
  let wake: () => void = () => {}

  const ready = (async () => {
    // ?off=volume,bloom,msaa,mirror,haze,grains,baked,plants turns parts off, to measure each one's cost.
    const off = new Set((params.get('off') ?? '').split(',').filter(Boolean))
    // The baked hall downloads while the GPU starts up. Without it (?off=baked,
    // or a failed load) the hall is built from code and lit analytically.
    // A slow link falls back too: past HALL_TIMEOUT_MS the code-built hall
    // shows instead of keeping the visitor waiting.
    const hallAssets = off.has('baked')
      ? Promise.resolve(null)
      : Promise.race([
          loadHall(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${HALL_TIMEOUT_MS / 1000} s`)), HALL_TIMEOUT_MS)),
        ]).catch((err) => {
          console.warn('harbor: baked hall unavailable, building it from code instead', err)
          return null
        })
    const gpu = await probeGpu(params.get('gpu') === 'webgl')
    const tier = pickTier(gpu, params)
    const q = qualityFor(tier)
    if (off.has('bloom')) q.bloom = false
    if (off.has('msaa')) q.samples = 0
    if (off.has('haze')) q.motes = 0
    if (off.has('grains')) q.particles = 2000
    if (off.has('mirror')) q.reflectScale = 0.02
    stats.tier = tier
    stats.backend = gpu.backend
    stats.particles = q.particles

    const renderer = new THREE.WebGPURenderer({
      antialias: false,
      forceWebGL: gpu.backend === 'webgl2',
      powerPreference: 'high-performance',
      // ?perf measures this tab's own GPU time per frame (timestamp queries).
      trackTimestamp: params.has('perf'),
    })
    await renderer.init()
    renderer.toneMapping = THREE.AgXToneMapping
    renderer.toneMappingExposure = 1.0
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = FOG_COLOR.clone()

    // Shared uniforms.
    const time = uniform(0)
    const lightsUp = uniform(0)
    const accent = uniform(new THREE.Color(HOME_ACCENT))
    const formGlow = uniform(0)
    const inMirror = uniform(0)
    // The pointer's light: xyz where it touches the room, w its strength.
    const cursor = uniform(new THREE.Vector4(0, -50, 0, 0))
    const shared = { time, lightsUp, accent, formGlow, inMirror, cursor }

    const fogColor = uniform(FOG_COLOR.clone())

    const governor = new Governor(gpu.id, params, (r) => applyRung(r))
    const rung0 = governor.current()

    // Static detail, computed once into textures.
    const floorMap = bake(renderer, tier >= 2 ? 2048 : 1024, floorMaps(), { mipmaps: true })
    const wallMap = bake(renderer, tier >= 2 ? 1024 : 512, wallMaps(), { mipmaps: true, repeat: true })
    const detailMap = bake(renderer, 512, detailMaps(), { mipmaps: true, repeat: true })
    const { light, live } = createLighting(shared)
    // Built before anything else depends on it: if building fails, every
    // part falls back to the code-built hall together.
    const loaded = await hallAssets
    let hallModel: THREE.Object3D | null = null
    if (loaded) {
      try {
        hallModel = createHall(loaded, shared, { wallMap, detailMap, light, live, msaa: q.samples > 0, plants: !off.has('plants') })
      } catch (err) {
        console.warn('harbor: baked hall failed to build, building it from code instead', err)
      }
    }
    const hall = hallModel ? loaded : null
    stats.baked = !!hall
    // The air. With the baked hall it is the stills' atmosphere: thin haze
    // scattering every lamp's light, so the blacks lift into a soft, warm
    // neutral veil that thickens with distance (exponential, at the bake
    // scene's density). The built hall keeps its fade to the night colour.
    const hazeColor = color(HAZE_COLOR).mul(lightsUp.mul(0.9).add(0.1))
    scene.fogNode = (
      hall ? fog(hazeColor, float(1).sub(exp(length(positionView).mul(-HAZE_DENSITY)))) : fog(fogColor, densityFogFactor(0.022))
    ) as N
    // The analytic light's pillar shadows; the bake has its own.
    const shadowMap = hall ? undefined : bake(renderer, 1024, shadowMaps(), { mipmaps: true })

    const basin = createBasin(shared, { shafts: q.shafts, motes: q.motes, mist: tier >= 2 && !off.has('haze'), wallMap, detailMap, light, baked: !!hall })
    scene.add(basin)
    if (hallModel) scene.add(hallModel)
    scene.add(createHarbor(shared, detailMap))
    if (tier >= 1) scene.add(createStencils(detailMap, hall ? undefined : light, inMirror))

    const water = createFloor(shared, {
      reflectScale: q.reflectScale * rung0.reflectScale,
      detail: tier >= 2,
      floorMap,
      detailMap,
      shadowMap,
      light,
      baked: hall ? { still: hall.maps.floorStatic, form: hall.maps.floorForm, live } : undefined,
      // The floor hazes its own light; its reflection is hazed by the mirror pass.
      haze: hall ? { color: hazeColor, density: HAZE_DENSITY } : undefined,
    })
    scene.add(water.target)
    scene.add(water.mesh)
    // Flag the mirror pass while it renders, so haze layers can skip it.
    const mirror = water.mirror as unknown as { updateBefore(frame: unknown): unknown }
    const renderMirror = mirror.updateBefore.bind(mirror)
    // Haze (shafts, mist, dust) isn't drawn into the mirror at all.
    const haze: THREE.Object3D[] = []
    basin.traverse((o) => {
      if (o.name === 'haze') haze.push(o)
    })
    mirror.updateBefore = (frame: unknown) => {
      inMirror.value = 1
      for (const o of haze) o.visible = false
      try {
        return renderMirror(frame)
      } finally {
        inMirror.value = 0
        for (const o of haze) o.visible = true
      }
    }

    const particles = createParticles(q.particles, q.samples > 0, gpu.backend === 'webgl2')
    scene.add(particles.sprite)
    const pu = particles.uniforms
    pu.lightsUp.value = 0

    // ---------------------------------------------------------- post
    const pipeline = new THREE.RenderPipeline(renderer)
    pipeline.outputColorTransform = false
    const scenePass = pass(scene, camera, { samples: q.samples })
    const beauty = scenePass.getTextureNode('output')
    const grainFrame = uniform(0)

    const volume = q.shafts && !off.has('volume') ? createVolume(shared, camera, scenePass.getTextureNode('depth'), detailMap) : null

    const grade = (withBloom: boolean) => {
      const base: N = withBloom ? beauty.add(bloom(beauty, 0.42, 0.4, 1.0)) : beauty
      const lit: N = volume ? base.add(volume.node) : base
      return Fn(() => {
        const d = length(screenUV.sub(0.5).mul(vec2(1, 0.85)))
        const vignette = smoothstep(0.95, 0.2, d).mul(0.6).add(0.4)
        // Blender's "AgX - Medium High Contrast" look, which the approved
        // stills used: contrast 1.2 in log space around mid grey, before AgX.
        const graded = pow(max(lit.rgb.mul(vignette), 0).div(0.18), LOOK_CONTRAST).mul(0.18)
        const display = renderOutput(vec4(graded, 1))
        // Film grain: refreshed at 24 Hz like film, and quieter in the blacks
        // so dark areas stay inky instead of crawling.
        const seed = screenCoordinate.x.add(screenCoordinate.y.mul(4099)).add(grainFrame.mul(7919))
        const luma = dot(display.rgb, vec3(0.2126, 0.7152, 0.0722))
        const grain = hash(seed).sub(0.5).mul(0.032).mul(smoothstep(0.0, 0.12, luma).mul(0.75).add(0.25))
        return vec4(display.rgb.add(float(grain)), 1)
      })()
    }
    let bloomOn = q.bloom && rung0.bloom
    pipeline.outputNode = grade(bloomOn)

    function applyRung(r: Rung) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr) * r.renderScale)
      water.setReflectScale(q.reflectScale * r.reflectScale)
      particles.sprite.count = Math.floor(q.particles * r.particleShare)
      stats.particles = particles.sprite.count
      const wantBloom = q.bloom && r.bloom
      if (wantBloom !== bloomOn) {
        bloomOn = wantBloom
        pipeline.outputNode = grade(bloomOn)
        pipeline.needsUpdate = true
      }
    }

    // --------------------------------------------------------- sizing
    const fit = () => {
      const w = innerWidth
      const h = innerHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      // Keep ~9.5 m of width in view at the form, however narrow the screen.
      const halfWidth = Math.atan(4.75 / 13)
      const needed = (2 * Math.atan(Math.tan(halfWidth) / camera.aspect) * 180) / Math.PI
      camera.fov = Math.min(74, Math.max(36, needed))
      // On wide screens the project panel takes the right third, so slide
      // the picture left to keep the form clear of it.
      const halo = basin.getObjectByName('halo')
      if (halo) halo.visible = camera.aspect >= 1
      // The panel takes the right side on anything wider than a phone; slide
      // the picture left so the form clears it, more on squarer windows.
      const shift = w <= 700 ? 0 : camera.aspect > 1.15 ? 0.07 : camera.aspect > 0.8 ? 0.11 : 0
      if (shift > 0) camera.setViewOffset(w, h, Math.round(w * shift), 0, w, h)
      else camera.clearViewOffset()
      camera.updateProjectionMatrix()
    }
    applyRung(rung0)
    fit()
    // A resize clears the canvas: draw again right away, even from sleep.
    addEventListener('resize', () => {
      fit()
      lastInput = performance.now()
      pacer.reset()
      wake()
    })

    // First compute to place every grain, then compile everything before
    // the user can press Enter, so the reveal doesn't stutter.
    pu.formA.value = SUBMERGED
    pu.formB.value = SUBMERGED
    pu.morph.value = 1
    renderer.compute(particles.init)
    await renderer.compileAsync(scene, camera)
    pipeline.render()

    // --------------------------------------------------------- motion
    let morphT = 1
    const accentTarget = new THREE.Color(HOME_ACCENT)
    const view = { ...HOME_VIEW }
    const look = new THREE.Vector3()
    const rayO = new THREE.Vector3()
    const rayD = new THREE.Vector3()
    const lastWake = new THREE.Vector3(1e3, 0, 0)
    const splashCarry: number[] = []
    let simTime = 0
    const pacer = createPacer(PACING)
    // setAnimationLoop(null) only drops the callback: three's own frame
    // requests keep firing every refresh. Stop those too, so sleep is sleep.
    const stopLoop = () => {
      renderer.setAnimationLoop(null)
      ;(renderer as unknown as { _animation?: { stop(): void } })._animation?.stop()
    }
    let fpsEma = 60
    let revealDrops = 0
    // ?perf exposes per-frame JS cost on window.__harbor for tuning.
    const perf = params.has('perf') ? { cpuMs: 0, gpuMs: 0, fps: 0, rung: 0, frames: 0, inputs: 0, leanX: 0, camDist: 0 } : null
    if (perf) (window as unknown as { __harbor: typeof perf }).__harbor = perf
    let gpuReading = false
    let gpuFrom = 0
    let glassCarry = 0
    let dripCarry = 0

    const startMorph = (index: number) => {
      pu.formA.value = pu.formB.value
      pu.formB.value = index === HOME ? NAME : index === WORK ? SUBMERGED : formIndex(projects[index]!.id)
      pu.morph.value = 0
      morphT = 0
      current = index
      accentTarget.set(index < 0 ? HOME_ACCENT : projects[index]!.accent)
    }

    started = (index: number) => {
      if (revealAt < 0) {
        current = index
        return
      }
      if (morphT < 1) {
        pending = index
        return
      }
      if (index !== current || (pu.formB.value === SUBMERGED && index !== WORK)) startMorph(index)
    }

    const tick = (now: number) => {
      const frame = pacer.frame(now, {
        sinceInput: now - lastInput,
        settled:
          morphT >= 1 &&
          (revealAt < 0 || now - revealAt > REVEAL_MS) &&
          (establishAt < 0 || now - establishAt > ESTABLISH.ms * ESTABLISH.movingUntil),
        reading: current === WORK,
        canSleep: revealAt >= 0,
      })
      if (frame.kind === 'sleep') {
        // Long idle: stop until the next input.
        sleeping = true
        stopLoop()
        return
      }
      if (frame.kind === 'skip') return
      const { dt, idle } = frame
      const workStart = performance.now()
      if (frame.ms > 0) {
        fpsEma += (1000 / frame.ms - fpsEma) * 0.08
        // Not while things are still compiling: the reveal and a moment after.
        if (!idle && revealAt >= 0 && now - revealAt > REVEAL_MS + 2500) governor.sample(frame.lateness, now)
      }
      stats.fps = Math.round(fpsEma)

      const timeScale = reduced ? 0.45 : 1
      simTime += dt * timeScale
      time.value = simTime
      pu.time.value = simTime
      // Small period keeps the seed inside float32's exact range.
      grainFrame.value = Math.floor(simTime * 24) % 509
      pu.dt.value = dt

      // Reveal.
      const revealK = revealAt < 0 ? 0 : clamp01((now - revealAt) / REVEAL_MS)
      const rise = ease(revealK)
      lightsUp.value = revealAt < 0 ? 0 : ease(clamp01((now - revealAt - 300) / (REVEAL_MS - 300)))
      pu.lightsUp.value = lightsUp.value
      formGlow.value = damp(formGlow.value, revealAt < 0 ? 0 : current === WORK ? 0.4 : 2.2, 1.6, dt)

      // Morph between forms, then start the queued one.
      if (morphT < 1) {
        morphT = Math.min(1, morphT + (dt / MORPH_SECONDS) * (pending !== null ? 1.8 : 1))
        pu.morph.value = morphT
      } else if (pending !== null) {
        const p = pending
        pending = null
        if (p !== current) startMorph(p)
      }
      const a = accent.value as THREE.Color
      a.lerp(accentTarget, 1 - Math.exp(-dt * 2.5))

      // Camera.
      const v = current === WORK ? workView(workScroll) : viewFor(current)
      view.yaw = damp(view.yaw, v.yaw, 1.4, dt)
      view.dist = damp(view.dist, v.dist, 1.4, dt)
      view.lookY = damp(view.lookY, v.lookY, 1.4, dt)
      pointer.active = damp(pointer.active, pointer.on && now - pointer.movedAt < 1600 ? 1 : 0, 3, dt)
      const sway = reduced ? 0 : 1
      const tx = pointer.on && !reduced ? pointer.ndc.x : 0
      const ty = pointer.on && !reduced ? pointer.ndc.y : 0
      // Quick to follow, slow to return: an ease-out of about two seconds
      // after the mouse leaves, ending exactly where it started.
      const leanRate = pointer.on ? LEAN_FOLLOW : LEAN_RETURN
      lean.set(damp(lean.x, tx, leanRate, dt), damp(lean.y, ty, leanRate, dt))
      if (Math.abs(lean.x - tx) < 1e-4 && Math.abs(lean.y - ty) < 1e-4) lean.set(tx, ty)
      const px = lean.x
      const py = lean.y
      if (perf) perf.leanX = lean.x
      const eyeY = 0.06 + (2.35 - 0.06) * rise
      const lookY = 0.06 + (view.lookY - 0.06) * rise
      // The establishing move fades on its own clock, so leaving home during
      // it just blends into the next view's own easing.
      // Before the reveal it already holds its starting offset: no jump.
      const est =
        establishAt >= 0
          ? (1 - clamp01((now - establishAt) / ESTABLISH.ms)) ** 3
          : revealAt < 0 && current === HOME && !reduced
            ? 1
            : 0
      const camYaw = view.yaw + ESTABLISH.yaw * est
      const camDist = view.dist + ESTABLISH.dist * est
      const ex = Math.sin(camYaw) * camDist + (Math.sin(simTime * 0.13) * 0.14 * sway + px * 0.35) * rise
      const ez = Math.cos(camYaw) * camDist
      if (perf) perf.camDist = camDist
      camera.position.set(ex, eyeY + (Math.sin(simTime * 0.17) * 0.06 * sway + py * 0.16) * rise, ez)
      look.set(0, lookY, 0)
      camera.lookAt(look)
      camera.updateMatrixWorld()

      // Pointer ray for the grains and the wake.
      rayFrom(camera, pointer.ndc, rayO, rayD)
      ;(pu.pointerOrigin.value as THREE.Vector3).copy(rayO)
      ;(pu.pointerDir.value as THREE.Vector3).copy(rayD)
      pu.pointerOn.value = revealK >= 1 ? pointer.active : 0

      // The pointer's light: where its ray first meets the floor or a wall,
      // lifted a little off the surface. It fades in on movement and out
      // a couple of seconds after the mouse rests.
      {
        let best = Infinity
        let nx = 0
        let ny = 1
        let nz = 0
        const tryPlane = (t: number, ax: number, ay: number, az: number) => {
          if (t > 0.1 && t < best) {
            best = t
            nx = ax
            ny = ay
            nz = az
          }
        }
        if (rayD.y < -1e-4) tryPlane(-rayO.y / rayD.y, 0, 1, 0)
        if (rayD.z < -1e-4) tryPlane((WALL.back - rayO.z) / rayD.z, 0, 0, 1)
        if (rayD.x > 1e-4) tryPlane((WALL.x - rayO.x) / rayD.x, -1, 0, 0)
        if (rayD.x < -1e-4) tryPlane((-WALL.x - rayO.x) / rayD.x, 1, 0, 0)
        const c = cursor.value as THREE.Vector4
        const want = pointer.on && revealK >= 1 && now - pointer.movedAt < 2400 && best < 60 ? 1 : 0
        if (best < 60) {
          const lift = 0.35
          const tx = rayO.x + rayD.x * best + nx * lift
          const ty = rayO.y + rayD.y * best + ny * lift
          const tz = rayO.z + rayD.z * best + nz * lift
          // Follow quickly but not rigidly, like a hand-held light.
          const k = c.w < 0.02 ? 1 : 1 - Math.exp(-dt * 14)
          c.x += (tx - c.x) * k
          c.y += (ty - c.y) * k
          c.z += (tz - c.z) * k
        }
        c.w = damp(c.w, want, want > c.w ? 6 : 1.6, dt)
      }
      volume?.tick()

      if (pointer.on && revealK >= 1 && rayD.y < -0.01) {
        const k = -rayO.y / rayD.y
        const hx = rayO.x + rayD.x * k
        const hz = rayO.z + rayD.z * k
        if (Math.abs(hx) < 14 && hz > -18 && hz < 9 && Math.hypot(hx - lastWake.x, hz - lastWake.z) > 0.45) {
          water.drop(hx, hz, 0.45, simTime)
          lastWake.set(hx, 0, hz)
        }
      }

      // Drips from the opening in the ceiling, into the pool and puddles below it.
      dripCarry += dt * timeScale * 1.3
      while (revealAt >= 0 && dripCarry >= 1) {
        dripCarry -= 1
        water.drop(OPENING.x + (Math.random() - 0.5) * OPENING.size, OPENING.z + (Math.random() - 0.5) * OPENING.size, 0.3, simTime)
      }

      // Splashes from the active form.
      if (revealAt >= 0 && revealDrops < 18 && now - revealAt > revealDrops * 120 + 500) {
        const ang = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random()) * 2.8
        water.drop(Math.cos(ang) * r, Math.sin(ang) * r, 0.7, simTime)
        revealDrops++
      }
      if (morphT >= 1 && revealAt >= 0 && pu.formB.value === formIndex('glass')) {
        glassCarry += 0.4 * glassHits(simTime).length * dt * timeScale
        while (glassCarry >= 1) {
          glassCarry -= 1
          const hits = glassHits(simTime)
          const [hx, hz] = hits[Math.floor(Math.random() * hits.length)]!
          water.drop(hx + (Math.random() - 0.5) * 0.1, hz + (Math.random() - 0.5) * 0.1, 0.4, simTime)
        }
      }
      if (morphT >= 1 && revealAt >= 0 && pu.formB.value === formIndex('lazydiff')) {
        for (const [hx, hz] of lazydiffHits(simTime - dt * timeScale, simTime)) water.drop(hx, hz, 0.45, simTime)
      }
      if (morphT >= 1 && revealAt >= 0) {
        const list = SPLASHES[pu.formB.value as number] ?? []
        list.forEach((s, i) => {
          splashCarry[i] = (splashCarry[i] ?? 0) + s.rate * dt * timeScale
          while (splashCarry[i]! >= 1) {
            splashCarry[i]! -= 1
            water.drop(s.x[0] + Math.random() * (s.x[1] - s.x[0]), s.z[0] + Math.random() * (s.z[1] - s.z[0]), s.amp, simTime)
          }
        })
      }

      renderer.compute(particles.update)
      pipeline.render()
      if (perf) {
        const ms = performance.now() - workStart
        perf.cpuMs += (ms - perf.cpuMs) * 0.05
        perf.fps = stats.fps
        perf.rung = governor.rung
        perf.frames++
        // One read in flight at a time; divide by the frames it actually covers.
        if (!gpuReading) {
          gpuReading = true
          const p = perf
          const since = p.frames - gpuFrom
          gpuFrom = p.frames
          Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')])
            .then(([r, c]) => {
              const ms = ((r ?? 0) + (c ?? 0)) / Math.max(1, since)
              if (ms > 0 && since > 0) p.gpuMs += (ms - p.gpuMs) * 0.2
            })
            .catch(() => {})
            .finally(() => {
              gpuReading = false
            })
        }
      }
    }

    // Only run while the tab is visible and someone is around.
    let sleeping = false
    wake = () => {
      if (!sleeping || document.hidden) return
      sleeping = false
      loop(true)
    }
    const loop = (on: boolean) => {
      if (on) {
        pacer.reset()
        governor.reset()
        renderer.setAnimationLoop(tick)
      } else stopLoop()
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        lastInput = performance.now()
        sleeping = false
      }
      loop(!document.hidden)
    })
    loop(!document.hidden)

    // Enter may have been pressed while we were still compiling.
    if (revealAt >= 0 && pu.formB.value === SUBMERGED) {
      const index = current
      current = NONE
      started(index)
    }
  })()

  // Don't leave an unhandled rejection if nobody awaits `ready` yet.
  ready.catch(() => {})

  const go = (index: number) => {
    if (started) started(index)
    else current = index
  }

  return {
    ready,
    reveal() {
      if (revealAt >= 0) return REVEAL_MS
      revealAt = performance.now()
      lastInput = revealAt
      if (current === HOME && !reduced) establishAt = revealAt
      if (started) {
        const index = current
        current = NONE
        started(index)
      }
      return REVEAL_MS
    },
    setView(view: View) {
      lastInput = performance.now()
      wake()
      if (view === 'home') go(HOME)
      else if (view === 'work') go(WORK)
      else {
        // The overlay sends setProject right after when it knows which one;
        // otherwise show the last project seen.
        projectAsked = false
        queueMicrotask(() => {
          if (!projectAsked) go(lastProject)
        })
      }
    },
    setWorkScroll(t: number) {
      workScroll = Math.min(1, Math.max(0, t))
      lastInput = performance.now()
      wake()
    },
    setProject(index: number) {
      lastInput = performance.now()
      wake()
      projectAsked = true
      if (index >= 0) lastProject = index
      go(index)
    },
    setPointer(p: Point | null) {
      const now = performance.now()
      const w = window as unknown as { __harbor?: { inputs: number } }
      if (w.__harbor) w.__harbor.inputs++
      lastInput = now
      wake()
      if (!p) {
        pointer.on = false
        return
      }
      pointer.on = true
      pointer.movedAt = now
      pointer.ndc.set(p.x, p.y)
    },
    horizonY() {
      const v = new THREE.Vector3(0, 0, -80).project(camera)
      return ((1 - v.y) / 2) * innerHeight
    },
    stats: () => ({ ...stats }),
  }
}

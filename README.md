# harbor

My portfolio. A concrete hall at night with a flush pool in the middle. The
tools I've built rise out of it one at a time as shapes made of grains: a
diff that sinks and rises, a crystal splitting moonlight, an ensō, a hive, a
lock, a sluice gate, a vortex, an hourglass, a quilt, a loom.

You enter by typing `cd ~/harbor` at a prompt. The prompt line becomes the
water line, the camera rises, and the grains spell my name. `j`/`k`, the
wheel or a swipe moves through the work.

## run

```sh
bun install
bun run dev        # http://localhost:5199
bun run build      # typecheck + production build into dist/
```

## how it stays cheap

- three.js WebGPU with TSL shaders; WebGL2 fallback when WebGPU is missing.
- The hall is built and lit in Blender (`art/`), then baked. Every static
  light (lamps, moon, strips, booth) and its bounce is in textures. The
  form's light is baked in white and tinted live with each project's colour,
  so it keeps soft shadows and bounce without a light in the scene. The
  pointer's light is the only other live one.
- Trees are impostors: Blender renders of the real plants, lit in place, on
  quads that turn to face the camera. The meshes would be millions of
  triangles; these are seven quads.
- Moon shafts, haze and the pointer's glow are integrated along each view ray
  in closed form, at a third of the resolution. No ray marching.
- The floor's reflection is one extra render at half resolution with
  mipmaps, so damp concrete can read a blurred level and puddles a sharp one.
- Renders at 1x and lets the grain and the dark do the rest. Four quality
  tiers picked from the GPU, plus a governor that steps down when frames run
  late against their cap and remembers that per GPU for a week.
- A project's page (`#/projects/<id>/case`, Enter on a project) stops the
  loop and sits over the last frame, blurred once by the compositor. On the
  work page the hall dissolves into points sampled from its own surfaces at
  load (`src/scene/cloud.ts`): one sprite, half the grain budget, and the
  hall's materials cut themselves away on the same uniform.
- Frame caps snap to whole display refreshes so frames stay evenly spaced:
  60 fps while the camera travels, 40 while you interact (30 on a 60 Hz
  screen), 30 on the work page, 24 after 4 s without input (20 on 60 Hz).
  After 40 s without input the loop stops until the next mouse move or key.
  Hidden tab, no frames.

## flags

| flag | what |
| --- | --- |
| `?tier=0..3` | force a quality tier |
| `?gpu=webgl` | force the WebGL2 path |
| `?gov=off` | disable the governor; `?gov=40` lets frames run up to 50% late |
| `?off=volume,bloom,msaa,mirror,haze,grains,baked,plants,cloud` | turn parts off to measure each one's cost; `baked` builds the hall from code instead; `cloud` keeps the hall solid on the work page |
| `?perf` | per-frame JS cost and frame count on `window.__harbor` |
| `?floor=wet\|tone\|ao\|rough` | paint one floor channel instead of the floor |
| `?vol=depth` | paint the volume pass's ray length |
| `?noscene` | the overlay alone, against a stub scene |
| `#/`, `#/projects/<id>`, `#/projects/<id>/case`, `#/work` | open on home, a project (e.g. `#/projects/glass`), its page, or the work history |

## measuring

`art/sample_gpu.sh <label> [seconds]` (macOS) samples whole-device GPU
utilisation and Chrome's renderer and GPU-process CPU share with the site in
the front tab. Numbers from 2026-11-07 at 1440x900, the blank-tab baseline
being 8% GPU:

| what | GPU | renderer CPU | GPU process CPU |
| --- | --- | --- | --- |
| home or a project, mouse moving | 25% | 10% | 13% |
| a project's page (loop stopped) | 9% | 0.4% | 0.9% |
| work page, hall as points | 21% | 10% | 13% |
| bricelab.dev, same window, for scale | 73% | 19% | 32% |

## the hall

Built by script in Blender 5.2 from `art/SCENE.md`. Needs `cwebp` and bun
(for `gltfpack`).

```sh
python3 art/fetch_assets.py                      # CC0 assets into art/assets/
blender -b --factory-startup -P art/build_hall.py -- --render     # review stills into art/renders/
blender -b --factory-startup -P art/build_hall.py -P art/bake_hall.py -- --samples 512   # bake into public/hall/
```

The bake writes `public/hall/`: the hall as one compressed glb, light maps
for the concrete, the floor and the props, and the tree impostors. Light is
stored as log2 per channel in 8-bit WebP; `src/scene/hall.ts` decodes it.

## where things live

- `src/contract.ts`: the seam between the scene and the overlay.
- `src/projects.ts`, `src/about.ts`: the projects, my profile and work history.
- `src/scene/forms.ts`: every shape, as GPU math. `particles.ts` moves the grains.
- `src/scene/hall.ts`: the baked hall, its materials and the tree impostors.
- `src/scene/cloud.ts`: the hall as points, for the work page, and the dissolve cut.
- `src/scene/floor.ts`, `volume.ts`, `basin.ts`, `lighting.ts`, `layout.ts`: the
  floor and pool, the light in the air, the halo and haze, the live light.
  `basin.ts` also builds the whole hall from code when the bake is missing.
- `src/scene/pacer.ts`: frame caps, idle and sleep.
- `src/scene/index.ts`: renderer, camera, post, morphs, quality.
- `src/ui/`: the prompt, the HUD (index, panel, callout line, a project's page), the statusline, input.
- Type: JetBrains Mono for everything that reads as an instrument; Manrope,
  light, for titles only (`--display` in `src/styles.css`).
- `art/`: the Blender scripts and the scene's design notes.

## credits

The props, trees and plants in the hall are CC0 models from
[Poly Haven](https://polyhaven.com) (license: https://polyhaven.com/license):
pine_sapling_medium, island_tree_02, fern_02, potted_plant_02,
wooden_crate_01, wooden_crate_02, old_military_crate, industrial_storage_cart,
hanging_industrial_lamp, painted_wooden_bench, life_jacket, WetFloorSign_01,
Barrel_02, desk_lamp_arm_01, SchoolChair_01, clipboard, metal_toolbox,
vintage_binocular.

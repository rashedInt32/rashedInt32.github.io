# Background rework: decisions

Settled in a grill-me session, 2026-11-07. This is the contract for the hall
rework and the Blender bake. Change it here first, then in the scene.

## Space and story
- Keep the bones: concrete hall, flush pool in the middle, forms over it,
  the harbor outside the windows and down the drain channel.
- Story: a reclaimed harbor hall, now a quiet gallery at night. Industrial
  bones, nature creeping back, traces of people. Every prop has a reason.
- Night after rain: wet floor, moonlight through the opening, harbor lights
  outside. Optional faint drizzle in the moon beams only, if it fits budget.

## Zones (the pool and the space above it stay clear)
- Left, between pillars: two concrete planters with coastal black pines
  (or the closest CC0 sculpted conifer), ferns and moss at their feet, a
  bench facing the pool, moss in floor cracks.
- Back, under the catwalk: crates on a pallet, a cart with a work lamp,
  coiled cables, a ladder leaning on the catwalk.
- Right, between pillars: one more planter with a pine and ferns, plus a
  bench and the wet floor sign by the pool. Added after the first stills:
  the left zone sits under the text panel in the home view, so home looked
  empty without it. Each planter has a small warm uplight.
- Right gallery, at the corner with the catwalk: a small glass office booth,
  warm light inside, desk, chair, faint monitor glow, shelves, a jacket on
  the chair. No people. Trailing plants over the railing. Moved to the
  corner so the home and glass views can see it.
- Floor: leaves near the trees, puddles, a drain grate.
- Foreground: a planter corner with plants, bottom left, near silhouette,
  clear of the text panels.

## Structure
- Overhead gantry crane on rails along the galleries: dark weathered steel,
  faded hazard yellow only on the hook block and a few warning stripes.
- Industrial pendant lamps from the beams, some lit warm, some dark.
- Cable trays along one wall only. No pipe clutter.
- A painted-over skylight fills the opening, with a few panes gone right
  where the site's three shafts start. The moon comes through as beams,
  not as one wide block of light.

## Light accents (signs of life)
- Warm booth, green exit sign over a side door, the cart's work lamp,
  a faint screen glow in the booth.

## Signage (faded, low contrast)
- Large painted hall number on the back wall above the channel.
- Bay codes on the floor near the walls.
- Safety stencils: no-entry by the channel, load limit on the catwalk.
- The existing pillar grid codes.

## Vegetation
- Static, fully baked. No ivy (bricelab uses ivy, juniper, yew; stay apart).

## Assets
- CC0 only (verified on the asset page), credited in the README.
- Architecture and simple props scripted in Blender (scripts live in art/).

## Camera
- Today's framing per project, the home view, the work-scroll glide.
- Add one slow establishing move on home. Detail goes where the eye goes.

## Budget
- Measured 2026-11-07 with art/sample_gpu.sh at 1440x900 (blank tab 8%):
  home or a project 25% GPU, work page 21%, a project's page 9%. bricelab.dev
  in the same window: 73%. Hold the line at or under 30% for any view.
- GPU: active at or under 44% at the owner's window (~1546x1525 CSS).
  Changed 2026-11-07 at the owner's request, "everything lower": caps snap
  to whole display refreshes, 60 moving, 40 interacting, 30 reading, 24 idle
  after 4 s, sleep after 40 s (src/scene/pacer.ts).
- Download: about 6 MB total at most. The baked hall is 3.2 MB.
- First paint: the prompt shows instantly while the 3D loads.

## Process
1. Build and dress the hall in Blender by script; bake lighting (static
   lights only; the form's light and the pointer stay live on top).
2. Render stills from three of the site's camera views for review.
3. Integrate into the site only after approval.

## Closer to the reference (2026-11-07)
Decided after comparing with bricelab.dev side by side. Keep the identity
(terminal, lowercase mono, the vim statusline); borrow the exhibit read.
- Forms are authored at full size and scaled by FORM_SCALE (0.7) about the
  pool's centre on the floor (src/scene/layout.ts): about a third of the
  frame, hall on every side, water contact kept.
- The name is 3.2 m wide. The home panel says one line; the paragraphs
  moved to the work page.
- A callout line runs from the title to the form's shoulder (ANCHOR in
  src/scene/index.ts, drawn by src/ui/hud.ts). Mono labels are 11 px
  uppercase, 0.08 em tracked; titles are Manrope light.
- The form burns at FORM_GLOW 2.9 against the bake's 2.2, lights a pocket of
  mist at its foot, and the volume pass pools a second glow at the water.
- Two more impostors stand in the aisles beside the pool (plants.json, the
  last two). They reuse pictures baked for other spots, so their light is
  slightly wrong; rebake with them in place when the hall is next rebuilt.
- Work page: the hall dissolves into points (src/scene/cloud.ts).
- A project's page sits over a frozen, blurred frame (#/projects/<id>/case).
  Its copy comes from Project.case in src/projects.ts, still to be written.

## Integration (stills approved 2026-11-07)
- Baked: every static light and its bounce, into light maps for the
  concrete, the floor and the props. The form's light is baked once in
  white and tinted live with the project's colour, so it keeps soft shadows.
- Live: the form's tint and glow, the pointer's light, the halo, the moon
  shafts and haze (closed form, src/scene/volume.ts), the floor's mirror,
  the grains, the harbor.
- Concrete keeps the site's own albedo and relief; only its light is baked.
  Props carry their baked colour.
- Plants ship as impostors: the real CC0 trees are 1.5 to 1.9 million
  triangles each. One Blender render per plant, lit in place, on a quad
  that turns about the vertical to face the camera. Measured cost: none
  above noise.
- Signage is drawn by the site as multiply decals (src/scene/details.ts),
  not baked: the worn paint is see-through, which a light-map bake can't hold.
- The foreground planter has two recessed floor washers so it reads as lit
  concrete, not a black slab.

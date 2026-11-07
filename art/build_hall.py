"""
Build the Night Harbor hall in Blender, from the same numbers the site uses
(src/scene/layout.ts), dress it per art/SCENE.md, light it, and render review
stills from the site's camera views.

    blender -b -P art/build_hall.py -- --render [--samples 96] [--views home,glass,work]

Writes art/hall.blend and art/renders/<view>.png. Coordinates in this file are
the site's (three.js: y up, camera at +z looking toward -z). P() converts them
to Blender's (z up), the same mapping the glTF exporter undoes on export.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
RENDERS = os.path.join(HERE, "renders")
ASSETS = os.path.join(HERE, "assets")

# ---------------------------------------------------------------- layout
# Mirrors src/scene/layout.ts. Keep the two in step.
CEILING_Y = 12.0
OPENING = dict(x=-2.6, z=-2.2, size=7.0)
PILLAR_SIZE = 0.9
PILLAR_X = [-11.5, -6.4, 6.4, 11.5]
PILLAR_Z = [-14, -9, -4, 1, 6]
LAMP_LEVELS = [1, 0.9, 0.47, 1, 0.95, 0.03, 0.84, 1, 0.63, 0.95]
POOL_HALF = 4.0
COPING = 0.32
MEZZ = dict(y=5.2, inner=10.4, outer=14.5, z0=-19.0, z1=12.0)
WALL = dict(x=14.5, back=-19.0)
WINDOWS = dict(y0=5.7, y1=10.5, mullion=2.9)
FORM_CENTER = (0.0, 2.6, 0.0)
KEY_DIR = (-0.3, 1.0, -0.15)
# Where each moon shaft lands on the water, and its radius (src/scene/layout.ts SHAFTS).
SHAFT_FEET = [(1.3, 0.6, 0.95), (-1.6, -0.9, 0.7), (0.2, -2.6, 1.2)]
BOTTOM = -0.4


def P(x, y, z):
    """Site coordinates (y up, +z toward the camera) to Blender (z up)."""
    return (x, -z, y)


def srgb(hex_):
    h = hex_.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return (lin[0], lin[1], lin[2], 1.0)


# --------------------------------------------------------------- materials
def new_material(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except (AttributeError, TypeError):
        pass
    return m


def socket(sockets, name, kind):
    """Mix nodes repeat socket names per data type; pick by name and type."""
    return next(x for x in sockets if x.name == name and x.type == kind)


def principled(name, color=(0.2, 0.2, 0.2, 1), rough=0.8, metal=0.0, emit=None, emit_strength=0.0):
    m = new_material(name)
    nt = m.node_tree
    p = nt.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = color
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit is not None:
        p.inputs["Emission Color"].default_value = emit
        p.inputs["Emission Strength"].default_value = emit_strength
    return m


def concrete(name, base=0.2, scale=1.0, wet=False):
    """Board-formed concrete: blotchy tone, fine grain, horizontal board seams as bump."""
    m = new_material(name)
    nt = m.node_tree
    n = nt.nodes
    l = nt.links
    p = n.get("Principled BSDF")
    coord = n.new("ShaderNodeTexCoord")
    big = n.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 0.5 * scale
    big.inputs["Detail"].default_value = 6
    fine = n.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 18 * scale
    fine.inputs["Detail"].default_value = 8
    l.new(coord.outputs["Object"], big.inputs["Vector"])
    l.new(coord.outputs["Object"], fine.inputs["Vector"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (base * 0.45, base * 0.46, base * 0.47, 1)
    ramp.color_ramp.elements[1].color = (base * 1.35, base * 1.33, base * 1.3, 1)
    l.new(big.outputs["Fac"], ramp.inputs["Fac"])
    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.35
    l.new(ramp.outputs["Color"], socket(mix.inputs, "A", "RGBA"))
    l.new(fine.outputs["Color"], socket(mix.inputs, "B", "RGBA"))
    l.new(socket(mix.outputs, "Result", "RGBA"), p.inputs["Base Color"])
    # Board seams every 50 cm, as shallow grooves.
    wave = n.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 1.0
    wave.inputs["Distortion"].default_value = 0.4
    sep = n.new("ShaderNodeMath")
    sep.operation = "POWER"
    sep.inputs[1].default_value = 12
    l.new(wave.outputs["Fac"], sep.inputs[0])
    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06 if wet else 0.25
    add = n.new("ShaderNodeMath")
    add.operation = "ADD"
    l.new(sep.outputs["Value"], add.inputs[0])
    l.new(fine.outputs["Fac"], add.inputs[1])
    l.new(add.outputs["Value"], bump.inputs["Height"])
    l.new(bump.outputs["Normal"], p.inputs["Normal"])
    if wet:
        # Puddles where a low noise dips: glossy and dark; damp elsewhere.
        wn = n.new("ShaderNodeTexNoise")
        wn.inputs["Scale"].default_value = 0.22
        wn.inputs["Detail"].default_value = 4
        l.new(coord.outputs["Object"], wn.inputs["Vector"])
        wr = n.new("ShaderNodeValToRGB")
        wr.color_ramp.elements[0].position = 0.42
        wr.color_ramp.elements[0].color = (0.04, 0.04, 0.04, 1)
        wr.color_ramp.elements[1].position = 0.6
        wr.color_ramp.elements[1].color = (0.75, 0.75, 0.75, 1)
        l.new(wn.outputs["Fac"], wr.inputs["Fac"])
        l.new(wr.outputs["Color"], p.inputs["Roughness"])
    else:
        p.inputs["Roughness"].default_value = 0.88
    return m


def emissive(name, hex_, strength):
    m = new_material(name)
    nt = m.node_tree
    p = nt.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (0, 0, 0, 1)
    p.inputs["Emission Color"].default_value = srgb(hex_)
    p.inputs["Emission Strength"].default_value = strength
    return m


# ----------------------------------------------------------------- helpers
COLL = {}


def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLL[name] = c
    return COLL[name]


def link(obj, collection):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    coll(collection).objects.link(obj)


def box(name, w, h, d, x, y, z, mat, collection="arch", bevel=0.0, rot=0.0):
    """A box w (x) × h (up) × d (depth along site z), centered at site (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, rot)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
    o.data.materials.append(mat)
    link(o, collection)
    return o


def cyl(name, r, h, x, y, z, mat, collection="props", axis="y", verts=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    if axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "z":
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.data.materials.append(mat)
    link(o, collection)
    return o


def area_light(name, x, y, z, size, power, hex_, target=None, size_y=None, collection="lights"):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = srgb(hex_)[:3]
    data.shape = "RECTANGLE"
    data.size = size
    data.size_y = size_y if size_y is not None else size
    o = bpy.data.objects.new(name, data)
    o.location = P(x, y, z)
    coll(collection).objects.link(o)
    if target:
        aim(o, target)
    return o


def point_light(name, x, y, z, power, hex_, radius=0.1, collection="lights"):
    data = bpy.data.lights.new(name, "POINT")
    data.energy = power
    data.color = srgb(hex_)[:3]
    data.shadow_soft_size = radius
    o = bpy.data.objects.new(name, data)
    o.location = P(x, y, z)
    coll(collection).objects.link(o)
    return o


def spot_light(name, x, y, z, power, hex_, target, angle=0.9, collection="lights"):
    data = bpy.data.lights.new(name, "SPOT")
    data.energy = power
    data.color = srgb(hex_)[:3]
    data.spot_size = angle
    data.spot_blend = 0.6
    data.shadow_soft_size = 0.05
    o = bpy.data.objects.new(name, data)
    o.location = P(x, y, z)
    coll(collection).objects.link(o)
    aim(o, target)
    return o


def aim(o, target_site):
    import mathutils

    t = mathutils.Vector(P(*target_site))
    d = t - o.location
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# ------------------------------------------------------------------ assets
LIB = {}
ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
FG_TREE = ARGV[ARGV.index("--fgtree") + 1] if "--fgtree" in ARGV else "pine"
SUFFIX = ARGV[ARGV.index("--suffix") + 1] if "--suffix" in ARGV else ""
PCT = int(ARGV[ARGV.index("--pct") + 1]) if "--pct" in ARGV else 100
# Tuning overrides: --sun W/m², --density for the haze.
SUN = float(ARGV[ARGV.index("--sun") + 1]) if "--sun" in ARGV else 24.0
DENSITY = float(ARGV[ARGV.index("--density") + 1]) if "--density" in ARGV else 0.011


def load_asset(asset_id):
    """Import a CC0 asset once into a hidden library collection."""
    if asset_id in LIB:
        return LIB[asset_id]
    import glob

    path = glob.glob(os.path.join(ASSETS, asset_id, "*.gltf"))[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        link(o, "library")
    LIB[asset_id] = new
    return new


def place(asset_id, x, y, z, rot=0.0, scale=1.0, only=None, collection="props"):
    """Instance an asset (sharing its mesh data) at site (x, y, z), turned `rot`
    about the vertical. `only` picks variants by name prefix; a single picked
    variant is re-centred on its own origin."""
    import mathutils

    parts = [o for o in load_asset(asset_id) if o.type == "MESH"]
    if only:
        parts = [o for o in parts if any(o.name.startswith(n) for n in only)]
    root = bpy.data.objects.new(f"{asset_id}_at", None)
    root.location = P(x, y, z)
    root.rotation_euler = (0, 0, rot)
    root.scale = (scale, scale, scale)
    coll(collection).objects.link(root)
    recentre = mathutils.Vector((0, 0, 0))
    if only and len(parts) == 1:
        t = parts[0].matrix_world.translation
        recentre = mathutils.Vector((-t.x, -t.y, 0))
    for o in parts:
        c = bpy.data.objects.new(o.name + "_i", o.data)
        c.matrix_basis = mathutils.Matrix.Translation(recentre) @ o.matrix_world
        c.parent = root
        coll(collection).objects.link(c)
    return root


# ------------------------------------------------------------------ build
def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_architecture(M):
    H = CEILING_Y - BOTTOM
    mid = (CEILING_Y + BOTTOM) / 2
    # Floor and pool. The pool is a recess so water sits flush with the floor.
    box("floor_left", 30 - 0, 0.4, 34, 0, -0.2, -3, M["floor"])
    box("pool_water", POOL_HALF * 2, 0.02, POOL_HALF * 2, 0, 0.005, 0, M["water"], "arch")
    for sx, sz, w, d in [
        (0, POOL_HALF + COPING / 2, POOL_HALF * 2 + COPING * 2, COPING),
        (0, -POOL_HALF - COPING / 2, POOL_HALF * 2 + COPING * 2, COPING),
        (POOL_HALF + COPING / 2, 0, COPING, POOL_HALF * 2),
        (-POOL_HALF - COPING / 2, 0, COPING, POOL_HALF * 2),
    ]:
        box("coping", w, 0.06, d, sx, 0.03, sz, M["stone"], bevel=0.01)

    # Back wall: solid low, window band with mullions, solid high.
    low = WINDOWS["y0"] - BOTTOM
    box("back_left", 12, low, 1, -8.5, BOTTOM + low / 2, WALL["back"] - 0.5, M["concrete"])
    box("back_right", 12, low, 1, 8.5, BOTTOM + low / 2, WALL["back"] - 0.5, M["concrete"])
    box("back_over_channel", 5, WINDOWS["y0"] - 4.2, 1, 0, (WINDOWS["y0"] + 4.2) / 2, WALL["back"] - 0.5, M["concrete"])
    box("back_top", 29.2, CEILING_Y - WINDOWS["y1"], 1, 0, (CEILING_Y + WINDOWS["y1"]) / 2, WALL["back"] - 0.5, M["concrete"])
    x = -WALL["x"]
    while x <= WALL["x"] + 0.01:
        box("mullion", 0.3, WINDOWS["y1"] - WINDOWS["y0"], 1.0, x, (WINDOWS["y0"] + WINDOWS["y1"]) / 2, WALL["back"] - 0.5, M["concrete"], bevel=0.02)
        x += WINDOWS["mullion"]
    box("transom", 29.2, 0.1, 0.25, 0, (WINDOWS["y0"] + WINDOWS["y1"]) / 2 + 0.6, WALL["back"] - 0.55, M["steel"])
    box("glazing", WALL["x"] * 2, WINDOWS["y1"] - WINDOWS["y0"], 0.02, 0, (WINDOWS["y0"] + WINDOWS["y1"]) / 2, WALL["back"] - 0.45, M["glass"])

    # Side walls, the drain channel through the back wall.
    box("side_left", 1, H, 34, -WALL["x"] - 0.5, mid, -3, M["concrete"])
    box("side_right", 1, H, 34, WALL["x"] + 0.5, mid, -3, M["concrete"])
    box("channel_roof", 5, 1, 12, 0, 4.7, WALL["back"] - 6.5, M["concrete"])
    box("channel_l", 1, 5, 12, -2.9, 2.1, WALL["back"] - 6.5, M["concrete"])
    box("channel_r", 1, 5, 12, 2.9, 2.1, WALL["back"] - 6.5, M["concrete"])
    box("channel_water", 5, 0.02, 12, 0, -0.05, WALL["back"] - 6.5, M["water"])

    # Ceiling with the opening, beams on the pillar grid.
    o = OPENING
    half = o["size"] / 2
    cy = CEILING_Y + 0.5
    x0, x1, z0, z1 = -15, 15, -20, 14
    box("ceil_a", o["x"] - half - x0, 1, z1 - z0, (x0 + o["x"] - half) / 2, cy, (z0 + z1) / 2, M["concrete"])
    box("ceil_b", x1 - (o["x"] + half), 1, z1 - z0, (o["x"] + half + x1) / 2, cy, (z0 + z1) / 2, M["concrete"])
    box("ceil_c", o["size"], 1, o["z"] - half - z0, o["x"], cy, (z0 + o["z"] - half) / 2, M["concrete"])
    box("ceil_d", o["size"], 1, z1 - (o["z"] + half), o["x"], cy, (o["z"] + half + z1) / 2, M["concrete"])
    for z in PILLAR_Z:
        box("beam_x", 29, 1.1, 0.7, 0, CEILING_Y - 0.55, z, M["concrete"], bevel=0.03)
    for x in PILLAR_X:
        box("beam_z", 0.7, 1.1, 33, x, CEILING_Y - 0.55, -3, M["concrete"], bevel=0.03)

    # A painted-over skylight fills the opening. A few panes are gone, right
    # where the site's shafts start, so the moon comes through as beams.
    pane = o["size"] / 10
    top = CEILING_Y + 1.0
    tops = [(fx + KEY_DIR[0] * top, fz + KEY_DIR[2] * top, r) for fx, fz, r in SHAFT_FEET]
    for j in range(10):
        for i in range(10):
            px = o["x"] - half + (i + 0.5) * pane
            pz = o["z"] - half + (j + 0.5) * pane
            if any(math.hypot(px - tx, pz - tz) < r for tx, tz, r in tops):
                continue
            box("skylight_pane", pane, 0.05, pane, px, top - 0.03, pz, M["roof"])
    for k in range(11):
        t = -half + k * pane
        box("skylight_bar", o["size"], 0.1, 0.05, o["x"], top - 0.08, o["z"] + t, M["steel_dark"])
        box("skylight_bar", 0.05, 0.1, o["size"], o["x"] + t, top - 0.08, o["z"], M["steel_dark"])

    # Pillars.
    for x in PILLAR_X:
        for z in PILLAR_Z:
            box("pillar", PILLAR_SIZE, H, PILLAR_SIZE, x, mid, z, M["concrete"], bevel=0.03)

    # Galleries, rails, catwalk.
    w = MEZZ["outer"] - MEZZ["inner"]
    L = MEZZ["z1"] - MEZZ["z0"]
    zc = (MEZZ["z0"] + MEZZ["z1"]) / 2
    for side in (-1, 1):
        box("gallery", w, 0.36, L, side * (MEZZ["inner"] + w / 2), MEZZ["y"] - 0.18, zc, M["concrete"], bevel=0.02)
        edge = side * MEZZ["inner"]
        box("rail_top", 0.06, 0.06, L, edge + side * 0.05, MEZZ["y"] + 1.05, zc, M["steel"])
        box("rail_mid", 0.03, 0.03, L, edge + side * 0.05, MEZZ["y"] + 0.55, zc, M["steel"])
        zz = MEZZ["z0"] + 1
        while zz <= MEZZ["z1"] - 1:
            box("post", 0.05, 1.05, 0.05, edge + side * 0.05, MEZZ["y"] + 0.52, zz, M["steel"])
            zz += 2
        box("gallery_led", 0.03, 0.025, L, edge + side * 0.04, MEZZ["y"] - 0.37, zc, M["strip"], "lights_mesh")
        box("cove", 0.025, 0.03, 31, side * (WALL["x"] - 0.02), 0.04, -3.5, M["strip"], "lights_mesh")
    span = MEZZ["inner"] * 2
    bz = -12.5
    box("catwalk", span, 0.3, 2.0, 0, MEZZ["y"] - 0.15, bz, M["concrete"], bevel=0.02)
    for dz in (-0.97, 0.97):
        box("cw_rail", span, 0.05, 0.05, 0, MEZZ["y"] + 1.05, bz + dz, M["steel"])
        box("cw_mid", span, 0.025, 0.025, 0, MEZZ["y"] + 0.55, bz + dz, M["steel"])


def build_lights(M, accent):
    # Moon through the opening.
    sun = bpy.data.lights.new("moon", "SUN")
    sun.energy = SUN
    sun.color = srgb("#bcd3e6")[:3]
    sun.angle = math.radians(1.5)
    o = bpy.data.objects.new("moon", sun)
    import mathutils

    kd = mathutils.Vector(P(*KEY_DIR)).normalized()
    o.rotation_euler = (-kd).to_track_quat("-Z", "Y").to_euler()
    coll("lights").objects.link(o)

    # Pillar lamps: warm, small, on the inner faces, not all at full strength.
    i = 0
    for z in PILLAR_Z:
        for side in (-1, 1):
            x = side * (6.4 - PILLAR_SIZE / 2 - 0.02)
            lvl = LAMP_LEVELS[i % len(LAMP_LEVELS)]
            i += 1
            box("lamp", 0.04, 0.5, 0.09, x, 0.85, z, emissive(f"lamp{i}", "#ffc890", 25 * lvl), "lights_mesh")
            if lvl > 0.1:
                area_light(f"lampL{i}", x - side * 0.06, 0.85, z, 0.08, 18 * lvl, "#ffc890", target=(0, 0.85, z), size_y=0.5)

    # The form's glow, standing in for the live grains in these stills.
    glow = point_light("form_glow", *FORM_CENTER, 1500, accent, radius=1.4)
    # The live form is grains, not a lamp: keep the sphere out of reflections.
    glow.visible_glossy = False


def build_dressing(M):
    """Per art/SCENE.md: work corner, bench, booth, crane, pendants, trays, signage."""
    # Work corner under the catwalk, back left of the pool: a pallet with
    # crates, a cart with a toolbox and a work lamp, barrels.
    cx, cz = -5.0, -11.8
    box("pallet", 1.2, 0.14, 1.0, cx, 0.07, cz, M["wood_old"], "props", bevel=0.01)
    place("wooden_crate_02", cx - 0.1, 0.14, cz, rot=math.radians(88))
    place("wooden_crate_01", cx + 0.05, 0.6, cz + 0.05, rot=math.radians(3))
    place("old_military_crate", cx - 1.25, 0, cz + 0.55, rot=math.radians(-12), only=["old_military_crate"])
    kx, kz = -3.2, -11.0
    place("industrial_storage_cart", kx, 0, kz, rot=math.radians(-8))
    place("metal_toolbox", kx + 0.2, 0.93, kz, rot=math.radians(20))
    cyl("worklamp", 0.08, 0.12, kx - 0.5, 1.05, kz, emissive("worklamp", "#ffd2a0", 6), axis="x")
    spot_light("worklamp_spot", kx - 0.55, 1.07, kz, 70, "#ffd2a0", (cx, 0.6, cz), angle=1.1)
    place("Barrel_02", -7.0, 0, -12.4, rot=0.4)
    place("Barrel_02", -7.55, 0, -11.9, rot=1.9)
    # Coiled cables on the floor.
    for k, (x, z, r) in enumerate([(-2.6, -10.4, 0.32), (-2.1, -10.0, 0.22)]):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.02, location=P(x, 0.02, z))
        t = bpy.context.active_object
        t.name = f"cable{k}"
        t.data.materials.append(M["rubber"])
        link(t, "props")
    # Ladder in the work corner, leaning on the catwalk's front edge.
    lx = -7.4
    foot_z, top_z, top_y = -10.0, -11.45, MEZZ["y"] + 0.4
    length = math.hypot(top_z - foot_z, top_y)
    lean = math.atan2(foot_z - top_z, top_y)
    for dx in (-0.22, 0.22):
        bpy.ops.mesh.primitive_cube_add(size=1, location=P(lx + dx, top_y / 2, (foot_z + top_z) / 2))
        r = bpy.context.active_object
        r.scale = (0.05, 0.05, length)
        r.rotation_euler = (-lean, 0, 0)
        r.data.materials.append(M["alu"])
        link(r, "props")
    for k in range(int(length / 0.3)):
        t = (k + 0.5) * 0.3 / length
        cyl("rung", 0.015, 0.44, lx, t * top_y, foot_z + (top_z - foot_z) * t, M["alu"], axis="x", verts=8)

    # Bench facing the pool from the left, a wet floor sign by the rim,
    # a life jacket by the side door: small signs of use.
    place("painted_wooden_bench", -6.1, 0, 1.6, rot=math.radians(-90))
    place("painted_wooden_bench", 5.4, 0, -1.5, rot=math.radians(90))
    place("painted_wooden_bench", -5.4, 0, 5.8, rot=math.radians(145))
    place("WetFloorSign_01", 4.8, 0, 2.9, rot=math.radians(30))
    place("life_jacket", -WALL["x"] + 0.12, 1.3, 6.6, rot=math.radians(90))

    # Planters with trees. Two trees to choose between in review: a pine
    # (closest CC0 conifer to a coastal black pine) and the island tree.
    for k, (x, z) in enumerate([(-8.6, -1.5), (-8.6, 4.2)]):
        box(f"planter{k}", 1.8, 0.7, 1.8, x, 0.35, z, M["concrete"], "props", bevel=0.03)
        box(f"soil{k}", 1.62, 0.04, 1.62, x, 0.69, z, M["soil"], "props")
        place("fern_02", x + 0.45, 0.7, z + 0.4, rot=0.7, scale=1.1, only=["fern_02_b"])
        place("fern_02", x - 0.5, 0.7, z - 0.35, rot=2.4, scale=1.0, only=["fern_02_c"])
    place("pine_sapling_medium", -8.6, 0.7, -1.5, rot=0.5, scale=0.5, only=["pine_sapling_medium_b"])
    place("island_tree_02", -8.6, 0.7, 4.2, rot=2.6, scale=1.0)
    # A third planter on the right. The left ones sit under the text panel
    # in the home view; this one is in the home and glass frames.
    rx, rz = 8.9, -6.5
    box("planter2", 1.8, 0.7, 1.8, rx, 0.35, rz, M["concrete"], "props", bevel=0.03)
    box("soil2", 1.62, 0.04, 1.62, rx, 0.69, rz, M["soil"], "props")
    place("fern_02", rx + 0.45, 0.7, rz + 0.4, rot=0.3, scale=1.1, only=["fern_02_b"])
    place("fern_02", rx - 0.5, 0.7, rz - 0.35, rot=2.0, scale=1.0, only=["fern_02_c"])
    place("pine_sapling_medium", rx, 0.7, rz, rot=2.2, scale=0.55, only=["pine_sapling_medium_b"])
    # Small warm uplights in each planter, on the side facing the pool.
    for k, (x, z, side) in enumerate([(-8.6, -1.5, 1), (-8.6, 4.2, 1), (rx, rz, -1)]):
        spot_light(f"uplight{k}", x + side * 0.7, 0.78, z, 45, "#ffd2a0", (x, 3.2, z), angle=0.8)
    # Foreground planter, bottom left of the home view: tall ferns and a
    # young pine, mostly in silhouette.
    box("fg_planter", 1.5, 0.9, 1.5, -2.6, 0.45, 8.4, M["concrete"], "props", bevel=0.03)
    # Recessed washers in the floor graze the two faces the cameras see, so
    # the planter reads as lit concrete, not a black slab, in the foreground.
    slot = emissive("washer", "#ffc890", 3)
    # Far enough out (0.4 m) that the wash climbs the whole face.
    for name, x, z, w, d, face in [("f", -2.6, 9.55, 1.2, 0.04, (-2.6, 0.8, 9.15)), ("r", -1.45, 8.4, 0.04, 1.2, (-1.85, 0.8, 8.4))]:
        box(f"fg_slot_{name}", w, 0.01, d, x, 0.005, z, slot, "lights_mesh")
        area_light(f"fg_wash_{name}", x, 0.02, z, 1.15, 18, "#ffc890", target=face, size_y=0.05)
    box("fg_soil", 1.34, 0.04, 1.34, -2.6, 0.89, 8.4, M["soil"], "props")
    place("fern_02", -2.4, 0.9, 8.3, rot=1.2, scale=0.9, only=["fern_02_b"])
    if FG_TREE == "island":
        place("island_tree_02", -2.7, 0.9, 8.3, rot=1.0, scale=0.62)
    else:
        place("pine_sapling_medium", -2.7, 0.9, 8.3, rot=1.0, scale=0.34, only=["pine_sapling_medium_c"])

    # Booth on the right gallery: glass box with warm light, desk, monitor.
    bx, bz, by = 12.2, -11.5, MEZZ["y"]
    for dx, dz, w, d in [(-1.2, 0, 0.04, 2.6), (1.2, 0, 0.04, 2.6), (0, -1.3, 2.4, 0.04), (0, 1.3, 2.4, 0.04)]:
        box("booth_glass", w, 2.4, d, bx + dx, by + 1.2, bz + dz, M["glass"], "props")
    for dx, dz in [(-1.2, -1.3), (1.2, -1.3), (-1.2, 1.3), (1.2, 1.3)]:
        box("booth_post", 0.06, 2.4, 0.06, bx + dx, by + 1.2, bz + dz, M["steel"], "props")
    box("booth_roof", 2.5, 0.08, 2.7, bx, by + 2.44, bz, M["steel_paint"], "props")
    box("desk", 1.4, 0.05, 0.6, bx + 0.3, by + 0.75, bz - 0.8, M["wood"], "props")
    box("desk_leg", 0.05, 0.75, 0.55, bx - 0.35, by + 0.37, bz - 0.8, M["steel"], "props")
    box("monitor", 0.55, 0.34, 0.03, bx + 0.3, by + 1.05, bz - 1.0, emissive("screen", "#8fb0cc", 0.7), "props")
    box("shelf", 0.35, 1.6, 1.0, bx + 1.0, by + 0.8, bz + 0.6, M["steel_paint"], "props")
    for k in range(6):
        box("binder", 0.06, 0.3, 0.25, bx + 0.95, by + 1.25 + (k // 3) * 0.4, bz + 0.3 + (k % 3) * 0.28, principled(f"binder{k}", srgb(["#3e6b8a", "#8a3e3e", "#c9a96e"][k % 3]), 0.6), "props")
    place("SchoolChair_01", bx + 0.3, by, bz - 0.2, rot=math.radians(170))
    place("desk_lamp_arm_01", bx - 0.2, by + 0.775, bz - 0.95, rot=math.radians(30))
    place("clipboard", bx + 0.55, by + 0.78, bz - 0.7, rot=math.radians(-12))
    place("vintage_binocular", bx - 0.05, by + 0.78, bz - 0.55, rot=math.radians(40))
    area_light("booth_light", bx, by + 2.3, bz, 1.6, 120, "#ffd6a6", target=(bx, by, bz))
    for k, z in enumerate((-7.6, -6.2, -3.0)):
        place("potted_plant_02", MEZZ["inner"] + 0.45, by, z, rot=k * 1.7)

    # Exit sign over a side door on the left wall.
    box("exit", 0.04, 0.25, 0.6, -WALL["x"] + 0.03, 3.1, 8.0, emissive("exit", "#2bd46b", 5), "lights_mesh")
    box("door", 0.06, 2.3, 1.4, -WALL["x"] + 0.04, 1.15, 8.0, M["steel_paint"], "props")

    # Gantry crane: runway beams carried on the outer pillar rows, the
    # bridge parked toward the back of the hall so it spans the frame.
    gz = -13.6
    ry = 7.6
    for side in (-1, 1):
        rx = side * 11.5
        box("runway", 0.45, 0.6, 33, rx, ry, -3, M["steel_dark"], "props", bevel=0.02)
        box("crane_truck", 0.7, 0.55, 2.6, rx, ry + 0.58, gz, M["steel_dark"], "props", bevel=0.02)
        box("truck_stripe", 0.72, 0.12, 2.62, rx, ry + 0.58, gz, M["hazard"], "props")
    for dz in (-0.6, 0.6):
        box("crane_girder", 23.4, 1.0, 0.38, 0, ry + 1.05, gz + dz, M["steel_dark"], "props", bevel=0.02)
    box("crane_trolley", 1.5, 0.65, 1.7, 2.2, ry + 1.85, gz, M["steel_dark"], "props", bevel=0.02)
    for dx in (-0.12, 0.12):
        cyl("hoist_cable", 0.012, 3.2, 2.2 + dx, ry - 0.1, gz, M["steel"], verts=6)
    box("hook_block", 0.5, 0.65, 0.32, 2.2, ry - 1.9, gz, M["hazard"], "props", bevel=0.03)
    # Lights a real crane carries: an amber beacon, a work light under the
    # trolley throwing a cone down through the haze, a strip under a girder.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.09, location=P(2.2, ry + 2.25, gz))
    b = bpy.context.active_object
    b.data.materials.append(emissive("beacon", "#ffa31a", 40))
    link(b, "lights_mesh")
    point_light("beacon_light", 2.2, ry + 2.3, gz, 12, "#ffa31a", radius=0.09)
    spot_light("crane_down", 2.2, ry + 1.45, gz + 0.9, 900, "#dfe9f2", (2.2, 0, gz + 2.5), angle=0.55)
    box("girder_led", 22.0, 0.03, 0.04, 0, ry + 0.53, gz + 0.8, M["strip"], "lights_mesh")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.045, location=P(2.2, ry - 2.45, gz))
    hook = bpy.context.active_object
    hook.rotation_euler = (0, math.pi / 2, 0)
    hook.data.materials.append(M["steel_dark"])
    link(hook, "props")

    # Pendant lamps from the beams, some lit.
    for k, (x, z, lit) in enumerate([(-6.4, -9, True), (6.4, -9, False), (-6.4, 1, False), (6.4, 1, True), (-11.5, -4, True), (11.5, -14, False)]):
        top = CEILING_Y - 1.1
        cyl(f"pend_cord{k}", 0.006, 1.6, x, top - 0.8, z, M["rubber"], verts=6)
        place("hanging_industrial_lamp", x, top - 1.6 - 1.36, z, rot=k * 0.7)
        if lit:
            point_light(f"pend_light{k}", x, top - 1.6 - 1.25, z, 45, "#ffc890", radius=0.08)

    # Cable tray along the left wall.
    box("tray", 0.35, 0.08, 30, -WALL["x"] + 0.3, 4.3, -3.5, M["steel"], "props")
    for k in range(3):
        cyl(f"tray_cable{k}", 0.025, 30, -WALL["x"] + 0.2 + k * 0.08, 4.38, -3.5, M["rubber"], axis="z", verts=8)


def paint_text(name, body, size, x, y, z, rot, mat, collection="signage"):
    """Painted lettering: a flat text mesh a hair off the surface."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    o = bpy.data.objects.new(name, curve)
    o.location = P(x, y, z)
    o.rotation_euler = rot
    coll(collection).objects.link(o)
    o.data.materials.append(mat)
    return o


def build_signage(M):
    paint = M["paint"]
    # Hall number, large and faded, on the back wall left of the channel.
    paint_text("hall_no", "04", 3.2, -6.4, 2.9, WALL["back"] + 0.005, (math.pi / 2, 0, 0), paint)
    paint_text("hall_label", "HALL", 0.55, -6.4, 0.9, WALL["back"] + 0.005, (math.pi / 2, 0, 0), paint)
    # Bay codes on the floor along the side walls.
    for k, z in enumerate((-14, -4, 6)):
        paint_text(f"bay_l{k}", f"B-{k + 1:02d}", 0.5, -12.8, 0.004, z, (0, 0, math.pi / 2), paint)
        paint_text(f"bay_r{k}", f"D-{k + 1:02d}", 0.5, 12.8, 0.004, z, (0, 0, -math.pi / 2), paint)
    # Safety stencils.
    paint_text("no_entry", "NO ENTRY", 0.32, 0, 0.004, WALL["back"] + 1.2, (0, 0, 0), M["paint_red"])
    paint_text("load", "MAX 500 KG", 0.16, 0, MEZZ["y"] - 0.2, -11.49, (math.pi / 2, 0, 0), paint)


def build_outside():
    """What the windows look out on: night sky glow and a few dock lights."""
    m = new_material("outside")
    nt = m.node_tree
    p = nt.nodes.get("Principled BSDF")
    out = nt.nodes.get("Material Output")
    em = nt.nodes.new("ShaderNodeEmission")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapn = nt.nodes.new("ShaderNodeMapping")
    mapn.inputs["Rotation"].default_value = (0, 0, math.pi / 2)
    nt.links.new(coord.outputs["Generated"], mapn.inputs["Vector"])
    nt.links.new(mapn.outputs["Vector"], grad.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = srgb("#0a1118")
    ramp.color_ramp.elements[1].position = 0.32
    ramp.color_ramp.elements[1].color = srgb("#03060a")
    mid = ramp.color_ramp.elements.new(0.06)
    mid.color = srgb("#1c2a35")
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 0.5
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    nt.nodes.remove(p)
    bpy.ops.mesh.primitive_plane_add(size=1, location=P(0, 12, -45))
    o = bpy.context.active_object
    o.name = "outside_sky"
    o.scale = (140, 50, 1)
    o.rotation_euler = (math.pi / 2, 0, 0)
    o.data.materials.append(m)
    link(o, "outside")
    lamp = emissive("dock_lamp", "#ffb15c", 30)
    import random

    rnd = random.Random(4)
    for k in range(22):
        x = rnd.uniform(-60, 60)
        y = rnd.uniform(1.0, 3.5)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=P(x, y, -44))
        b = bpy.context.active_object
        b.data.materials.append(lamp)
        link(b, "outside")


def build_world(accent):
    w = bpy.data.worlds.new("night")
    try:
        w.use_nodes = True
    except (AttributeError, TypeError):
        pass
    bpy.context.scene.world = w
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("#0b1520")
    bg.inputs["Strength"].default_value = 0.12
    # Thin haze so the moon beams show. It fills the hall only: a world
    # volume is infinite, so it swallows the sun's light before it arrives.
    m = new_material("haze")
    mt = m.node_tree
    mt.nodes.remove(mt.nodes.get("Principled BSDF"))
    vol = mt.nodes.new("ShaderNodeVolumeScatter")
    vol.inputs["Density"].default_value = DENSITY
    vol.inputs["Anisotropy"].default_value = 0.55
    mt.links.new(vol.outputs["Volume"], mt.nodes.get("Material Output").inputs["Volume"])
    top = CEILING_Y
    box("haze", WALL["x"] * 2, top - BOTTOM, 34, 0, (top + BOTTOM) / 2, -3, m, "fx")


def materials():
    return {
        "concrete": concrete("concrete", 0.11),
        "floor": concrete("floor", 0.1, scale=1.0, wet=True),
        "stone": principled("stone", (0.24, 0.24, 0.23, 1), 0.55),
        "water": principled("water", (0.004, 0.008, 0.012, 1), 0.02),
        "steel": principled("steel", (0.32, 0.33, 0.34, 1), 0.45, metal=1.0),
        "steel_dark": principled("steel_dark", (0.06, 0.065, 0.07, 1), 0.55, metal=0.7),
        "steel_paint": principled("steel_paint", (0.12, 0.13, 0.13, 1), 0.6),
        "alu": principled("alu", (0.55, 0.56, 0.57, 1), 0.35, metal=1.0),
        "hazard": principled("hazard", srgb("#c99a1c"), 0.6),
        "wood": principled("wood", (0.22, 0.15, 0.09, 1), 0.75),
        "wood_old": principled("wood_old", (0.15, 0.11, 0.07, 1), 0.85),
        "rubber": principled("rubber", (0.015, 0.015, 0.015, 1), 0.7),
        "soil": principled("soil", (0.03, 0.025, 0.02, 1), 0.95),
        "roof": principled("roof", (0.02, 0.02, 0.022, 1), 0.85),
        "glass": glass(),
        "strip": emissive("strip", "#d8ecf5", 8),
        "paint": paint_material("paint", "#c9c4b8"),
        "paint_red": paint_material("paint_red", "#9b3a32"),
    }


def paint_material(name, hex_):
    """Old paint: worn through in places by a noise mask, matte."""
    m = new_material(name)
    nt = m.node_tree
    p = nt.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = srgb(hex_)
    p.inputs["Roughness"].default_value = 0.9
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 30
    noise.inputs["Detail"].default_value = 8
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.44
    ramp.color_ramp.elements[1].color = (0.75, 0.75, 0.75, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Alpha"])
    return m


def glass():
    m = new_material("glass")
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (0.8, 0.85, 0.9, 1)
    p.inputs["Roughness"].default_value = 0.04
    p.inputs["Transmission Weight"].default_value = 1.0
    p.inputs["IOR"].default_value = 1.45
    return m


# ----------------------------------------------------------------- views
# Mirrors the site's cameras (src/scene/index.ts): eye 2.35 m, orbit yaw and
# distance around the form, looking at lookY. The site shifts the picture
# left by 7% on landscape screens; Blender's shift_x does the same.
VIEWS = {
    "home": dict(yaw=0.0, dist=13.4, look=2.05, accent="#9bb5c7", glow=1500),
    "glass": dict(yaw=-0.16, dist=13.6, look=1.8, accent="#8c6ff0", glow=1500),
    "work": dict(yaw=0.62, dist=10.5, look=3.0, accent="#9bb5c7", glow=120),
}


def camera_for(view):
    import mathutils

    v = VIEWS[view]
    cam = bpy.data.cameras.new(view)
    cam.lens_unit = "FOV"
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(36)
    cam.shift_x = 0.07
    cam.clip_end = 200
    o = bpy.data.objects.new(f"cam_{view}", cam)
    eye = (math.sin(v["yaw"]) * v["dist"], 2.35, math.cos(v["yaw"]) * v["dist"])
    o.location = P(*eye)
    d = mathutils.Vector(P(0, v["look"], 0)) - o.location
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    coll("cameras").objects.link(o)
    return o


def stand_in(view):
    """The site's forms are live grains; for review stills, a glowing stand-in."""
    for o in list(coll("standin").objects):
        bpy.data.objects.remove(o)
    if view == "home":
        curve = bpy.data.curves.new("name", "FONT")
        curve.body = "rashed\nparvez"
        curve.size = 1.55
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.extrude = 0.18
        o = bpy.data.objects.new("name", curve)
        o.location = P(0, 2.75, 0)
        o.rotation_euler = (math.pi / 2, 0, 0)
        o.data.materials.append(emissive("name_glow", "#c6d5df", 1.6))
        coll("standin").objects.link(o)
    elif view == "glass":
        import bmesh

        me = bpy.data.meshes.new("crystal")
        bm = bmesh.new()
        top = bm.verts.new(P(0, 3.1 + 1.45, 0))
        bot = bm.verts.new(P(0, 3.1 - 1.25, 0))
        ring = [bm.verts.new(P(math.cos(a) * 0.85, 3.2, math.sin(a) * 0.85)) for a in [k * math.pi / 3 + 0.4 for k in range(6)]]
        for k in range(6):
            a, b = ring[k], ring[(k + 1) % 6]
            bm.faces.new((top, a, b))
            bm.faces.new((bot, b, a))
        bm.to_mesh(me)
        o = bpy.data.objects.new("crystal", me)
        w = o.modifiers.new("wire", "WIREFRAME")
        w.thickness = 0.03
        o.data.materials.append(emissive("crystal_glow", "#ece6ff", 6))
        coll("standin").objects.link(o)
        colors = ["#ff6b6b", "#e28f2a", "#ff9f1a", "#43b581", "#4eb4d3", "#4d96ff", "#8c6ff0"]
        for k, hexc in enumerate(colors):
            el = -(0.88 + 0.1 * math.sin(k * 1.7))
            az = k * 2 * math.pi / 7
            d = (math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az))
            start = (d[0] * 0.85, 3.2 + d[1] * 0.85, d[2] * 0.85)
            L = start[1] / -d[1]
            mid = tuple(start[i] + d[i] * L / 2 for i in range(3))
            bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=L, vertices=8, location=P(*mid))
            c = bpy.context.active_object
            import mathutils

            c.rotation_euler = mathutils.Vector(P(*d)).to_track_quat("Z", "Y").to_euler()
            c.data.materials.append(emissive(f"beam{k}", hexc, 8))
            link(c, "standin")


def render(views, samples):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    s.cycles.device = "GPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.render.resolution_x = 1600
    s.render.resolution_y = 1000
    s.render.resolution_percentage = PCT
    s.view_settings.view_transform = "AgX"
    s.view_settings.look = "AgX - Medium High Contrast"
    s.view_settings.exposure = 0.0
    os.makedirs(RENDERS, exist_ok=True)
    form = bpy.data.objects.get("form_glow")
    for view in views:
        s.camera = camera_for(view)
        stand_in(view)
        if form:
            c = srgb(VIEWS[view]["accent"])[:3]
            grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            form.data.color = tuple(v * 0.45 + grey * 0.55 for v in c)
            form.data.energy = VIEWS[view]["glow"]
        s.render.filepath = os.path.join(RENDERS, f"{view}{SUFFIX}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", s.render.filepath)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    samples = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 96
    views = argv[argv.index("--views") + 1].split(",") if "--views" in argv else list(VIEWS)
    clear()
    M = materials()
    build_architecture(M)
    build_lights(M, "#9bb5c7")
    build_dressing(M)
    build_signage(M)
    build_outside()
    build_world("#9bb5c7")
    if "library" in COLL:
        COLL["library"].hide_render = True
        bpy.context.view_layer.layer_collection.children["library"].exclude = True
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "hall.blend"))
    if "--render" in argv:
        render(views, samples)


main()

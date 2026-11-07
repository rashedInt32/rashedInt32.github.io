"""
Bake the hall's light for the site and export it. Runs after build_hall.py,
in the same Blender session:

    blender -b --factory-startup -P art/build_hall.py -P art/bake_hall.py -- \\
        [--samples 512] [--only arch,floor,props,plants] [--dry]

Writes public/hall/:
  hall.glb          arch (concrete), props (everything else solid) and emit
                    (lamps, strips, signs), meshopt-compressed by gltfpack
  arch_static.webp  light from every static source on the concrete, no albedo
  arch_form.webp    light from the form alone, white, no albedo (grey)
  floor_static.webp the same two for the floor, mapped by world x/z
  floor_form.webp
  props_static.webp props: albedo times static light
  props_form.webp   props: albedo times the form's white light
  plants_*.webp     tree and pot impostors, same two passes, with alpha
  plants.json       where each impostor stands and where it is in the atlas

The site keeps its own concrete albedo and detail and multiplies it by these.
The form's map is tinted live with the active project's colour.

Encoding: each channel stores log2(light) from LOG_MIN to LOG_MAX in 8 bits,
about 0.06 stops a step. src/scene/hall.ts decodes with the same constants.
Intermediates go to art/bake/ (gitignored).
"""

import math
import os
import struct
import subprocess
import sys
import zlib

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "hall")
WORK = os.path.join(HERE, "bake")

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
SAMPLES = int(ARGV[ARGV.index("--samples") + 1]) if "--samples" in ARGV else 512
ONLY = set(ARGV[ARGV.index("--only") + 1].split(",")) if "--only" in ARGV else {"arch", "floor", "props", "plants"}
DRY = "--dry" in ARGV

LOG_MIN, LOG_MAX = -12.0, 3.0
# Emission is stored as colour x strength / EMIT_SCALE in the glb's vertex colours.
EMIT_SCALE = 64.0
# Props heavier than this are decimated before export.
MAX_TRIS = 4000

# Floor bake covers the hall floor; the site samples it by world x/z.
FLOOR = dict(x0=-14.5, x1=14.5, z0=-19.0, z1=14.0)

# Not exported: the site draws these itself, or they're never seen.
SKIP = ("haze", "glazing", "pool_water", "coping", "channel_water", "floor_left", "skylight", "booth_glass")
# Plants go to the site as impostors (a later step), not as meshes.
PLANTS = ("pine_sapling", "island_tree", "fern_02", "potted_plant_02")


def P(x, y, z):
    return (x, -z, y)


# ----------------------------------------------------------------- classify
def emission_of(m):
    """(r, g, b, strength) if the material glows with a flat colour, else None."""
    if not m or not m.node_tree:
        return None
    p = m.node_tree.nodes.get("Principled BSDF")
    if not p:
        return None
    s = p.inputs["Emission Strength"].default_value
    c = p.inputs["Emission Color"]
    if s <= 0 or c.is_linked:
        return None
    r, g, b, _ = c.default_value
    if r + g + b <= 0:
        return None
    return (r, g, b, s)


def kind(o):
    if o.type != "MESH" or not o.users_collection:
        return None
    if o.users_collection[0].name in ("library", "outside", "cameras", "fx"):
        return None
    if o.name.startswith(SKIP):
        return None
    if o.name.startswith(PLANTS):
        return "plant"
    mats = [m for m in o.data.materials if m]
    if not mats or any(m.name.startswith("glass") for m in mats):
        return None
    if all(emission_of(m) for m in mats):
        return "emit"
    if any(emission_of(m) for m in mats):
        return "mixed"
    if all(m.name.startswith("concrete") for m in mats):
        return "arch"
    return "props"


# ----------------------------------------------------------------- mesh prep
def override(objs, active):
    return bpy.context.temp_override(active_object=active, object=active, selected_objects=objs, selected_editable_objects=objs)


def realize(o, coll):
    """A single-user copy with modifiers applied and the transform baked in."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(o.matrix_world)
    c = bpy.data.objects.new(o.name + "~", me)
    coll.objects.link(c)
    # One UV layer named UVMap, so joined meshes line up their layers.
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    me.uv_layers[0].name = "UVMap"
    return c


def tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def decimate(c):
    t = tris(c.data)
    if t <= MAX_TRIS:
        return
    mod = c.modifiers.new("dec", "DECIMATE")
    mod.ratio = MAX_TRIS / t
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(c.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    c.modifiers.remove(mod)
    old = c.data
    c.data = me
    bpy.data.meshes.remove(old)


def join(objs, name):
    objs = [o for o in objs if o]
    if not objs:
        return None
    with override(objs, objs[0]):
        bpy.ops.object.join()
    o = objs[0]
    o.name = name
    o.data.name = name
    return o


def cull_hidden(o):
    """Drop faces no site camera can see: the outside of the walls, the top of
    the roof, the bottoms. They'd only take space in the atlas."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        x, y, z = c.x, c.z, -c.y
        ny, nz = f.normal.z, -f.normal.y
        if (
            (ny > 0.9 and y > 12.9)
            or (ny < -0.9 and y < -0.35)
            or abs(x) > 14.6
            or z > 13.9
            or (z < -19.6 and abs(x) > 3.45)
            or (nz < -0.9 and z < -19.6 and y > 4.3)
        ):
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    print(f"CULLED {len(dead)} hidden faces from {o.name}")


def edit(o, fn):
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    # UV operators then act on the mesh selection: every face. Without it
    # they act on the UV selection, which joining leaves empty.
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    with override([o], o):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        fn()
        bpy.ops.object.mode_set(mode="OBJECT")


def unwrap(o):
    """Smart-project into a new 'lightmap' layer, made the active layer. The
    original UVs stay the render layer so textures still map."""
    me = o.data
    uv = me.uv_layers.new(name="lightmap")
    me.uv_layers.active = uv
    edit(o, lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02, area_weight=0.0, correct_aspect=True, scale_to_bounds=False))
    for layer in me.uv_layers:
        layer.active_render = layer.name == "UVMap"
    return uv


def uv_area(o, layer="lightmap"):
    me = o.data
    a = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers[layer].data.foreach_get("uv", a)
    a = a.reshape(-1, 2)
    total = 0.0
    for p in me.polygons:
        q = a[p.loop_start : p.loop_start + p.loop_total]
        total += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], 1)) - np.dot(q[:, 1], np.roll(q[:, 0], 1)))
    return total


def pack(o):
    """Pack every island into 0..1, keeping their relative sizes."""
    o.data.uv_layers.active = o.data.uv_layers["lightmap"]
    edit(o, lambda: bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=0.004))


def shelf(rects, gap):
    """Place (w, h) rects in the unit square, tallest first, row by row.
    Returns positions, or None if they don't fit."""
    order = sorted(range(len(rects)), key=lambda i: -rects[i][1])
    pos = [None] * len(rects)
    x = y = row = 0.0
    for i in order:
        w, h = rects[i][0] + gap, rects[i][1] + gap
        if x + w > 1:
            x, y, row = 0.0, y + row, 0.0
        if y + h > 1 or w > 1:
            return None
        pos[i] = (x + gap / 2, y + gap / 2)
        x += w
        row = max(row, h)
    return pos


def chart_pack(parts, gap=0.003):
    """Each part's lightmap UVs fill its own square (one chart per object).
    Lay the charts out in the atlas, each sized by its surface area times its
    weight, as large as fits. One margin per object, not per island: packing
    thousands of tiny islands, the margins alone filled the atlas."""
    charts = []
    for c, weight in parts:
        me = c.data
        a = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers["lightmap"].data.foreach_get("uv", a)
        a = a.reshape(-1, 2)
        lo = a.min(axis=0)
        size = np.maximum(a.max(axis=0) - lo, 1e-4)
        k = math.sqrt(sum(p.area for p in me.polygons) / max(uv_area(c), 1e-4)) * weight
        charts.append((me, a - lo, size, k))

    def fits(g):
        return shelf([tuple(sz * k * g) for _, _, sz, k in charts], gap)

    lo_g, hi_g = 0.0, 1.0
    while fits(hi_g):
        hi_g *= 2
    for _ in range(30):
        mid = (lo_g + hi_g) / 2
        lo_g, hi_g = (mid, hi_g) if fits(mid) else (lo_g, mid)
    for (me, a, _, k), (x, y) in zip(charts, fits(lo_g)):
        me.uv_layers["lightmap"].data.foreach_set("uv", (a * k * lo_g + np.array([x, y], dtype=np.float32)).ravel())
    print(f"PACKED {len(charts)} charts, scale {lo_g:.4f}")


def prop_weight(name):
    base = name.split("~")[0].split(".")[0]
    if base.endswith("_i"):
        return 2.0  # Poly Haven props: detailed, seen up close
    if base.startswith(("runway", "crane_girder", "tray", "rail_", "cw_", "post", "transom", "cable", "pend_cord", "hoist", "booth_roof", "door", "rung")):
        return 0.5  # long, plain, mostly in the dark
    return 1.0


def floor_plane(material, coll):
    f = FLOOR
    me = bpy.data.meshes.new("floor_bake")
    verts = [P(f["x0"], 0, f["z0"]), P(f["x1"], 0, f["z0"]), P(f["x1"], 0, f["z1"]), P(f["x0"], 0, f["z1"])]
    me.from_pydata(verts, [], [(0, 3, 2, 1)])
    me.update()
    uv = me.uv_layers.new(name="lightmap")
    # Site samples uv = ((x - x0) / W, (z - z0) / D) with flipY off; files are
    # top-down and Blender images bottom-up, so v here is flipped.
    for loop in me.loops:
        x, by, _ = me.vertices[loop.vertex_index].co
        z = -by
        u = (x - f["x0"]) / (f["x1"] - f["x0"])
        v = (z - f["z0"]) / (f["z1"] - f["z0"])
        uv.data[loop.index].uv = (u, 1 - v)
    me.materials.append(material)
    o = bpy.data.objects.new("floor_bake", me)
    coll.objects.link(o)
    return o


# ----------------------------------------------------------------- lights
class Rig:
    """Switches the scene between the static light and the form's light alone."""

    def __init__(self):
        self.form = bpy.data.objects.get("form_glow")
        self.lights = [o for o in bpy.data.objects if o.type == "LIGHT" and o is not self.form]
        self.emitters = []
        for m in bpy.data.materials:
            e = emission_of(m)
            if e:
                self.emitters.append((m, e[3]))
        w = bpy.context.scene.world
        self.bg = w.node_tree.nodes.get("Background") if w else None
        self.bg_strength = self.bg.inputs["Strength"].default_value if self.bg else 0

    def static(self):
        self.form.hide_render = True
        for o in self.lights:
            o.hide_render = False
        for m, s in self.emitters:
            m.node_tree.nodes.get("Principled BSDF").inputs["Emission Strength"].default_value = s
        if self.bg:
            self.bg.inputs["Strength"].default_value = self.bg_strength
        if "outside" in bpy.data.collections:
            bpy.data.collections["outside"].hide_render = False

    def form_only(self):
        self.form.hide_render = False
        self.form.data.color = (1, 1, 1)
        self.form.data.energy = 1500
        for o in self.lights:
            o.hide_render = True
        for m, _ in self.emitters:
            m.node_tree.nodes.get("Principled BSDF").inputs["Emission Strength"].default_value = 0
        if self.bg:
            self.bg.inputs["Strength"].default_value = 0
        if "outside" in bpy.data.collections:
            bpy.data.collections["outside"].hide_render = True


# ----------------------------------------------------------------- bake
def setup_cycles():
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    s.cycles.device = "GPU"
    s.cycles.samples = SAMPLES
    s.cycles.use_denoising = False
    # No margin: empty texels stay exactly 0, which marks them for finish().
    s.render.bake.margin = 0
    s.render.bake.use_clear = True
    s.render.bake.target = "IMAGE_TEXTURES"


def bake(o, name, size, with_color):
    w, h = size
    img = bpy.data.images.new(name, w, h, float_buffer=True, alpha=False)
    nodes = []
    for m in {m for m in o.data.materials if m}:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        m.node_tree.nodes.active = n
        nodes.append((m, n))
    passes = {"DIRECT", "INDIRECT"} | ({"COLOR"} if with_color else set())
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    with override([o], o):
        bpy.ops.object.bake(type="DIFFUSE", pass_filter=passes, margin=0, use_clear=True)
    for m, n in nodes:
        m.node_tree.nodes.remove(n)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[:, :, :3].copy()
    np.save(os.path.join(WORK, name + ".npy"), a)
    used = a.max(axis=2) > 0
    print(f"BAKED {name} {w}x{h} used={used.mean():.0%} p50={np.percentile(a[used], 50):.4f} p99={np.percentile(a[used], 99):.4f} max={a.max():.3f}")
    return finish(a, used)


def blur5(a):
    """Separable 5-tap Gaussian (sigma about 1 texel) along both axes."""
    k = (0.054, 0.244, 0.404, 0.244, 0.054)
    for axis in (0, 1):
        p = np.pad(a, [(2, 2) if i == axis else (0, 0) for i in range(a.ndim)], mode="edge")
        n = a.shape[axis]
        a = sum(w * np.take(p, range(i, i + n), axis=axis) for i, w in enumerate(k))
    return a


def finish(a, used, blur=True):
    """Light denoise inside the islands, then fill every empty texel from its
    neighbours (push-pull), so filtering and mipmaps never pull in black.
    Square power-of-two images only."""
    m = used.astype(np.float32)
    if blur:
        num = blur5(a * m[..., None])
        den = blur5(m)
        a = np.where(used[..., None], num / np.maximum(den, 1e-6)[..., None], 0)
    else:
        a = np.where(used[..., None], a, 0)
    levels = [(a * m[..., None], m)]
    while levels[-1][1].shape[0] > 1:
        c, mm = levels[-1]
        h, w = mm.shape
        levels.append((c.reshape(h // 2, 2, w // 2, 2, 3).sum(axis=(1, 3)), mm.reshape(h // 2, 2, w // 2, 2).sum(axis=(1, 3))))
    c, mm = levels[-1]
    fill = c / np.maximum(mm, 1e-8)[..., None]
    for c, mm in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, axis=0), 2, axis=1)
        fill = np.where((mm > 0)[..., None], c / np.maximum(mm, 1e-8)[..., None], up)
    return fill.astype(np.float32)


def write_png(arr, path):
    h, w, c = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    ctype = {1: 0, 3: 2, 4: 6}[c]
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def encode(a, name, quality=90, grey=False):
    """Log-encode linear light to 8 bits, write top-down, compress to WebP."""
    if grey:
        a = a.mean(axis=2, keepdims=True)
    e = (np.log2(np.maximum(a, 2.0**LOG_MIN)) - LOG_MIN) / (LOG_MAX - LOG_MIN)
    e8 = (np.clip(e, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]
    if grey:
        e8 = np.repeat(e8, 3, axis=2)
    png = os.path.join(WORK, name + ".png")
    write_png(np.ascontiguousarray(e8), png)
    out = os.path.join(OUT, name + ".webp")
    subprocess.run(["cwebp", "-quiet", "-q", str(quality), "-m", "6", "-sharp_yuv", png, "-o", out], check=True)
    print(f"WROTE {out} {os.path.getsize(out) // 1024} KB")


# ----------------------------------------------------------------- plants
# Plants ship as impostors: each planter (tree and ferns) or pot is rendered
# in place, lit and shadowed by the hall, onto a transparent picture. The
# site stands it on a quad that turns about its vertical axis to face the
# camera. Every site camera sits in a narrow arc in front of the hall, so one
# view per plant holds up. Two passes, like the bake: static light, and the
# form's light alone in white for the site to tint.
VIEWER = (0.0, 13.2)  # roughly where the site's cameras stand (x, z)
ATLAS = 2048


def site_xyz(o):
    t = o.matrix_world.translation
    return t.x, t.z, -t.y


def plant_groups():
    plants = [o for o in bpy.data.objects if kind(o) == "plant"]
    anchors = [o for o in plants if o.name.startswith(("pine_sapling", "island_tree", "potted_plant_02_pot"))]
    groups = [dict(anchor=a, objs=[a]) for a in anchors]
    for o in plants:
        if o in anchors:
            continue
        p = site_xyz(o)
        near = min(groups, key=lambda g: sum((u - v) ** 2 for u, v in zip(site_xyz(g["anchor"]), p)))
        near["objs"].append(o)
    return groups


def plant_frame(g):
    """The group's picture frame: across (along the camera's right) and up."""
    import mathutils

    ax, _, az = site_xyz(g["anchor"])
    dx, dz = ax - VIEWER[0], az - VIEWER[1]
    n = math.hypot(dx, dz)
    d = (dx / n, dz / n)
    right = (-d[1], d[0])
    rs, ys = [], []
    for o in g["objs"]:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            x, y, z = w.x, w.z, -w.y
            rs.append((x - ax) * right[0] + (z - az) * right[1])
            ys.append(y)
    r0, r1, y0, y1 = min(rs), max(rs), min(ys), max(ys)
    pad = 0.03 * max(r1 - r0, y1 - y0)
    r0, r1, y1 = r0 - pad, r1 + pad, y1 + pad
    # Close plants need more pixels: the foreground pine fills a third of the screen.
    ppm = 440 if az > 7 else 280 if min(ys) > 3 else 170
    return dict(x=ax, z=az, d=d, right=right, r0=r0, r1=r1, y0=y0, y1=y1, ppm=ppm)


def render_plant(g, fr, name):
    import mathutils

    s = bpy.context.scene
    keep = set(g["objs"])
    for o in bpy.data.objects:
        if o.type in ("MESH", "CURVE", "FONT"):
            o.visible_camera = o in keep
    w, h = fr["r1"] - fr["r0"], fr["y1"] - fr["y0"]
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(w, h)
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100
    cam = bpy.data.objects.new(name, cam_data)
    s.collection.objects.link(cam)
    rc = (fr["r0"] + fr["r1"]) / 2
    cx = fr["x"] + fr["right"][0] * rc - fr["d"][0] * 30
    cz = fr["z"] + fr["right"][1] * rc - fr["d"][1] * 30
    cam.location = P(cx, (fr["y0"] + fr["y1"]) / 2, cz)
    cam.rotation_euler = mathutils.Vector(P(fr["d"][0], 0, fr["d"][1])).to_track_quat("-Z", "Y").to_euler()
    s.camera = cam
    s.render.resolution_x = max(8, round(w * fr["ppm"]))
    s.render.resolution_y = max(8, round(h * fr["ppm"]))
    s.render.resolution_percentage = 100
    s.render.film_transparent = True
    s.cycles.samples = max(64, SAMPLES // 2)
    s.cycles.use_denoising = True
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.view_settings.exposure = 0
    s.render.image_settings.file_format = "OPEN_EXR"
    s.render.image_settings.color_mode = "RGBA"
    s.render.image_settings.color_depth = "32"
    path = os.path.join(WORK, name + ".exr")
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(img.size[1], img.size[0], 4)[::-1]  # top-down
    bpy.data.images.remove(img)
    alpha = a[:, :, 3]
    rgb = np.where(alpha[..., None] > 0.004, a[:, :, :3] / np.maximum(alpha, 1e-4)[..., None], 0)
    print(f"RENDERED {name} {img_size(a)} alpha>0: {(alpha > 0.5).mean():.0%}")
    return rgb, alpha


def img_size(a):
    return f"{a.shape[1]}x{a.shape[0]}"


def encode_rgba(rgb, alpha, name):
    """Like encode(), with alpha; arrays are top-down already."""
    e = (np.log2(np.maximum(rgb, 2.0**LOG_MIN)) - LOG_MIN) / (LOG_MAX - LOG_MIN)
    e8 = (np.clip(e, 0, 1) * 255 + 0.5).astype(np.uint8)
    a8 = (np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8)[..., None]
    png = os.path.join(WORK, name + ".png")
    write_png(np.ascontiguousarray(np.concatenate([e8, a8], axis=2)), png)
    out = os.path.join(OUT, name + ".webp")
    # -exact keeps the colours filled in under transparent texels.
    subprocess.run(["cwebp", "-quiet", "-q", "90", "-alpha_q", "100", "-exact", "-m", "6", png, "-o", out], check=True)
    print(f"WROTE {out} {os.path.getsize(out) // 1024} KB")


def impostors(rig):
    import json

    groups = plant_groups()
    shots = []
    for i, g in enumerate(groups):
        fr = plant_frame(g)
        rig.static()
        still, alpha = render_plant(g, fr, f"plant{i}_static")
        rig.form_only()
        form, _ = render_plant(g, fr, f"plant{i}_form")
        shots.append((fr, still, form, alpha))
    rig.static()
    pos = shelf([(s[1].shape[1] / ATLAS, s[1].shape[0] / ATLAS) for s in shots], 4 / ATLAS)
    assert pos, "plants don't fit the atlas"
    still_a = np.zeros((ATLAS, ATLAS, 3), np.float32)
    form_a = np.zeros((ATLAS, ATLAS, 3), np.float32)
    alpha_a = np.zeros((ATLAS, ATLAS), np.float32)
    manifest = []
    for (fr, still, form, alpha), (u, v) in zip(shots, pos):
        x0, y0 = round(u * ATLAS), round(v * ATLAS)
        h, w = alpha.shape
        still_a[y0 : y0 + h, x0 : x0 + w] = still
        form_a[y0 : y0 + h, x0 : x0 + w] = form
        alpha_a[y0 : y0 + h, x0 : x0 + w] = alpha
        manifest.append(
            dict(
                x=round(fr["x"], 3),
                z=round(fr["z"], 3),
                across=[round(fr["r0"], 3), round(fr["r1"], 3)],
                up=[round(fr["y0"], 3), round(fr["y1"], 3)],
                # u0, v at the top, u1, v at the bottom; v runs down the file.
                rect=[x0 / ATLAS, y0 / ATLAS, (x0 + w) / ATLAS, (y0 + h) / ATLAS],
            )
        )
    used = alpha_a > 0.02
    encode_rgba(finish(still_a, used, blur=False), alpha_a, "plants_static")
    # The form's light on leaves is soft: half resolution is plenty.
    half = lambda a: a.reshape(ATLAS // 2, 2, ATLAS // 2, 2, *a.shape[2:]).mean(axis=(1, 3))
    form_h, alpha_h = half(form_a * alpha_a[..., None]), half(alpha_a)
    form_h = np.where(alpha_h[..., None] > 0.004, form_h / np.maximum(alpha_h, 1e-4)[..., None], 0)
    encode_rgba(finish(form_h.astype(np.float32), alpha_h > 0.02, blur=False), alpha_h, "plants_form")
    with open(os.path.join(OUT, "plants.json"), "w") as f:
        json.dump(dict(viewer=VIEWER, plants=manifest), f, indent=1)
    print(f"PLANTS {len(manifest)} impostors")


# ----------------------------------------------------------------- export
def emit_colors(objs):
    """Store each emitter's colour x strength in a colour attribute."""
    for o in objs:
        me = o.data
        attr = me.color_attributes.new("emit", "FLOAT_COLOR", "CORNER")
        cols = []
        for poly in me.polygons:
            m = me.materials[poly.material_index]
            r, g, b, s = emission_of(m)
            cols.extend([(r * s / EMIT_SCALE, g * s / EMIT_SCALE, b * s / EMIT_SCALE, 1.0)] * poly.loop_total)
        attr.data.foreach_set("color", [v for c in cols for v in c])
        me.color_attributes.active_color = attr


def export(objs, coll):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        me = o.data
        # Only the lightmap layout ships.
        for layer in list(me.uv_layers):
            if layer.name != "lightmap":
                me.uv_layers.remove(layer)
        o.select_set(True)
    raw = os.path.join(WORK, "hall_raw.glb")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=raw,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_yup=True,
    )
    out = os.path.join(OUT, "hall.glb")
    subprocess.run(["bunx", "gltfpack@0.25.0", "-i", raw, "-o", out, "-cc", "-kn", "-kv", "-vp", "14", "-vtf", "-vc", "12"], check=True)
    print(f"WROTE {out} {os.path.getsize(out) // 1024} KB (raw {os.path.getsize(raw) // 1024} KB)")


# ----------------------------------------------------------------- main
def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    # The haze is drawn live by the site; it would only dim the bake.
    for o in list(bpy.data.objects):
        if o.name.startswith("haze"):
            bpy.data.objects.remove(o)

    groups = {}
    for o in list(bpy.data.objects):
        k = kind(o)
        if k:
            groups.setdefault(k, []).append(o)
    for k, objs in sorted(groups.items()):
        print(f"KIND {k:6s} {len(objs):4d} objects {sum(tris(o.data) for o in objs):9d} tris")
    if DRY:
        for o in groups.get("mixed", []):
            print("  mixed:", o.name, [m.name for m in o.data.materials])
        names = sorted({o.name.split(".")[0].rstrip("~") for o in groups.get("props", [])})
        print("  props:", ", ".join(names))
        return

    coll = bpy.data.collections.new("export")
    bpy.context.scene.collection.children.link(coll)

    # Mixed objects split by material, then sort the pieces.
    for o in groups.pop("mixed", []):
        c = realize(o, coll)
        with override([c], c):
            bpy.ops.mesh.separate(type="MATERIAL")
        for part in [x for x in coll.objects if x.name.startswith(c.name)]:
            # Separated parts keep every slot; the faces say which one is used.
            used = part.data.materials[part.data.polygons[0].material_index]
            groups.setdefault("emit" if emission_of(used) else "props", []).append(part)

    def copies(k):
        return [o if o.users_collection and o.users_collection[0] is coll else realize(o, coll) for o in groups.get(k, [])]

    # Originals hide from render later so each surface is lit once.
    originals = [o for k in ("arch", "props", "emit") for o in groups.get(k, []) if o.users_collection[0] is not coll]
    arch = join(copies("arch"), "arch")
    props_parts = copies("props")
    for c in props_parts:
        decimate(c)
        unwrap(c)
    chart_pack([(c, prop_weight(c.name)) for c in props_parts])
    props = join(props_parts, "props")
    print(f"UV props covers {uv_area(props):.0%} of its atlas")
    emit_parts = copies("emit")
    emit_colors(emit_parts)
    emit = join(emit_parts, "emit")
    print(f"JOINED arch {tris(arch.data)} props {tris(props.data)} emit {tris(emit.data)} tris")

    # The bake's own floor stands in for the real slab, which it would overlap.
    floor_real = bpy.data.objects.get("floor_left")
    floor_real.hide_render = True
    floor = floor_plane(floor_real.data.materials[0], coll)

    for o in originals:
        o.hide_render = True
    # The coping and the pool water are drawn live; hidden here, the floor
    # bake records the light that falls where they are (moon on the water).
    for o in bpy.data.objects:
        if o.name.startswith(("coping", "pool_water")):
            o.hide_render = True

    cull_hidden(arch)
    unwrap(arch)
    pack(arch)
    print(f"UV arch covers {uv_area(arch):.0%} of its atlas")
    props.data.uv_layers.active = props.data.uv_layers["lightmap"]
    for layer in props.data.uv_layers:
        layer.active_render = layer.name == "UVMap"

    setup_cycles()
    rig = Rig()
    if "arch" in ONLY:
        rig.static()
        encode(bake(arch, "arch_static", (2048, 2048), False), "arch_static")
        rig.form_only()
        encode(bake(arch, "arch_form", (1024, 1024), False), "arch_form", grey=True)
    if "floor" in ONLY:
        rig.static()
        encode(bake(floor, "floor_static", (2048, 2048), False), "floor_static")
        rig.form_only()
        encode(bake(floor, "floor_form", (1024, 1024), False), "floor_form", grey=True)
    if "props" in ONLY:
        # A diffuse bake sees no colour on metal (metallic 1 has no diffuse),
        # so steel and aluminium would bake black. Bake every prop as a
        # dielectric: the site has no specular for them anyway.
        for m in {m for m in props.data.materials if m and m.node_tree}:
            pb = m.node_tree.nodes.get("Principled BSDF")
            if not pb:
                continue
            for link in list(m.node_tree.links):
                if link.to_socket == pb.inputs["Metallic"]:
                    m.node_tree.links.remove(link)
            pb.inputs["Metallic"].default_value = 0.0
        rig.static()
        encode(bake(props, "props_static", (2048, 2048), True), "props_static")
        rig.form_only()
        encode(bake(props, "props_form", (1024, 1024), True), "props_form")
    rig.static()

    export([arch, props, emit], coll)
    # Last: it changes camera visibility and render settings.
    if "plants" in ONLY:
        impostors(rig)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "baked.blend"))


main()

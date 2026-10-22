"""
Terra_Map 3D models (Fase 16) — built in Blender, exported as .glb for the app.

Run (headless, from the repository root):

    blender -b --factory-startup -P ui/models/build_models.py

For every model it writes `ui/public/models/<kind>.glb` (loaded by
`ui/src/scene/models.ts`) and `ui/public/models/<kind>.png` (catalog
thumbnail, transparent background). `cable.png` is a thumbnail only — cables
are generated along their path by `scene/cables.ts`.

Conventions the app relies on:
  - Blender is Z-up; the glTF exporter turns it into Y-up. The front of a
    model (door) faces Blender -Y, which is three.js +Z.
  - Top-level empties name the construction phase of their children:
    `p0_*` foundations, `p1_*` structure, `p2_*` finishing. The app shows
    every node whose phase is <= the entity phase.
  - Building only: `*_floor` nodes are one storey and repeat once per floor;
    `*_top` nodes sit on the first floor and go up with the floor count.
    The storey height travels in the scene extras (`floor_height`).
  - One flat color per material (the app bakes material colors into vertex
    colors, `scene/merge-content.ts`), flat-shaded low-poly geometry.

Sizes in meters, real scale against the 7 m pole (Q_LIST.md Q39).
"""

import math
import os
import random
import shutil

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "public", "models"))
# Fase 17: the landing page shows the same models (hero + showcase).
LANDING = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "landing", "public", "models"))
LANDING_KINDS = ("house", "building", "tree", "bush", "antenna", "pole", "olt", "box", "splitter", "onu", "router")
THUMB_SIZE = 256
FLOOR_HEIGHT = 2.8  # building storey (floor-to-floor)

# Scene palette (sRGB) — the same colors the procedural models used.
COLORS = {
    "slab": "#b9b9bf",
    "walls": "#f3f1ec",
    "structure": "#d8d5cf",
    "roof": "#a15c48",
    "ridge": "#7f4536",
    "brick": "#8c4a3a",
    "glass": "#4a6b8a",
    "frame": "#fafafa",
    "door": "#7a5b3f",
    "lot": "#cfc9b8",
    "lotLine": "#8a8578",
    "metal": "#9a9aa0",
    "dark": "#3a3a3c",
    "port": "#1d1d1f",
    "light": "#f3f1ec",
    "accent": "#0071e3",
    "wood": "#8a6f55",
    "insulator": "#e6e6e8",
    "warning": "#ff9500",
    "trunk": "#6b4a2f",
    "crown": "#3f7d3a",
    "crownDark": "#356b31",
    "bush": "#4f8f45",
    "fiber": "#f5c518",
    # Fase 17: realistic vegetation, terrain details, bridges.
    "bark": "#5b4330",
    "leaf0": "#3d6e34",
    "leaf1": "#4c8540",
    "leaf2": "#5f9a4a",
    "leafDry": "#7a8f3e",
    "grass0": "#5c8f3e",
    "grass1": "#78a84e",
    "snow": "#f2f5f9",
    "snowShade": "#d9e2ec",
    "rock0": "#7c7c82",
    "rock1": "#9b9aa0",
    "dirt0": "#6e5238",
    "dirt1": "#8a6a48",
    "sand0": "#cdb67c",
    "sand1": "#e2d3a4",
    "shell": "#f3e6d8",
    "concrete": "#b4b2ac",
    "concreteDark": "#8f8d88",
}

_materials = {}


# ---------------------------------------------------------------- helpers


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(key):
    """One Principled material per palette color (cached per scene build)."""
    if key in _materials:
        return _materials[key]
    hex_ = COLORS[key].lstrip("#")
    rgb = [srgb_to_linear(int(hex_[i : i + 2], 16) / 255) for i in (0, 2, 4)]
    m = bpy.data.materials.new(key)
    if hasattr(m, "use_nodes"):
        try:
            m.use_nodes = True
        except (AttributeError, TypeError):
            pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    m.diffuse_color = (*rgb, 1)
    _materials[key] = m
    return m


def empty(name):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def finish(parent, name, bm, color, smooth=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = smooth
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(color))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def box(parent, name, color, sx, sy, sz, x=0.0, y=0.0, z=0.0, rot_z=0.0):
    """Box of size sx × sy × sz whose bottom face sits at height z."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if rot_z:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, y, z + sz / 2), verts=bm.verts)
    return finish(parent, name, bm, color)


def cyl(parent, name, color, r1, r2, h, x=0.0, y=0.0, z=0.0, segs=12, tilt=None):
    """Cylinder/cone along Z (bottom at z), or tilted: tilt = (angle, axis)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h
    )
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    if tilt:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(tilt[0], 3, tilt[1]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, y, z), verts=bm.verts)
    return finish(parent, name, bm, color)


def ico(parent, name, color, r, x=0.0, y=0.0, z=0.0, sz=1.0, subdiv=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bmesh.ops.scale(bm, vec=(1, 1, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, y, z), verts=bm.verts)
    return finish(parent, name, bm, color)


def prism(parent, name, color, w, d, h, z):
    """Gable roof: triangular prism, ridge along Y, base w × d at height z."""
    bm = bmesh.new()
    hw, hd = w / 2, d / 2
    v = [
        bm.verts.new(p)
        for p in [(-hw, -hd, z), (hw, -hd, z), (0, -hd, z + h), (-hw, hd, z), (hw, hd, z), (0, hd, z + h)]
    ]
    for f in [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (0, 2, 5, 3), (1, 4, 5, 2)]:
        bm.faces.new([v[i] for i in f])
    return finish(parent, name, bm, color)


def on_wall(parent, name, color, face, hx, hy, u, z, w, h, depth, proud):
    """Box on a wall face of a block with half extents hx, hy.

    `u` = offset along the face, `z` = bottom, `proud` = how far it sticks
    out of the wall (depth is centered on wall + proud - depth / 2).
    """
    if face in ("front", "back"):
        sign = -1 if face == "front" else 1
        y = sign * (hy + proud - depth / 2)
        return box(parent, name, color, w, depth, h, u, y, z)
    sign = -1 if face == "left" else 1
    x = sign * (hx + proud - depth / 2)
    return box(parent, name, color, depth, w, h, x, u, z)


def window(parent, name, face, hx, hy, u, z, w, h):
    on_wall(parent, f"{name}_frame", "frame", face, hx, hy, u, z, w + 0.16, h + 0.16, 0.1, 0.05)
    on_wall(parent, f"{name}_glass", "glass", face, hx, hy, u, z + 0.08, w, h, 0.1, 0.07)
    on_wall(parent, f"{name}_sill", "frame", face, hx, hy, u, z - 0.06, w + 0.3, 0.06, 0.18, 0.14)


# ---------------------------------------------------------------- models


def build_house():
    """Single-storey house: 7 × 6 m, 2.7 m walls, ridge at ~4.3 m."""
    w, d, wall_h, slab_h = 7.0, 6.0, 2.7, 0.25
    p0 = empty("p0_foundation")
    box(p0, "slab", "slab", w + 0.4, d + 0.4, slab_h)
    box(p0, "step", "slab", 1.6, 0.6, 0.15, 0, -(d / 2 + 0.5), 0)

    p1 = empty("p1_walls")
    box(p1, "walls", "walls", w, d, wall_h, z=slab_h)
    box(p1, "plinth", "structure", w + 0.04, d + 0.04, 0.35, z=slab_h)

    p2 = empty("p2_finish")
    top = slab_h + wall_h
    prism(p2, "roof", "roof", w + 0.8, d + 0.8, 1.4, top)
    box(p2, "ridge", "ridge", 0.22, d + 0.9, 0.12, 0, 0, top + 1.34)
    box(p2, "chimney", "brick", 0.6, 0.6, 1.5, 1.8, 1.2, top + 0.4)
    box(p2, "chimney_cap", "slab", 0.75, 0.75, 0.1, 1.8, 1.2, top + 1.9)
    hx, hy = w / 2, d / 2
    sill = slab_h + 0.95
    for face in ("front", "back"):
        for i, u in enumerate((-2.2, 2.2)):
            window(p2, f"win_{face}_{i}", face, hx, hy, u, sill, 1.2, 1.15)
    for face in ("left", "right"):
        window(p2, f"win_{face}", face, hx, hy, 0, sill, 1.1, 1.15)
    on_wall(p2, "door_frame", "frame", "front", hx, hy, 0, slab_h, 1.2, 2.2, 0.1, 0.05)
    on_wall(p2, "door", "door", "front", hx, hy, 0, slab_h, 1.0, 2.1, 0.1, 0.07)
    on_wall(p2, "canopy", "roof", "front", hx, hy, 0, slab_h + 2.35, 1.8, 0.1, 0.8, 0.8)


def build_building():
    """Building: 10 × 10 m, one 2.8 m storey per floor (repeated by the app)."""
    w, base_h = 10.0, 0.4
    hw = w / 2
    p0 = empty("p0_foundation")
    box(p0, "foundation", "slab", w + 0.8, w + 0.8, base_h)

    # One storey from base_h to base_h + FLOOR_HEIGHT.
    f1 = empty("p1_floor")
    box(f1, "floor_slab", "structure", w + 0.3, w + 0.3, 0.25, z=base_h)
    box(f1, "core", "structure", w - 0.4, w - 0.4, FLOOR_HEIGHT - 0.25, z=base_h + 0.25)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f1, f"col_{sx}_{sy}", "slab", 0.5, 0.5, FLOOR_HEIGHT - 0.25, sx * (hw - 0.25), sy * (hw - 0.25), base_h + 0.25)

    f2 = empty("p2_floor")
    band_z, band_h = base_h + 0.95, 1.5
    core = (w - 0.4) / 2
    for face in ("front", "back", "left", "right"):
        on_wall(f2, f"band_{face}", "glass", face, core, core, 0, band_z, w - 1.6, band_h, 0.1, 0.06)
        for i in range(5):
            u = -3.3 + i * 1.65
            on_wall(f2, f"mullion_{face}_{i}", "frame", face, core, core, u, band_z, 0.1, band_h, 0.1, 0.1)
        on_wall(f2, f"sill_{face}", "frame", face, core, core, 0, band_z - 0.08, w - 1.4, 0.08, 0.2, 0.16)

    top_z = base_h + FLOOR_HEIGHT
    t = empty("p2_top")
    box(t, "roof_slab", "structure", w + 0.3, w + 0.3, 0.25, z=top_z)
    for i, (sx, sy, along_x) in enumerate([(0, -1, True), (0, 1, True), (-1, 0, False), (1, 0, False)]):
        lx, ly = (w + 0.3, 0.2) if along_x else (0.2, w + 0.3)
        box(t, f"parapet_{i}", "structure", lx, ly, 0.7, sx * (hw + 0.05), sy * (hw + 0.05), top_z + 0.25)
    box(t, "hvac", "metal", 2.2, 1.4, 1.0, -2.0, 1.5, top_z + 0.25)
    cyl(t, "tank", "light", 0.7, 0.7, 1.4, 2.4, 2.4, top_z + 0.25, segs=14)
    box(t, "stair_hut", "structure", 2.4, 2.4, 2.2, 2.4, -2.2, top_z + 0.25)

    e = empty("p2_entrance")
    on_wall(e, "entrance", "glass", "front", core, core, 0, base_h, 2.4, 2.3, 0.1, 0.08)
    on_wall(e, "entrance_frame", "dark", "front", core, core, 0, base_h + 2.3, 2.6, 0.12, 0.12, 0.1)
    on_wall(e, "canopy", "slab", "front", core, core, 0, base_h + 2.5, 3.4, 0.15, 1.6, 1.6)

    bpy.context.scene["floor_height"] = FLOOR_HEIGHT


def build_lot():
    """Urban lot: 16 × 12 m marked ground with boundary strips and stakes."""
    w, d = 16.0, 12.0
    p0 = empty("p0_lot")
    box(p0, "ground", "lot", w, d, 0.08)
    for i, (sx, sy, along_x) in enumerate([(0, -1, True), (0, 1, True), (-1, 0, False), (1, 0, False)]):
        lx, ly = (w, 0.2) if along_x else (0.2, d)
        box(p0, f"edge_{i}", "lotLine", lx, ly, 0.12, sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(p0, f"stake_{sx}_{sy}", "warning", 0.12, 0.12, 0.6, sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0)


def build_antenna():
    """Antenna mast: 6 m, three sector panels and a lightning rod."""
    p = empty("p0_antenna")
    box(p, "plinth", "slab", 0.9, 0.9, 0.3)
    cyl(p, "mast", "metal", 0.15, 0.09, 6.0, z=0.3)
    cyl(p, "ring", "dark", 0.5, 0.5, 0.06, z=4.9, segs=16)
    for i in range(3):
        a = i / 3 * math.tau
        x, y = math.cos(a) * 0.48, math.sin(a) * 0.48
        box(p, f"panel_{i}", "accent", 0.12, 0.34, 1.4, x, y, 4.6, rot_z=a)
        box(p, f"arm_{i}", "dark", 0.4, 0.05, 0.05, x / 2, y / 2, 5.4, rot_z=a)
    cyl(p, "dish", "light", 0.3, 0.3, 0.08, 0.0, -0.2, 3.6, segs=16, tilt=(math.pi / 2, "X"))
    cyl(p, "rod", "dark", 0.02, 0.02, 0.8, z=6.3, segs=6)


def build_router():
    p = empty("p0_router")
    box(p, "body", "dark", 0.5, 0.35, 0.12, z=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(p, f"foot_{sx}_{sy}", "port", 0.04, 0.04, 0.02, sx * 0.2, sy * 0.13, 0)
    box(p, "leds", "accent", 0.3, 0.02, 0.02, 0, -0.18, 0.08)
    for i, x in enumerate((-0.17, 0.17)):
        cyl(p, f"aerial_{i}", "dark", 0.016, 0.012, 0.32, x, 0.15, 0.14, segs=8)


def build_switch():
    p = empty("p0_switch")
    box(p, "body", "dark", 0.6, 0.4, 0.1)
    for i in range(8):
        box(p, f"port_{i}", "port", 0.045, 0.02, 0.035, -0.24 + i * 0.058, -0.2, 0.03)
    box(p, "leds", "accent", 0.5, 0.02, 0.012, 0, -0.205, 0.075)


def build_olt():
    """OLT rack: 1.2 × 0.6 × 1.0 m cabinet with line cards and vents."""
    p = empty("p0_olt")
    box(p, "plinth", "port", 1.16, 0.56, 0.06)
    box(p, "cabinet", "dark", 1.2, 0.6, 0.94, z=0.06)
    for i in range(4):
        box(p, f"card_{i}", "metal", 1.0, 0.03, 0.12, 0, -0.3, 0.5 + i * 0.13)
        box(p, f"card_led_{i}", "accent", 0.06, 0.02, 0.04, 0.42, -0.31, 0.54 + i * 0.13)
    for i in range(5):
        box(p, f"vent_{i}", "port", 0.8, 0.02, 0.03, 0, -0.3, 0.15 + i * 0.06)
    box(p, "top", "metal", 1.22, 0.62, 0.03, z=1.0)


def build_onu():
    p = empty("p0_onu")
    box(p, "body", "light", 0.35, 0.12, 0.25)
    box(p, "leds", "accent", 0.26, 0.02, 0.02, 0, -0.065, 0.17)
    box(p, "label", "metal", 0.12, 0.02, 0.05, 0, -0.065, 0.06)
    for i, x in enumerate((-0.12, 0.12)):
        cyl(p, f"aerial_{i}", "dark", 0.012, 0.01, 0.16, x, 0.03, 0.25, segs=8)


def build_splitter():
    """Optical splitter closure with four output ports."""
    p = empty("p0_splitter")
    box(p, "body", "metal", 0.5, 0.3, 0.26)
    box(p, "lid", "light", 0.52, 0.32, 0.05, z=0.26)
    cyl(p, "input", "dark", 0.035, 0.035, 0.12, -0.31, 0, 0.13, segs=10, tilt=(math.pi / 2, "Y"))
    for i in range(4):
        cyl(p, f"port_{i}", "accent", 0.028, 0.028, 0.1, -0.15 + i * 0.1, 0, 0.31, segs=10)


def build_pole():
    """Telecom pole: 7 m wooden pole, crossarm, insulators and a cable drop box."""
    p = empty("p0_pole")
    cyl(p, "pole", "wood", 0.14, 0.1, 7.0, segs=12)
    box(p, "crossarm", "wood", 1.5, 0.1, 0.1, 0, 0, 6.3)
    box(p, "brace", "metal", 0.06, 0.06, 0.5, 0, -0.12, 5.9)
    for i, x in enumerate((-0.6, -0.2, 0.2, 0.6)):
        cyl(p, f"insulator_{i}", "insulator", 0.04, 0.05, 0.14, x, 0, 6.4, segs=8)
    box(p, "drop_box", "light", 0.25, 0.12, 0.35, 0, -0.18, 4.2)
    box(p, "tag", "warning", 0.18, 0.02, 0.1, 0, -0.14, 2.0)


def build_box():
    """Distribution box: orange cabinet on a post."""
    p = empty("p0_box")
    cyl(p, "post", "metal", 0.07, 0.07, 1.1, segs=10)
    box(p, "cabinet", "warning", 0.6, 0.3, 0.5, z=1.1)
    box(p, "cap", "dark", 0.66, 0.36, 0.04, z=1.6)
    box(p, "seam", "dark", 0.01, 0.02, 0.44, 0, -0.155, 1.13)
    box(p, "lock", "port", 0.04, 0.03, 0.06, 0.05, -0.16, 1.32)


def build_marker():
    """Map pin: inverted cone + head. The text label is added by the app."""
    p = empty("p0_marker")
    cyl(p, "tip", "accent", 0.0, 0.3, 1.2, segs=20)
    ico(p, "head", "accent", 0.32, z=1.35, subdiv=2)


def lumpy(parent, name, color, r, x, y, z, sz=1.0, subdiv=2, amount=0.18, seed=0, smooth=True):
    """Icosphere with its vertices pushed in/out — organic foliage / rock / snow."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        n = v.co.normalized()
        v.co += n * r * rnd.uniform(-amount, amount)
    bmesh.ops.scale(bm, vec=(1, 1, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, y, z), verts=bm.verts)
    return finish(parent, name, bm, color, smooth)


def branch(parent, name, base, tip, r0, r1, color="bark"):
    """Tapered limb from `base` to `tip` (world vectors)."""
    d = Vector(tip) - Vector(base)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=7, radius1=r0, radius2=r1, depth=d.length)
    bmesh.ops.translate(bm, vec=(0, 0, d.length / 2), verts=bm.verts)
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix()
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=base, verts=bm.verts)
    return finish(parent, name, bm, color)


def build_tree():
    """Broadleaf tree (~6.8 m): tapered trunk, four limbs and a crown of
    irregular leaf clusters in three greens. Instanced by the app."""
    p = empty("p0_tree")
    rnd = random.Random(7)
    branch(p, "trunk", (0, 0, 0), (0.1, 0.05, 3.4), 0.3, 0.16)
    cyl(p, "flare", "bark", 0.42, 0.3, 0.35, segs=7)
    limbs = []
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        base = (0.05 * math.cos(a), 0.05 * math.sin(a), 2.2 + i * 0.35)
        tip = (1.7 * math.cos(a), 1.7 * math.sin(a), 4.2 + i * 0.25)
        branch(p, f"limb_{i}", base, tip, 0.13, 0.05)
        limbs.append(tip)
    clusters = [(0.1, 0.0, 5.3, 1.75)] + [(x, y, z + 0.3, 1.25) for x, y, z in limbs]
    for i in range(6):
        a = i / 6 * math.tau
        clusters.append((1.15 * math.cos(a), 1.15 * math.sin(a), 4.4 + rnd.uniform(-0.3, 0.6), 1.05))
    for i, (x, y, z, r) in enumerate(clusters):
        color = ("leaf0", "leaf1", "leaf2")[i % 3]
        lumpy(p, f"leaves_{i}", color, r, x, y, z, sz=0.82, amount=0.22, seed=i + 1)


def build_bush():
    """Shrub (~1.3 m): a mound of leaf clusters with a few dry tips."""
    p = empty("p0_bush")
    rnd = random.Random(3)
    lumpy(p, "core", "leaf0", 0.75, 0, 0, 0.6, sz=0.75, amount=0.2, seed=11)
    for i in range(6):
        a = i / 6 * math.tau + rnd.uniform(-0.3, 0.3)
        d = rnd.uniform(0.45, 0.65)
        color = ("leaf1", "leaf2", "leafDry")[i % 3]
        lumpy(p, f"cluster_{i}", color, rnd.uniform(0.38, 0.5), d * math.cos(a), d * math.sin(a), 0.42 + rnd.uniform(0, 0.25), sz=0.8, amount=0.22, seed=20 + i)


# ---------------------------------------------------------------- Fase 17: terrain details


def build_detail_grass():
    """Grass tuft (~0.45 m): a fan of thin tapered blades in two greens."""
    p = empty("p0_detail_grass")
    rnd = random.Random(5)
    bm = bmesh.new()
    for i in range(14):
        a = rnd.uniform(0, math.tau)
        lean = rnd.uniform(0.05, 0.25)
        h = rnd.uniform(0.25, 0.45)
        w = 0.03
        ox, oy = rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)
        dx, dy = math.cos(a), math.sin(a)
        px, py = -dy * w, dx * w
        v0 = bm.verts.new((ox - px, oy - py, 0))
        v1 = bm.verts.new((ox + px, oy + py, 0))
        v2 = bm.verts.new((ox + dx * lean, oy + dy * lean, h))
        bm.faces.new((v0, v1, v2))
    finish(p, "blades", bm, "grass0")
    bm = bmesh.new()
    for i in range(8):
        a = rnd.uniform(0, math.tau)
        h = rnd.uniform(0.2, 0.35)
        ox, oy = rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1)
        dx, dy = math.cos(a), math.sin(a)
        v0 = bm.verts.new((ox + dy * 0.025, oy - dx * 0.025, 0))
        v1 = bm.verts.new((ox - dy * 0.025, oy + dx * 0.025, 0))
        v2 = bm.verts.new((ox + dx * 0.15, oy + dy * 0.15, h))
        bm.faces.new((v0, v1, v2))
    finish(p, "blades_light", bm, "grass1")


def build_detail_snow():
    """Snow drift (~1 m): a flattened mound with a smaller one beside it."""
    p = empty("p0_detail_snow")
    lumpy(p, "drift", "snow", 0.55, 0, 0, 0.02, sz=0.38, amount=0.12, seed=31)
    lumpy(p, "drift_small", "snowShade", 0.3, 0.45, 0.25, 0.0, sz=0.4, amount=0.15, seed=32)


def build_detail_rock():
    """Boulder group (~0.9 m) in two greys."""
    p = empty("p0_detail_rock")
    lumpy(p, "boulder", "rock0", 0.45, 0, 0, 0.25, sz=0.7, subdiv=1, amount=0.3, seed=41, smooth=False)
    lumpy(p, "stone", "rock1", 0.22, 0.45, -0.2, 0.1, sz=0.75, subdiv=1, amount=0.3, seed=42, smooth=False)


def build_detail_dirt():
    """Clods and pebbles (~0.5 m)."""
    p = empty("p0_detail_dirt")
    rnd = random.Random(51)
    for i in range(5):
        lumpy(p, f"clod_{i}", ("dirt0", "dirt1", "rock0")[i % 3], rnd.uniform(0.07, 0.14), rnd.uniform(-0.22, 0.22), rnd.uniform(-0.22, 0.22), 0.03, sz=0.6, subdiv=1, amount=0.3, seed=60 + i, smooth=False)


def build_detail_sand():
    """Wind ripples and a shell (~1 m)."""
    p = empty("p0_detail_sand")
    for i in range(3):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
        bmesh.ops.scale(bm, vec=(0.55, 0.07, 0.035), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, -0.25 + i * 0.25, 0.0), verts=bm.verts)
        finish(p, f"ripple_{i}", bm, "sand1")
    lumpy(p, "shell", "shell", 0.06, 0.3, 0.12, 0.02, sz=0.5, subdiv=1, amount=0.15, seed=71)


# ---------------------------------------------------------------- Fase 17: bridge parts


def build_bridge_pier():
    """Pier column, 1 m tall (the app stretches it to the gap), 0.9 m square."""
    p = empty("p0_bridge_pier")
    box(p, "column", "concrete", 0.9, 0.9, 1.0)
    box(p, "footing", "concreteDark", 1.4, 1.4, 0.04)


def build_bridge_cap():
    """Pier cap beam under the deck: 1 m wide (stretched to the road width)."""
    p = empty("p0_bridge_cap")
    box(p, "beam", "concreteDark", 1.0, 1.3, 0.7)


def build_guardrail():
    """Concrete safety barrier, 2 m long along X, 0.8 m tall (New Jersey profile)."""
    p = empty("p0_guardrail")
    bm = bmesh.new()
    profile = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.08), (0.12, 0.3), (0.08, 0.8), (-0.08, 0.8), (-0.12, 0.3), (-0.3, 0.08)]
    front = [bm.verts.new((-1.0, y, z)) for y, z in profile]
    back = [bm.verts.new((1.0, y, z)) for y, z in profile]
    bm.faces.new(front[::-1])
    bm.faces.new(back)
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    finish(p, "barrier", bm, "concrete")


def build_cable():
    """Thumbnail only: a cable reel with fiber wound on it."""
    p = empty("p0_cable")
    for i, z in enumerate((0.0, 0.56)):
        cyl(p, f"flange_{i}", "dark", 0.55, 0.55, 0.06, z=z, segs=24)
    cyl(p, "wound", "fiber", 0.42, 0.42, 0.5, z=0.06, segs=24)
    cyl(p, "hub", "metal", 0.12, 0.12, 0.66, z=-0.02, segs=12)
    cyl(p, "tail", "fiber", 0.03, 0.03, 0.7, 0.42, -0.05, 0.31, segs=8, tilt=(math.pi / 2, "X"))


MODELS = {
    "house": build_house,
    "building": build_building,
    "lot": build_lot,
    "antenna": build_antenna,
    "router": build_router,
    "switch": build_switch,
    "olt": build_olt,
    "onu": build_onu,
    "splitter": build_splitter,
    "pole": build_pole,
    "box": build_box,
    "marker": build_marker,
    "tree": build_tree,
    "bush": build_bush,
    "cable": build_cable,
    "detail_grass": build_detail_grass,
    "detail_snow": build_detail_snow,
    "detail_rock": build_detail_rock,
    "detail_dirt": build_detail_dirt,
    "detail_sand": build_detail_sand,
    "bridge_pier": build_bridge_pier,
    "bridge_cap": build_bridge_cap,
    "guardrail": build_guardrail,
}
THUMB_ONLY = {"cable"}
# Fase 17: scene parts with no catalog card — exported without a thumbnail.
NO_THUMB = {"detail_grass", "detail_snow", "detail_rock", "detail_dirt", "detail_sand", "bridge_pier", "bridge_cap", "guardrail"}

# ---------------------------------------------------------------- export + thumbnail


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()


def export_glb(kind):
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f"{kind}.glb"),
        export_format="GLB",
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=False,
    )


def stack_floors(floors):
    """Thumbnail of the building with `floors` storeys (the .glb keeps one)."""
    scene = bpy.context.scene
    for ob in [o for o in scene.objects if o.type == "EMPTY" and o.name.endswith("_floor")]:
        for f in range(1, floors):
            copy = empty(f"{ob.name}_{f}")
            copy.location.z = f * FLOOR_HEIGHT
            for child in ob.children:
                c = child.copy()
                scene.collection.objects.link(c)
                c.parent = copy
    for ob in [o for o in scene.objects if o.type == "EMPTY" and o.name.endswith("_top")]:
        ob.location.z = (floors - 1) * FLOOR_HEIGHT


def set_engine(scene):
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 32


def render_thumb(kind):
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    corners = []
    for ob in scene.objects:
        if ob.type == "MESH":
            corners += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    center = (lo + hi) / 2
    size = (hi - lo).length

    cam_data = bpy.data.cameras.new("thumb")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("thumb", cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((1.0, -1.0, 0.8)).normalized()  # front-right, from above
    cam.location = center + direction * size * 2
    cam.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    local = [inv @ c for c in corners]
    xs, ys = [p.x for p in local], [p.y for p in local]
    shift = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0))
    cam.location = cam.matrix_world @ shift
    cam_data.ortho_scale = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.12
    cam_data.clip_end = size * 6
    scene.camera = cam

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.color = (0.8, 0.82, 0.85)
    if world.node_tree:
        bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
        if bg:
            bg.inputs["Color"].default_value = (0.8, 0.82, 0.85, 1)
            bg.inputs["Strength"].default_value = 0.9

    set_engine(scene)
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = THUMB_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 100
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    scene.render.filepath = os.path.join(OUT, f"{kind}.png")
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    for kind, build in MODELS.items():
        reset()
        build()
        if kind not in THUMB_ONLY:
            export_glb(kind)
        if kind == "building":
            stack_floors(4)
        if kind not in NO_THUMB:
            render_thumb(kind)
        print(f"[terra-map] {kind}: ok")
    os.makedirs(LANDING, exist_ok=True)
    for kind in LANDING_KINDS:
        shutil.copy(os.path.join(OUT, f"{kind}.glb"), os.path.join(LANDING, f"{kind}.glb"))
    print(f"[terra-map] landing: {len(LANDING_KINDS)} models copied")


main()

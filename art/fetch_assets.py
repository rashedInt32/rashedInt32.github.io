"""
Download the CC0 assets the hall uses, from Poly Haven (all assets there are
CC0). Source files only, for building in Blender; nothing here ships to the
web, the site gets the baked result. Kept out of git (see .gitignore).

    python3 art/fetch_assets.py

Re-running skips files already downloaded.
"""

import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "assets")
UA = {"User-Agent": "harbor-asset-fetch/1.0"}

# Credited in README. Poly Haven, CC0: https://polyhaven.com/license
ASSETS = [
    "pine_sapling_medium",
    "island_tree_02",
    "fern_02",
    "potted_plant_02",
    "wooden_crate_01",
    "wooden_crate_02",
    "old_military_crate",
    "industrial_storage_cart",
    "hanging_industrial_lamp",
    "painted_wooden_bench",
    "life_jacket",
    "WetFloorSign_01",
    "Barrel_02",
    "desk_lamp_arm_01",
    "SchoolChair_01",
    "clipboard",
    "metal_toolbox",
    "vintage_binocular",
]


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req) as r, open(path + ".part", "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(path + ".part", path)


def main():
    for asset in ASSETS:
        req = urllib.request.Request(f"https://api.polyhaven.com/files/{asset}", headers=UA)
        with urllib.request.urlopen(req) as r:
            files = json.load(r)
        entry = files["gltf"]["1k"]["gltf"]
        base = os.path.join(OUT, asset)
        get(entry["url"], os.path.join(base, os.path.basename(entry["url"])))
        for rel, inc in entry.get("include", {}).items():
            get(inc["url"], os.path.join(base, rel))
        print("ok", asset)


if __name__ == "__main__":
    main()

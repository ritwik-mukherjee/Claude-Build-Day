#!/usr/bin/env python3
"""Copy + optimize the uploaded assets ("Claude Build day 2/") into public/assets/.

The staging folder is left untouched. Run from the repo root:  python3 scripts/prepare_assets.py
Requires Pillow. Output is committed, so the game itself has no Python dependency.

- Models: glTF + bin copied verbatim; textures downscaled to <= MAX_TEX px (JPEG unless the
  material needs alpha) and the glTF image URIs / mimeTypes rewritten to match.
- HDRI: copied as-is.
- Metal PBR maps: downscaled to 1024 JPEG.
- VFX: a curated subset of Kenney CC0 particle sprites, downscaled to 256 px RGBA PNG.
"""
import json, os, shutil, sys
from PIL import Image

SRC = "Claude Build day 2"
DST = "public/assets"
MAX_TEX = 1024

def fit(im, max_side):
    w, h = im.size
    k = min(1.0, max_side / max(w, h))
    return im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS) if k < 1 else im

def model(name, out):
    src, dst = f"{SRC}/Models/{name}", f"{DST}/models/{out}"
    os.makedirs(f"{dst}/textures", exist_ok=True)
    g = json.load(open(f"{src}/scene.gltf"))
    blend = {m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index") for m in g.get("materials", []) if m.get("alphaMode", "OPAQUE") != "OPAQUE"}
    tex_to_img = {i: t.get("source") for i, t in enumerate(g.get("textures", []))}
    alpha_imgs = {tex_to_img[i] for i in blend if i is not None}
    for i, img in enumerate(g.get("images", [])):
        im = Image.open(f"{src}/{img['uri']}")
        im = fit(im, MAX_TEX)
        base = os.path.splitext(os.path.basename(img["uri"]))[0]
        if i in alpha_imgs:
            uri = f"textures/{base}.png"
            im.convert("RGBA").save(f"{dst}/{uri}", optimize=True)
            img["mimeType"] = "image/png"
        else:
            uri = f"textures/{base}.jpg"
            im.convert("RGB").save(f"{dst}/{uri}", quality=88, optimize=True)
            img["mimeType"] = "image/jpeg"
        img["uri"] = uri
        print(f"  {name}: {base} -> {im.size}")
    json.dump(g, open(f"{dst}/scene.gltf", "w"))
    shutil.copy(f"{src}/scene.bin", f"{dst}/scene.bin")
    shutil.copy(f"{src}/license.txt", f"{dst}/license.txt")

def main():
    if not os.path.isdir(SRC):
        sys.exit(f"missing {SRC}/")
    for name, out in [("Hulk", "hulk"), ("Kratos", "kratos"), ("Doraemon", "doraemon")]:
        model(name, out)
    os.makedirs(f"{DST}/cinematic", exist_ok=True)
    shutil.copy(f"{SRC}/Cinematic/hdri/empty_warehouse_01_2k.hdr", f"{DST}/cinematic/warehouse_2k.hdr")
    mt = f"{SRC}/Cinematic/textures/blue_metal_plate_2k.gltf/textures"
    for k, f in [("diff", "blue_metal_plate_diff_2k.jpg"), ("nor", "blue_metal_plate_nor_gl_2k.jpg"), ("arm", "blue_metal_plate_arm_2k.jpg")]:
        fit(Image.open(f"{mt}/{f}"), 1024).convert("RGB").save(f"{DST}/cinematic/metal_{k}.jpg", quality=86, optimize=True)
    vfx_src = f"{SRC}/Cinematic/vfx/kenney_particle-pack/PNG (Transparent)"
    os.makedirs(f"{DST}/vfx", exist_ok=True)
    for f in ["circle_02", "circle_05", "dirt_02", "dirt_03", "flare_01", "light_01", "light_03", "muzzle_02", "scorch_01", "scorch_02", "smoke_04", "smoke_07", "spark_04", "spark_06", "trace_02", "trace_05", "twirl_02", "flame_03", "magic_04"]:
        fit(Image.open(f"{vfx_src}/{f}.png").convert("RGBA"), 256).save(f"{DST}/vfx/{f}.png", optimize=True)
    shutil.copy(f"{SRC}/Cinematic/vfx/kenney_particle-pack/License.txt", f"{DST}/vfx/LICENSE-kenney-particle-pack.txt")
    print("done")

main()

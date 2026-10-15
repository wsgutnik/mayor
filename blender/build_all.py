"""
Build kit models: blender -b --python blender/build_all.py -- [--only 1,2,3] [--out DIR] [--previews DIR] [--strict]

For every registered building: writes NN.glb into --out (default public/models) and, when --previews is given,
a PNG render of the main angle. Prints one JSON line per model with its triangle count and bounds check.
Always writes manifest.json (kit number, name, variant, version, footprint, triangles, bounds, module) next to the GLBs.

--strict makes the build fail (exit 1, after every model is written) when a building leaves its tile, goes over the
triangle limit, a kit number 1-40 has no model, or a registration replaces another one without being declared in
registry.DECLARED_OVERRIDES. Without it the same problems are only printed as WARN lines.
"""
import importlib
import json
import os
import pkgutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import lib  # noqa: E402
import preview  # noqa: E402
from registry import REGISTRY, REGISTRATIONS, OVERRIDES, PROPS, VARIANTS, LANDMARKS, undeclared_overrides  # noqa: E402

TRI_LIMIT = int(os.environ.get("MAYOR_BUILDING_TRI_LIMIT", "1400"))
# Multi-cell assets are drawn once per lot, not once per tile.  Keep the 2x2
# detail level equal to a normal kit building; the larger x4 civic-scale
# compositions get a separately documented 2800-triangle allowance.
# Existing service assets have a documented legacy cap. New zoned evolved x2
# assets use the normal-building cap below; keeping this separate avoids
# silently invalidating shipped facility GLBs during a manifest rebuild.
X2_TRI_LIMIT = int(os.environ.get("MAYOR_X2_TRI_LIMIT", "4000"))
EVOLVED_X2_TRI_LIMIT = int(os.environ.get("MAYOR_EVOLVED_X2_TRI_LIMIT", "1400"))
EVOLVED_X2_IDS = set(range(1, 21)) | set(range(36, 41))
X4_TRI_LIMIT = int(os.environ.get("MAYOR_X4_TRI_LIMIT", "2800"))
LANDMARK_X2_TRI_LIMIT = int(os.environ.get("MAYOR_LANDMARK_X2_TRI_LIMIT", "1400"))
LANDMARK_X4_TRI_LIMIT = int(os.environ.get("MAYOR_LANDMARK_X4_TRI_LIMIT", "2800"))


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"only": None, "out": os.path.join(HERE, "..", "public", "models"), "previews": None, "strict": False}
    i = 0
    while i < len(argv):
        if argv[i] == "--only":
            opts["only"] = {int(x) for x in argv[i + 1].split(",")}
            i += 2
        elif argv[i] == "--out":
            opts["out"] = argv[i + 1]
            i += 2
        elif argv[i] == "--previews":
            opts["previews"] = argv[i + 1]
            i += 2
        elif argv[i] == "--strict":
            opts["strict"] = True
            i += 1
        else:
            i += 1
    return opts


def load_modules():
    for m in pkgutil.iter_modules([HERE]):
        if m.name.startswith("buildings_") or m.name.startswith("props_"):
            importlib.import_module(m.name)


def main():
    opts = parse()
    # The GLBs carry UVs, tints and material names; the game supplies the shared textures and this table.
    os.makedirs(opts["out"], exist_ok=True)
    with open(os.path.join(opts["out"], "patterns.json"), "w") as fh:
        # name -> [texture, world size of one repeat, base colour]; the game applies the tint itself.
        # The glow_window_* family panes are left out on purpose: kit-materials.ts only wires the
        # emissive map for plain "glow_window", so an entry here would rebuild the families with a
        # black emissive (dark windows at night). Without an entry the renderer keeps the GLB-authored
        # pane material, which glows correctly. V1 (per-window night lights) removes this carve-out
        # when it teaches kit-materials.ts the family suffixes (report 09 section 8, V1/V2).
        json.dump({k: [lib.PATTERN[k][0] if k in lib.PATTERN else None, lib.PATTERN[k][1] if k in lib.PATTERN else None, v[0]]
                   for k, v in lib.PALETTE.items() if not k.startswith("glow_window_")}, fh, indent=1)
    tex_out = os.path.join(opts["out"], "..", "textures")
    os.makedirs(tex_out, exist_ok=True)
    import shutil
    for f in os.listdir(lib.TEXTURE_DIR):
        if f.endswith(".png"):
            shutil.copy(os.path.join(lib.TEXTURE_DIR, f), os.path.join(tex_out, f))
    load_modules()
    os.makedirs(opts["out"], exist_ok=True)
    if opts["previews"]:
        os.makedirs(opts["previews"], exist_ok=True)
    problems = []
    manifest = []
    for n in range(1, 41):
        if n not in REGISTRY:
            problems.append(f"kit number {n:02d} has no registered model")
    for o in undeclared_overrides():
        problems.append(f"{o['by_module']} replaces {o['replaced_module']} for #{o['n']:02d} without a DECLARED_OVERRIDES entry")
    for n in sorted(REGISTRY):
        if opts["only"] and n not in opts["only"]:
            continue
        name, fn = REGISTRY[n]
        lib.clear()
        m = lib.Model(f"b{n:02d}")
        fn(m)
        ob = m.build()
        ok, bounds = lib.check_bounds(ob)
        tris = lib.triangle_count(ob)
        lib.export_glb(ob, os.path.join(opts["out"], f"{n:02d}.glb"))
        if opts["previews"]:
            preview.setup_scene(top=bounds[5])
            preview.render(os.path.join(opts["previews"], f"{n:02d}.png"))
            # Second camera angle (back-left) with identical lighting and framing, for the audit.
            preview.setup_scene(top=bounds[5], azimuth_deg=145)
            preview.render(os.path.join(opts["previews"], f"{n:02d}_b.png"))
        reg = next(r for r in reversed(REGISTRATIONS) if r["n"] == n and r["variant"] == "base")
        if not ok:
            problems.append(f"#{n:02d} {name} leaves its tile or height limit: {[round(b, 3) for b in bounds]}")
        if tris > TRI_LIMIT:
            problems.append(f"#{n:02d} {name} has {tris} triangles (limit {TRI_LIMIT})")
        manifest.append({"n": n, "name": name, "variant": reg["variant"], "version": reg["version"],
                         "footprint": reg["footprint"], "module": reg["module"], "tris": tris, "inside_tile": ok,
                         "bounds": [round(b, 3) for b in bounds]})
        print("MODEL " + json.dumps({"n": n, "name": name, "tris": tris, "inside_tile": ok,
                                      "bounds": [round(b, 3) for b in bounds]}))
    v2_report = []
    # Non-base variants (A/B candidates) are exported beside, never over, the production models.
    variant_manifest = []
    for (n, variant), (name, fn, version, footprint) in sorted(VARIANTS.items()):
        if opts["only"] and n not in opts["only"]:
            continue
        vdir = os.path.join(opts["out"], "variants", variant)
        os.makedirs(vdir, exist_ok=True)
        lib.clear()
        m = lib.Model(f"b{n:02d}_{variant}")
        fn(m)
        ob = m.build()
        span = max(footprint)
        if variant == "x2":
            ok, bounds = lib.check_bounds(ob, limit=1.01, max_h=4.2)
        elif variant == "x4":
            ok, bounds = lib.check_bounds(ob, limit=2.01, max_h=6.2)
        elif variant == "x1":
            ok, bounds = lib.check_bounds(ob, limit=0.5001, max_h=2.6)
        else:
            ok, bounds = lib.check_bounds(ob)
        tris = lib.triangle_count(ob)
        lib.export_glb(ob, os.path.join(vdir, f"{n:02d}.glb"))
        if variant == "x2":
            # Runtime convention for 2x2 service buildings: models/x2/NN.glb.
            xdir = os.path.join(opts["out"], "x2")
            os.makedirs(xdir, exist_ok=True)
            shutil.copyfile(os.path.join(vdir, f"{n:02d}.glb"), os.path.join(xdir, f"{n:02d}.glb"))
        elif variant == "x1":
            # 1x1 expansion service buildings (catalog 41-84): models/x1/NN.glb keeps the 40-file kit intact.
            xdir = os.path.join(opts["out"], "x1")
            os.makedirs(xdir, exist_ok=True)
            shutil.copyfile(os.path.join(vdir, f"{n:02d}.glb"), os.path.join(xdir, f"{n:02d}.glb"))
        elif variant == "x4":
            # Zoned 4x4 evolved lots use their own runtime directory so they
            # cannot replace a 1x1 or x2 instance pool.
            xdir = os.path.join(opts["out"], "x4")
            os.makedirs(xdir, exist_ok=True)
            shutil.copyfile(os.path.join(vdir, f"{n:02d}.glb"), os.path.join(xdir, f"{n:02d}.glb"))
        if opts["previews"]:
            preview.setup_scene(top=bounds[5], span=span)
            preview.render(os.path.join(opts["previews"], f"{n:02d}_{variant}.png"))
            preview.setup_scene(top=bounds[5], azimuth_deg=145, span=span)
            preview.render(os.path.join(opts["previews"], f"{n:02d}_{variant}_b.png"))
        # Runtime convention (src/render/visual-v2.ts): models/v2/NN_lod{0,1,2}.glb.
        lod = {"v2": 0, "v2_lod1": 1, "v2_lod2": 2}.get(variant)
        if lod is not None:
            import shutil
            rt = os.path.join(opts["out"], "v2")
            os.makedirs(rt, exist_ok=True)
            shutil.copyfile(os.path.join(vdir, f"{n:02d}.glb"), os.path.join(rt, f"{n:02d}_lod{lod}.glb"))
            # scripts/verify_v2_assets.py reads this report next to the runtime GLBs.
            v2_report.append({"catalogId": n, "name": name, "lod": lod, "file": f"{n:02d}_lod{lod}.glb", "triangles": tris,
                              "insideTile": ok, "bounds": [round(b, 3) for b in bounds]})
        variant_manifest.append({"n": n, "name": name, "variant": variant, "version": version, "footprint": list(footprint),
                                 "tris": tris, "inside_tile": ok, "bounds": [round(b, 3) for b in bounds]})
        print("VARIANT " + json.dumps(variant_manifest[-1]))
        if not ok:
            problems.append(f"variant {variant} #{n:02d} {name} leaves its tile or height limit")
        if variant == "x2":
            limit = EVOLVED_X2_TRI_LIMIT if n in EVOLVED_X2_IDS else X2_TRI_LIMIT
            if tris > limit:
                problems.append(f"variant x2 #{n:02d} {name} has {tris} triangles (limit {limit})")
        if variant == "x1" and tris > TRI_LIMIT:
            problems.append(f"variant x1 #{n:02d} {name} has {tris} triangles (limit {TRI_LIMIT})")
        if variant == "x4" and tris > X4_TRI_LIMIT:
            problems.append(f"variant x4 #{n:02d} {name} has {tris} triangles (limit {X4_TRI_LIMIT})")
    if v2_report:
        with open(os.path.join(opts["out"], "v2", "build-report.json"), "w") as fh:
            json.dump({"schema": 1, "assets": sorted(v2_report, key=lambda a: (a["catalogId"], a["lod"]))}, fh, indent=1)
    landmark_manifest = []
    for slug, (name, fn, footprint) in sorted(LANDMARKS.items()):
        ldir = os.path.join(opts["out"], "landmarks")
        os.makedirs(ldir, exist_ok=True)
        lib.clear(); m = lib.Model(slug); fn(m); ob = m.build()
        limit = 1.01 if footprint == (2, 2) else 2.01
        max_h = 4.2 if footprint == (2, 2) else 6.2
        ok, bounds = lib.check_bounds(ob, limit=limit, max_h=max_h)
        tris = lib.triangle_count(ob)
        lib.export_glb(ob, os.path.join(ldir, f"{slug}.glb"))
        if opts["previews"]:
            preview.setup_scene(top=bounds[5], span=max(footprint))
            preview.render(os.path.join(opts["previews"], f"{slug}.png"))
            preview.setup_scene(top=bounds[5], azimuth_deg=145, span=max(footprint))
            preview.render(os.path.join(opts["previews"], f"{slug}_b.png"))
        item = {"slug": slug, "name": name, "footprint": list(footprint), "tris": tris,
                "inside_footprint": ok, "bounds": [round(b, 3) for b in bounds]}
        landmark_manifest.append(item); print("LANDMARK " + json.dumps(item))
        if not ok: problems.append(f"landmark {slug} leaves its footprint or height limit")
        tri_limit = LANDMARK_X2_TRI_LIMIT if footprint == (2, 2) else LANDMARK_X4_TRI_LIMIT
        if tris > tri_limit: problems.append(f"landmark {slug} has {tris} triangles (limit {tri_limit})")
    if opts["only"] is None:
        with open(os.path.join(opts["out"], "landmarks", "manifest.json"), "w") as fh:
            json.dump({"schema": 1, "assets": landmark_manifest}, fh, indent=1)
    if opts["only"] is None or "props" in sys.argv:
        pdir = os.path.join(opts["out"], "props")
        os.makedirs(pdir, exist_ok=True)
        for pname in sorted(PROPS):
            lib.clear()
            m = lib.Model(pname)
            PROPS[pname](m)
            ob = m.build()
            ok, bounds = lib.check_bounds(ob, limit=0.75, max_h=3.0)
            lib.export_glb(ob, os.path.join(pdir, f"{pname}.glb"))
            if opts["previews"]:
                preview.setup_scene(top=max(0.3, bounds[5]))
                preview.render(os.path.join(opts["previews"], f"prop-{pname}.png"))
            print("PROP " + json.dumps({"name": pname, "tris": lib.triangle_count(ob), "bounds": [round(b, 3) for b in bounds]}))
    if opts["only"] is None:
        with open(os.path.join(opts["out"], "manifest.json"), "w") as fh:
            json.dump({"schema": 1, "triLimit": TRI_LIMIT, "buildings": manifest, "variants": variant_manifest, "overrides": OVERRIDES}, fh, indent=1)
    for p in problems:
        print("WARN " + p)
    if opts["strict"] and problems:
        print(f"STRICT: {len(problems)} problem(s); failing the build")
        sys.exit(1)


main()

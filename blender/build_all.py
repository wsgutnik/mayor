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
from registry import REGISTRY, REGISTRATIONS, OVERRIDES, PROPS, VARIANTS, undeclared_overrides  # noqa: E402

TRI_LIMIT = int(os.environ.get("MAYOR_BUILDING_TRI_LIMIT", "450"))


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
        # name -> [texture, world size of one repeat, base colour]; the game applies the tint itself
        json.dump({k: [lib.PATTERN[k][0] if k in lib.PATTERN else None, lib.PATTERN[k][1] if k in lib.PATTERN else None, v[0]]
                   for k, v in lib.PALETTE.items()}, fh, indent=1)
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
        reg = next(r for r in reversed(REGISTRATIONS) if r["n"] == n)
        if not ok:
            problems.append(f"#{n:02d} {name} leaves its tile or height limit: {[round(b, 3) for b in bounds]}")
        if tris > TRI_LIMIT:
            problems.append(f"#{n:02d} {name} has {tris} triangles (limit {TRI_LIMIT})")
        manifest.append({"n": n, "name": name, "variant": reg["variant"], "version": reg["version"],
                         "footprint": reg["footprint"], "module": reg["module"], "tris": tris, "inside_tile": ok,
                         "bounds": [round(b, 3) for b in bounds]})
        print("MODEL " + json.dumps({"n": n, "name": name, "tris": tris, "inside_tile": ok,
                                      "bounds": [round(b, 3) for b in bounds]}))
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
        ok, bounds = lib.check_bounds(ob)
        tris = lib.triangle_count(ob)
        lib.export_glb(ob, os.path.join(vdir, f"{n:02d}.glb"))
        if opts["previews"]:
            preview.setup_scene(top=bounds[5])
            preview.render(os.path.join(opts["previews"], f"{n:02d}_{variant}.png"))
            preview.setup_scene(top=bounds[5], azimuth_deg=145)
            preview.render(os.path.join(opts["previews"], f"{n:02d}_{variant}_b.png"))
        variant_manifest.append({"n": n, "name": name, "variant": variant, "version": version, "footprint": list(footprint),
                                 "tris": tris, "inside_tile": ok, "bounds": [round(b, 3) for b in bounds]})
        print("VARIANT " + json.dumps(variant_manifest[-1]))
        if not ok:
            problems.append(f"variant {variant} #{n:02d} {name} leaves its tile or height limit")
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

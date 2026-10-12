"""
Build kit models: blender -b --python blender/build_all.py -- [--only 1,2,3] [--out DIR] [--previews DIR]

For every registered building: writes NN.glb into --out (default public/models) and, when --previews is given,
a PNG render of the main angle. Prints one JSON line per model with its triangle count and bounds check.
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
from registry import REGISTRY  # noqa: E402


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"only": None, "out": os.path.join(HERE, "..", "public", "models"), "previews": None}
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
        else:
            i += 1
    return opts


def load_modules():
    for m in pkgutil.iter_modules([HERE]):
        if m.name.startswith("buildings_"):
            importlib.import_module(m.name)


def main():
    opts = parse()
    load_modules()
    os.makedirs(opts["out"], exist_ok=True)
    if opts["previews"]:
        os.makedirs(opts["previews"], exist_ok=True)
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
        print("MODEL " + json.dumps({"n": n, "name": name, "tris": tris, "inside_tile": ok,
                                      "bounds": [round(b, 3) for b in bounds]}))


main()

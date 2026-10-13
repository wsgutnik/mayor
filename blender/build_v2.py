"""Export Mayor Visual V2 reference assets without replacing the production 40 GLBs.

Examples:
  blender -b --factory-startup --python blender/build_v2.py -- --out /tmp/mayor-v2 --previews /tmp/mayor-v2-previews
  blender -b --factory-startup --python blender/build_v2.py -- --out public/models/v2 --only 1,21
The default output is intentionally outside the game assets.
"""
import argparse
import hashlib
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib
import preview
from visual_v2 import REFERENCE_MODELS


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="Comma-separated catalog IDs, e.g. 1,10,21")
    parser.add_argument("--out", default="/tmp/mayor-v2", help="GLB export directory")
    parser.add_argument("--previews", help="Optional folder for PNG previews")
    return parser.parse_args(args)


def main():
    args = parse_args()
    ids = sorted(REFERENCE_MODELS)
    if args.only:
        ids = sorted(set(int(i.strip()) for i in args.only.split(",")))
        invalid = set(ids) - set(REFERENCE_MODELS)
        if invalid:
            raise SystemExit(f"Unsupported reference IDs: {sorted(invalid)}")
    os.makedirs(args.out, exist_ok=True)
    if args.previews:
        os.makedirs(args.previews, exist_ok=True)
    report = {"schemaVersion": 1, "generator": "blender/build_v2.py",
              "unit": "one legacy tile", "assets": []}
    failures = []
    for n in ids:
        name, build = REFERENCE_MODELS[n]
        for lod in range(3):
            lib.clear()
            model = lib.Model(f"v2_{n:02d}_lod{lod}")
            # lib.Model defaults to Python hash() (process-randomized); override
            # to make window emission layouts reproducible between builds.
            digest = hashlib.sha256(f"mayor-v2:{n}:{lod}".encode()).digest()
            model.rng = random.Random(int.from_bytes(digest[:8], "little"))
            build(model, lod)
            obj = model.build()
            ok, bounds = lib.check_bounds(obj)
            tris = lib.triangle_count(obj)
            filename = f"{n:02d}_lod{lod}.glb"
            entry = {"catalogId": n, "name": name, "lod": lod,
                     "file": filename, "triangles": tris, "insideTile": ok,
                     "bounds": [round(x, 5) for x in bounds]}
            if not ok:
                failures.append(f"{filename}: exceeds tile bounds {bounds}")
            else:
                lib.export_glb(obj, os.path.join(args.out, filename))
                if args.previews:
                    preview.setup_scene(top=bounds[5])
                    preview.render(os.path.join(args.previews, filename.replace(".glb", ".png")))
            report["assets"].append(entry)
            print("V2_MODEL " + json.dumps(entry))
    for n in ids:
        lods = [x for x in report["assets"] if x["catalogId"] == n]
        if not (lods[0]["triangles"] >= lods[1]["triangles"] >= lods[2]["triangles"]):
            failures.append(f"{n:02d}: triangle counts are not monotonically decreasing")
    with open(os.path.join(args.out, "build-report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    if failures:
        for msg in failures:
            print("ERROR " + msg, file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()

"""Validate Mayor V2 exported GLBs and emit a reproducible asset manifest.

No Blender dependency. Run after blender/build_v2.py (not before export):
  python3 scripts/verify_v2_assets.py --dir /tmp/mayor-v2
  python3 -m unittest discover -s scripts -p 'test_verify_v2_assets.py'
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

IDS = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 31, 33, 35, 36, 37, 38, 39)
LODS = (0, 1, 2)


class AssetError(ValueError):
    pass


def inspect_glb(path):
    data = Path(path).read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise AssetError(f"{path.name}: invalid GLB header")
    version, declared_length = struct.unpack_from("<II", data, 4)
    if version != 2 or declared_length != len(data):
        raise AssetError(f"{path.name}: unsupported version or incorrect file length")
    offset, chunks = 12, {}
    while offset < len(data):
        if offset + 8 > len(data):
            raise AssetError(f"{path.name}: truncated GLB chunk header")
        length, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        if length % 4 or offset + length > len(data) or kind in chunks:
            raise AssetError(f"{path.name}: invalid GLB chunk")
        chunks[kind] = data[offset:offset + length]
        offset += length
    if b"JSON" not in chunks:
        raise AssetError(f"{path.name}: missing JSON chunk")
    try:
        doc = json.loads(chunks[b"JSON"].decode("utf-8").strip(" \t\r\n\0"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AssetError(f"{path.name}: invalid GLB JSON") from exc
    if str(doc.get("asset", {}).get("version")) != "2.0":
        raise AssetError(f"{path.name}: expected glTF 2.0")
    buffers = doc.get("buffers", [])
    if not buffers or len(buffers) != 1 or "uri" in buffers[0]:
        raise AssetError(f"{path.name}: expected one embedded BIN buffer")
    binary = chunks.get(b"BIN\0", b"")
    if len(binary) < buffers[0].get("byteLength", 0):
        raise AssetError(f"{path.name}: truncated BIN data")
    for view in doc.get("bufferViews", []):
        start = view.get("byteOffset", 0)
        if view.get("buffer") != 0 or start < 0 or view.get("byteLength", 0) < 0 or start + view.get("byteLength", 0) > len(binary):
            raise AssetError(f"{path.name}: invalid bufferView")
    accessors = doc.get("accessors", [])
    materials = doc.get("materials", [])
    if not materials:
        raise AssetError(f"{path.name}: model has no named materials")
    triangles, vertices, meshes = 0, 0, 0
    for mesh in doc.get("meshes", []):
        meshes += 1
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:
                raise AssetError(f"{path.name}: unsupported non-triangle primitive")
            attrs = prim.get("attributes", {})
            if not {"POSITION", "NORMAL", "TEXCOORD_0"}.issubset(attrs):
                raise AssetError(f"{path.name}: missing position, normals or UV0")
            try:
                count = accessors[attrs["POSITION"]]["count"]
                if count <= 0 or accessors[attrs["NORMAL"]]["count"] != count or accessors[attrs["TEXCOORD_0"]]["count"] != count:
                    raise AssetError(f"{path.name}: mismatched vertex attributes")
                material_idx = prim["material"]
                if not 0 <= material_idx < len(materials):
                    raise AssetError(f"{path.name}: invalid material reference")
                elements = accessors[prim["indices"]]["count"] if "indices" in prim else count
                if elements <= 0 or elements % 3:
                    raise AssetError(f"{path.name}: invalid triangle count")
            except (IndexError, KeyError, TypeError) as exc:
                raise AssetError(f"{path.name}: malformed primitive/accessor") from exc
            triangles += elements // 3
            vertices += count
    if not meshes or not triangles:
        raise AssetError(f"{path.name}: empty model")
    for image in doc.get("images", []):
        uri = image.get("uri", "")
        if uri and not uri.startswith("data:"):
            raise AssetError(f"{path.name}: external image dependency {uri}")
    return {
        "file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
        "triangles": triangles, "vertices": vertices, "meshes": meshes,
        "materials": sorted({m.get("name", "(unnamed)") for m in materials}),
    }


def audit_directory(directory):
    folder = Path(directory)
    report_path = folder / "build-report.json"
    if not report_path.exists():
        raise AssetError("Missing Blender build-report.json; run blender/build_v2.py first")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    entries = report.get("assets", [])
    expected = {(n, lod) for n in IDS for lod in LODS}
    observed = {(x.get("catalogId"), x.get("lod")) for x in entries}
    if observed != expected or len(entries) != len(expected):
        raise AssetError(f"Blender build report must contain exactly the expected {len(expected)} unique ID/LOD pairs")
    indexed = {(x["catalogId"], x["lod"]): x for x in entries}
    assets = []
    for n in IDS:
        variants = []
        for lod in LODS:
            filename = f"{n:02d}_lod{lod}.glb"
            item = indexed[(n, lod)]
            if item.get("file") != filename or not item.get("insideTile"):
                raise AssetError(f"{filename}: build report filename or bounds failed")
            if not (folder / filename).is_file():
                raise AssetError(f"{filename}: required GLB missing")
            meta = inspect_glb(folder / filename)
            if meta["triangles"] != item.get("triangles"):
                raise AssetError(f"{filename}: Blender triangle count differs from exported GLB")
            bounds = item.get("bounds", [])
            if len(bounds) != 6 or not all(isinstance(v, (int, float)) for v in bounds):
                raise AssetError(f"{filename}: malformed bounding data")
            meta.update({"lod": lod, "url": f"/models/v2/{filename}", "boundsBlender": bounds})
            variants.append(meta)
        counts = [v["triangles"] for v in variants]
        if not (counts[0] >= counts[1] >= counts[2] and counts[0] > counts[2]):
            raise AssetError(f"{n:02d}: LOD triangle counts must decrease from near to far")
        assets.append({"catalogId": n, "variants": variants})
    return {"schemaVersion": 1, "referenceCatalogIds": list(IDS), "assets": assets,
            "summary": {"assetCount": len(IDS) * len(LODS), "buildingCount": len(IDS),
                        "totalBytes": sum(v["bytes"] for a in assets for v in a["variants"])}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default="public/models/v2", help="Directory containing the 15 exported GLBs and build-report.json")
    parser.add_argument("--out", help="Manifest output path (default: <dir>/asset-manifest.json)")
    parser.add_argument("--check", action="store_true", help="Only compare to an existing manifest; never write")
    args = parser.parse_args(argv)
    target = Path(args.out) if args.out else Path(args.dir) / "asset-manifest.json"
    try:
        result = audit_directory(args.dir)
        output = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != output:
                raise AssetError("Asset manifest missing or stale; regenerate it after exporting")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(output, encoding="utf-8")
    except (OSError, AssetError, ValueError, json.JSONDecodeError) as exc:
        print(f"V2 ASSET ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"Validated {result['summary']['assetCount']} GLBs from {result['summary']['buildingCount']} buildings; manifest: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

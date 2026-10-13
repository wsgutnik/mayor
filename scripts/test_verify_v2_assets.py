"""Self-contained validator tests; no Blender, three.js or npm required."""
import json
import struct
import tempfile
import unittest
from pathlib import Path
from verify_v2_assets import AssetError, IDS, LODS, audit_directory, inspect_glb, main


def fake_glb(triangles=3, uv=True):
    count = triangles * 3
    accessors = [
        {"count": count, "type": "VEC3", "componentType": 5126},
        {"count": count, "type": "VEC3", "componentType": 5126},
        {"count": count, "type": "VEC2", "componentType": 5126},
        {"count": count, "type": "SCALAR", "componentType": 5123},
    ]
    attrs = {"POSITION": 0, "NORMAL": 1}
    if uv: attrs["TEXCOORD_0"] = 2
    doc = {
        "asset": {"version": "2.0"}, "buffers": [{"byteLength": 4}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
        "accessors": accessors,
        "meshes": [{"primitives": [{"mode": 4, "attributes": attrs, "indices": 3, "material": 0}]}],
        "materials": [{"name": "wall_white"}],
    }
    raw = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    raw += b' ' * (-len(raw) % 4)
    binary = b'\0' * 4
    length = 12 + 8 + len(raw) + 8 + len(binary)
    return b'glTF' + struct.pack('<II', 2, length) + struct.pack('<I4s', len(raw), b'JSON') + raw + struct.pack('<I4s', len(binary), b'BIN\0') + binary


class AssetVerifierTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        entries = []
        for n in IDS:
            for lod, tris in enumerate((9, 6, 3)):
                file = f'{n:02d}_lod{lod}.glb'
                (self.path / file).write_bytes(fake_glb(tris))
                entries.append({"catalogId": n, "lod": lod, "file": file, "insideTile": True,
                                "triangles": tris, "bounds": [-.45, .45, -.45, .45, 0, 1]})
        (self.path / 'build-report.json').write_text(json.dumps({"schemaVersion": 1, "assets": entries}))

    def test_generates_deterministic_manifest(self):
        a = audit_directory(self.path)
        b = audit_directory(self.path)
        self.assertEqual(a, b)
        self.assertEqual(a['summary']['assetCount'], 15)
        self.assertEqual(len(a['assets']), 5)
        self.assertEqual(a['assets'][0]['variants'][0]['triangles'], 9)
        self.assertEqual(main(['--dir', str(self.path)]), 0)
        self.assertEqual(main(['--dir', str(self.path), '--check']), 0)

    def test_missing_glb_blocks_manifest(self):
        (self.path / '01_lod2.glb').unlink()
        with self.assertRaisesRegex(AssetError, 'required GLB missing'):
            audit_directory(self.path)

    def test_export_triangle_mismatch_blocks_manifest(self):
        report = json.loads((self.path / 'build-report.json').read_text())
        report['assets'][0]['triangles'] = 999
        (self.path / 'build-report.json').write_text(json.dumps(report))
        with self.assertRaisesRegex(AssetError, 'triangle count differs'):
            audit_directory(self.path)

    def test_broken_geometry_or_uv_rejected(self):
        path = self.path / '01_lod0.glb'
        path.write_bytes(fake_glb(9, uv=False))
        with self.assertRaisesRegex(AssetError, 'missing position'):
            inspect_glb(path)

    def test_truncated_file_rejected(self):
        path = self.path / '01_lod0.glb'
        path.write_bytes(b'glTF\x00')
        with self.assertRaisesRegex(AssetError, 'invalid GLB header'):
            inspect_glb(path)

    def test_failed_bounds_rejected(self):
        report = json.loads((self.path / 'build-report.json').read_text())
        report['assets'][0]['insideTile'] = False
        (self.path / 'build-report.json').write_text(json.dumps(report))
        with self.assertRaisesRegex(AssetError, 'filename or bounds failed'):
            audit_directory(self.path)

    def test_stale_manifest_is_detected(self):
        self.assertEqual(main(['--dir', str(self.path)]), 0)
        (self.path / 'asset-manifest.json').write_text('{}')
        self.assertEqual(main(['--dir', str(self.path), '--check']), 1)


if __name__ == '__main__':
    unittest.main()

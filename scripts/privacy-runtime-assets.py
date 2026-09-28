"""Strip local paths from runtime metadata without changing geometry or pixels."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct

from PIL import Image


def sha(data):
    return hashlib.sha256(data).hexdigest()


def glb_chunks(data):
    assert data[:4] == b'glTF' and len(data) == struct.unpack_from('<I', data, 8)[0]
    position = 12
    chunks = []
    while position < len(data):
        size, kind = struct.unpack_from('<I4s', data, position)
        chunks.append((kind, data[position + 8:position + 8 + size]))
        position += size + 8
    assert position == len(data)
    return chunks


def png_chunks(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    position = 8
    chunks = []
    while position < len(data):
        size, kind = struct.unpack_from('>I4s', data, position)
        chunks.append((kind, data[position:position + 12 + size]))
        position += size + 12
    assert position == len(data)
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    root, backup = args.root.resolve(), args.backup.resolve()
    if root not in backup.parents or '.cache' not in backup.relative_to(root).parts:
        raise SystemExit('A separate project .cache rollback directory is required.')
    spec = importlib.util.spec_from_file_location('privacy_preflight', root / 'scripts/privacy-preflight.py')
    scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scanner)
    def sanitized(value):
        if isinstance(value, dict):
            return {key: sanitized(item) for key, item in value.items()}
        if isinstance(value, list):
            return [sanitized(item) for item in value]
        if isinstance(value, str) and scanner.scan_text(value, '', ''):
            return '[local source location omitted]'
        return value
    reports = []
    for name in ['mutsumi-v05.glb', 'side-hair-clean.png']:
        path = root / 'assets/characters/wakaba-mutsumi/v41-3d/runtime' / name
        relative = path.relative_to(root)
        old = path.read_bytes()
        original = backup / relative
        original.parent.mkdir(parents=True, exist_ok=True)
        if original.exists() and original.read_bytes() != old:
            raise SystemExit('An existing rollback copy differs; select a new rollback directory.')
        shutil.copy2(path, original)
        entry = {'file': relative.as_posix(), 'beforeSha256': sha(old)}
        if path.suffix == '.glb':
            chunks = glb_chunks(old)
            before_json = json.loads(chunks[0][1])
            value = sanitized(before_json)
            payload = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            payload += b' ' * ((-len(payload)) % 4)
            replacement = [(b'JSON', payload), *chunks[1:]]
            body = b''.join(struct.pack('<I4s', len(payload), kind) + payload for kind, payload in replacement)
            result = old[:8] + struct.pack('<I', len(body) + 12) + body
            assert glb_chunks(result)[1:] == chunks[1:]
            entry.update({'binaryGeometryUnchanged': True, 'binarySha256': sha(b''.join(payload for kind, payload in chunks if kind == b'BIN\0'))})
        else:
            with Image.open(path) as image:
                before_pixels = image.convert('RGBA').tobytes()
            chunks = png_chunks(old)
            removed = {'tEXt', 'zTXt', 'iTXt'}
            replacement = [item for item in chunks if item[0].decode('ascii') not in removed]
            result = old[:8] + b''.join(raw for kind, raw in replacement)
            assert [raw for kind, raw in chunks if kind == b'IDAT'] == [raw for kind, raw in replacement if kind == b'IDAT']
            entry.update({'idatUnchanged': True, 'removedTextChunks': len(chunks) - len(replacement), 'rgbaSha256': sha(before_pixels)})
        path.write_bytes(result)
        if path.suffix == '.png':
            with Image.open(path) as image:
                assert before_pixels == image.convert('RGBA').tobytes()
            entry['rgbaUnchanged'] = True
        entry['afterSha256'] = sha(result)
        reports.append(entry)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({'assets': reports, 'qualityChange': 'none: binary geometry, PNG compressed pixels and decoded RGBA are identical'}, indent=2), encoding='utf-8')
    print(json.dumps({'metadataAssetsSanitized': len(reports), 'geometryAndPixelsUnchanged': True}))


if __name__ == '__main__':
    main()

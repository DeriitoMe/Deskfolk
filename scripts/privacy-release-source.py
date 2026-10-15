"""Sanitize a prepared public snapshot, verifying binary artwork is unchanged.

Only the separate .cache snapshot is modified. The development source is read
only. Reports contain file locations and categories, never matched values.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import zipfile

from PIL import Image


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png_chunks(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    at, chunks = 8, []
    while at < len(data):
        size, kind = struct.unpack_from('>I4s', data, at)
        chunks.append((kind, data[at:at + size + 12]))
        at += size + 12
    assert at == len(data)
    return chunks


def glb_chunks(data):
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 8)[0] == len(data)
    at, chunks = 12, []
    while at < len(data):
        size, kind = struct.unpack_from('<I4s', data, at)
        chunks.append((kind, data[at + 8:at + size + 8]))
        at += size + 8
    assert at == len(data)
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--original-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    original, snapshot = args.original_root.resolve(), args.snapshot.resolve()
    if original not in snapshot.parents or '.cache' not in snapshot.relative_to(original).parts:
        raise SystemExit('Only a separate .cache source snapshot can be sanitized.')
    scanner = load('release_scanner', original / 'scripts/privacy-preflight.py')
    exporter = load('release_exporter', original / 'scripts/prepare-public-source.py')
    assets, executable = [], []

    def clean_metadata(value):
        if isinstance(value, dict):
            return {key: clean_metadata(item) for key, item in value.items()}
        if isinstance(value, list):
            return [clean_metadata(item) for item in value]
        if isinstance(value, str):
            findings = scanner.scan_text(value, '', '')
            if any(f['classification'] == 'suspected-secret' for f in findings):
                raise ValueError('Suspected credential in binary metadata; manual review required')
            return exporter.sanitize_text(value)
        return value

    for path in sorted(snapshot.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(snapshot)
        source = original / relative
        if not source.is_file():
            continue
        ext = path.suffix.lower()
        if ext == '.png':
            before = source.read_bytes()
            chunks = png_chunks(before)
            keep = [(kind, raw) for kind, raw in chunks if kind not in {b'tEXt', b'zTXt', b'iTXt', b'eXIf'}]
            clean = before[:8] + b''.join(raw for _, raw in keep)
            path.write_bytes(clean)
            with Image.open(source) as image:
                pixels = image.convert('RGBA').tobytes()
            with Image.open(path) as image:
                assert pixels == image.convert('RGBA').tobytes()
            assert [raw for kind, raw in png_chunks(clean) if kind == b'IDAT'] == [raw for kind, raw in chunks if kind == b'IDAT']
            assets.append({'file': relative.as_posix(), 'type': 'PNG', 'removedMetadataChunks': len(chunks) - len(keep), 'rgbaAndIdatUnchanged': True, 'pixelSha256': digest(pixels)})
        elif ext == '.glb':
            before = source.read_bytes()
            chunks = glb_chunks(before)
            value = json.loads(chunks[0][1])
            sanitized = clean_metadata(value)
            payload = json.dumps(sanitized, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            payload += b' ' * (-len(payload) % 4)
            body = b''.join(struct.pack('<I4s', len(data), kind) + data for kind, data in [(b'JSON', payload), *chunks[1:]])
            clean = before[:8] + struct.pack('<I', len(body) + 12) + body
            assert glb_chunks(clean)[1:] == chunks[1:]
            path.write_bytes(clean)
            assets.append({'file': relative.as_posix(), 'type': 'GLB', 'jsonMetadataChanged': sanitized != value, 'binaryChunksUnchanged': True, 'binarySha256': digest(b''.join(data for kind, data in chunks if kind == b'BIN\0'))})
        elif ext in {'.kra', '.ora'}:
            with zipfile.ZipFile(source) as first, zipfile.ZipFile(path) as second:
                for item in first.infolist():
                    if Path(item.filename).suffix.lower() not in {'.xml', '.json', '.txt'}:
                        assert first.read(item) == second.read(item.filename)
            assets.append({'file': relative.as_posix(), 'type': ext[1:].upper(), 'editableLayerPixelsUnchanged': True})
        elif ext in {'.aseprite', '.ase', '.wav', '.mp3', '.ttf', '.ico'}:
            assert source.read_bytes() == path.read_bytes()
            assets.append({'file': relative.as_posix(), 'type': ext[1:].upper(), 'payloadUnchanged': True})
        elif ext in {'.ts', '.js', '.mjs', '.cjs', '.css', '.html', '.cs', '.nsh', '.ps1', '.lua', '.svg', '.py'} and not (ext == '.py' and relative.parts[0] == 'assets'):
            assert source.read_bytes() == path.read_bytes()
            executable.append(relative.as_posix())

    # Metadata-only changes affect whole-file hashes; refresh the existing
    # manifest after them so downloaded source verifies against its own bytes.
    manifest_file = snapshot / 'PUBLIC_SOURCE_MANIFEST.json'
    manifest = json.loads(manifest_file.read_text('utf-8'))
    manifest['files'] = [{'file': p.relative_to(snapshot).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p.read_bytes())}
                         for p in sorted(snapshot.rglob('*')) if p.is_file() and p != manifest_file]
    manifest['fileCount'] = len(manifest['files'])
    manifest['bytes'] = sum(e['bytes'] for e in manifest['files'])
    manifest['over100MiB'] = [e['file'] for e in manifest['files'] if e['bytes'] > 100 * 1024 * 1024]
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    scan = scanner.scan(snapshot, include_all=True)
    # Detect image scale notation like tray@2x.png as filenames, not e-mail.
    reviewed = []
    for finding in scan['findings']:
        if finding['type'] == 'email-address':
            reviewed.append({**finding, 'review': 'Dependency URLs or image scale filenames; inspect listed context before release'})
        elif finding['file'] == 'scripts/CodexLauncher.cs' and finding['type'] == 'user-home-path':
            reviewed.append({**finding, 'review': 'Synthetic Example user paths used by launcher self-test'})
    result = {'assets': assets, 'executableByteIdenticalFiles': executable,
              'privacyScan': scan, 'manualReviewCandidates': reviewed,
              'originalsModified': False,
              'quality': 'PNG IDAT/RGBA, GLB binary, editable layer pixels, Aseprite, audio and fonts preserved',
              'limitations': 'Pattern scanning cannot prove absence of all secrets; native Blender app inspection and visual review supplement this scan.'}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'verifiedAssetCount': len(assets), 'executableFilesUnchanged': len(executable), 'privacyCounts': scan['counts'], 'originalsModified': False}))


if __name__ == '__main__':
    main()

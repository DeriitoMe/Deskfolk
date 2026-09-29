"""Inspect project/export files without ever printing matched secret values.

Reports contain locations and classifications only. Binary media pixels are not
interpreted as text; editable archive/XML metadata and GLB JSON are inspected.
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import struct
import zipfile

TEXT_EXT = {'.ts', '.js', '.mjs', '.cjs', '.py', '.ps1', '.lua', '.cs', '.nsh', '.html', '.css', '.svg', '.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.ini', '.xml', '.env', '.pem', '.key', '.pub', '.gitignore'}
IGNORE_ROOTS = {'.git', 'node_modules', 'out', 'release', 'dist', '.cache'}
SOURCE_ROOTS = {'assets', 'bridge', 'docs', 'electron', 'renderer', 'scripts', 'shared', 'plugins'}
PLACEHOLDER = re.compile(r'(?i)(example|placeholder|dummy|fake|test[-_ ]?(?:token|key|secret)|your[-_ ]?(?:token|key|secret)|changeme|replace|redacted|<[^>]+>|\$\{|process\.env|os\.environ|randombytes|randomuuid)')
RULES = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'provider-credential': re.compile(r'(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,})(?![A-Za-z0-9])'),
    'jwt': re.compile(r'(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])'),
    'credential-literal': re.compile(r'''(?i)["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|secret|token)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']'''),
    'user-home-path': re.compile(r'(?i)(?:[A-Z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"<>:]+|/Users/[^/\s"<>:]+|/home/[^/\s"<>:]+)'),
    'local-absolute-path': re.compile(r'(?i)(?:[A-Z]:[\\/]+(?:CodexProjects|CodexHome|Tmp|[^\\/\s"<>:]*xwechat_files)[\\/]+[^\r\n"<>|]+)'),
    'personal-message-id': re.compile(r'(?i)(?:wxid_[a-z0-9_]{6,}|xwechat_files|wechat_files)'),
    'email-address': re.compile(r'(?<![\w.])[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.])'),
}
SESSION_KEYS = {'sessionId', 'session_id', 'threadId', 'thread_id', 'turnId', 'turn_id', 'call_id', 'questionId', 'question_id'}
UUID = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)


def aseprite_metadata(path: pathlib.Path):
    # https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
    # Read metadata chunks, never compressed cel/tileset pixels.
    data = path.read_bytes()
    if len(data) < 128 or struct.unpack_from('<H', data, 4)[0] != 0xA5E0:
        raise ValueError('Invalid Aseprite header')
    position = 128
    for frame in range(struct.unpack_from('<H', data, 6)[0]):
        size, magic, old_count = struct.unpack_from('<IHH', data, position)
        count = struct.unpack_from('<I', data, position + 12)[0] or old_count
        if magic != 0xF1FA or size < 16 or position + size > len(data):
            raise ValueError('Invalid Aseprite frame')
        chunk_pos = position + 16
        for chunk in range(count):
            chunk_size, chunk_type = struct.unpack_from('<IH', data, chunk_pos)
            if chunk_size < 6 or chunk_pos + chunk_size > position + size:
                raise ValueError('Invalid Aseprite chunk')
            body = data[chunk_pos + 6:chunk_pos + chunk_size]
            metadata = b''
            if chunk_type in {0x2004, 0x2022, 0x2016, 0x2023}:
                offset = {0x2004: 16, 0x2022: 12, 0x2016: 16, 0x2023: 32}[chunk_type]
                length = struct.unpack_from('<H', body, offset)[0]
                metadata = body[offset + 2:offset + 2 + length]
            elif chunk_type in {0x2008, 0x2018, 0x2020}:
                # These chunks contain metadata only, not image data.
                metadata = body
            if metadata:
                strings = re.findall(rb'[ -~\x80-\xff]{3,}', metadata)
                yield f'frame/{frame + 1}/chunk/{chunk}/type/{chunk_type:x}', '\n'.join(s.decode('utf-8', errors='replace') for s in strings)
            chunk_pos += chunk_size
        position += size


def text_parts(path: pathlib.Path):
    ext = path.suffix.lower()
    if ext in TEXT_EXT or path.name in {'.gitignore', '.npmrc'}:
        yield '', path.read_text('utf-8', errors='replace')
    elif ext in {'.kra', '.ora', '.zip'} and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for item in archive.infolist():
                if pathlib.PurePosixPath(item.filename).suffix.lower() in {'.xml', '.json', '.txt'} and item.file_size <= 8_000_000:
                    yield 'metadata/' + item.filename, archive.read(item).decode('utf-8', errors='replace')
    elif ext == '.glb':
        with path.open('rb') as f:
            header = f.read(20)
            if len(header) == 20 and header[:4] == b'glTF' and header[16:20] == b'JSON':
                yield 'json-chunk', f.read(struct.unpack('<I', header[12:16])[0]).decode('utf-8', errors='replace')
    elif ext in {'.png', '.jpg', '.jpeg', '.webp', '.tiff'}:
        from PIL import Image
        with Image.open(path) as im:
            metadata = {str(k): str(v) for k, v in im.info.items() if k not in {'icc_profile', 'dpi', 'duration', 'loop', 'transparency'}}
            if metadata:
                yield 'image-metadata', json.dumps(metadata, ensure_ascii=False)
    elif ext in {'.aseprite', '.ase'}:
        yield from aseprite_metadata(path)
    elif ext in {'.blend', '.blend1'}:
        # C strings catch embedded absolute paths in uncompressed native files;
        # compressed Blender data require an application-level inspection.
        data = path.read_bytes()
        if data[:4] == b'\x28\xb5\x2f\xfd':
            try:
                from compression import zstd
                data = zstd.decompress(data)
            except ImportError:
                yield 'compressed-native-uninspected', ''
                return
        if ext.startswith('.blend') and not data.startswith(b'BLENDER'):
            yield 'compressed-native-uninspected', ''
        else:
            chunks = re.findall(rb'[ -~]{8,}', data)
            yield 'binary-strings', '\n'.join(c.decode('ascii') for c in chunks)


def scan_text(text: str, location: str, source: str):
    findings = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if location == 'scripts/privacy-preflight.py' and line.lstrip().startswith("'") and 're.compile' in line:
            continue  # Detection patterns are examples, not a user's metadata.
        for category, pattern in RULES.items():
            matches = list(pattern.finditer(line))
            if not matches:
                continue
            classification = 'review'
            if category in {'provider-credential', 'private-key', 'jwt', 'credential-literal'}:
                classification = 'placeholder-or-test' if PLACEHOLDER.search(line) or location.endswith('.test.ts') else 'suspected-secret'
            elif category in {'user-home-path', 'local-absolute-path', 'personal-message-id'}:
                classification = 'personal-metadata'
            elif category == 'email-address':
                classification = 'placeholder-or-test' if any(d in line.lower() for d in ['example.com', 'example.org', 'localhost', 'github.com', 'w3.org']) else 'review'
            findings.append({'file': location, 'part': source, 'line': line_no, 'type': category, 'classification': classification, 'count': len(matches)})
    # Actual lifecycle verification records contain live session identifiers.
    if location.endswith('.json') and (('/verification/' in location or '/preview/' in location) or pathlib.PurePosixPath(location).name in {'history.json', 'activity.json', 'bridge.json'}):
        if UUID.search(text) and any(re.search(r'"' + key + r'"', text) for key in SESSION_KEYS):
            findings.append({'file': location, 'part': source, 'type': 'session-identifiers', 'classification': 'personal-metadata', 'count': len(UUID.findall(text))})
    return findings


def scan(root: pathlib.Path, include_all: bool = False, file_list: pathlib.Path | None = None):
    findings = []
    inspected = 0
    excluded = collections.Counter()
    compressed = []
    children = [root / name.strip() for name in file_list.read_text('utf-8-sig').splitlines() if name.strip()] if file_list else list(root.iterdir())
    for child in children:
        if child.is_dir() and not include_all and (child.name in IGNORE_ROOTS or child.name not in SOURCE_ROOTS):
            excluded['build-or-dependency' if child.name in IGNORE_ROOTS else 'local-profile-or-unknown'] += 1
            continue
        for path in ([child] if child.is_file() else child.rglob('*')):
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(root).as_posix()
            if any(part in IGNORE_ROOTS for part in path.relative_to(root).parts) and not include_all:
                continue
            inspected += 1
            try:
                for part, text in text_parts(path):
                    if part == 'compressed-native-uninspected':
                        compressed.append(relative)
                    else:
                        findings.extend(scan_text(text, relative, part))
            except (OSError, ValueError, zipfile.BadZipFile) as exc:
                findings.append({'file': relative, 'type': 'unreadable', 'classification': type(exc).__name__})
    return {'inspectedFiles': inspected, 'excludedRootCategories': dict(excluded), 'counts': dict(collections.Counter((f['type'] + ':' + f['classification']) for f in findings)), 'findings': findings, 'compressedNativeNeedsAppInspection': compressed, 'note': 'Matched values are intentionally omitted. Pattern inspection is not proof that all secrets are absent.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--include-all', action='store_true')
    parser.add_argument('--file-list', type=pathlib.Path, help='Relative files from git ls-files or another reviewed candidate list.')
    args = parser.parse_args()
    result = scan(args.root.resolve(), args.include_all, args.file_list)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k not in {'findings', 'compressedNativeNeedsAppInspection'}}, ensure_ascii=False, indent=2))
    print(json.dumps({'compressedNativeFileCount': len(result['compressedNativeNeedsAppInspection'])}))


if __name__ == '__main__':
    main()

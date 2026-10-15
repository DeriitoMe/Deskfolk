"""Make a reviewed source snapshot without copying local profiles or rollbacks.

Run privacy-blender.py first to create packed portable Blender copies in the
destination. Existing original source files are never changed by this export.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
from pathlib import Path
import re
import shutil
import zipfile

ROOT_FILES = ['.gitignore', 'README.md', 'package.json', 'package-lock.json', 'electron.vite.config.ts', 'review.vite.config.ts', 'tsconfig.json']
CODE_DIRS = ['bridge', 'electron', 'renderer', 'shared', 'plugins', 'docs']
SCRIPT_PATTERNS = ['privacy-*.py', 'prepare-public-source.py', 'setup-codex.ps1', 'stage-v42-package.mjs', 'verify-v42-package.mjs', 'qa-v42-*', 'build-v42-*.py', 'assemble-v42-*.lua', 'export-v42-*.cjs', 'prepare-v42-*.py', 'prepare-head-icon.lua', 'build-codex-launcher.cjs', 'CodexLauncher.cs', 'installer-startup.nsh', 'build-celebration-*', 'assemble-celebration-*', 'export-celebration-effects-krita.py', 'verify-celebration-art.py']
ART_DIRS = ['v41-3d/runtime', 'v41-3d/source', 'v40-motion/layers', 'v42-motion/source', 'celebration-20261002/runtime', 'celebration-20261002/source', 'celebration-20261002/preview', 'celebration-20261002/portable-source', 'side-hair-20261012/runtime', 'side-hair-20261012/source', 'side-hair-lines-20261012/runtime', 'side-hair-lines-20261012/source', 'tearful-20261009/runtime', 'tearful-20261009/source', 'quota-board-20261014/runtime', 'quota-board-20261014/source', 'water-hair-gap-20261014/runtime', 'water-hair-gap-20261014/source']
TEXT_EXTENSIONS = {'.ts', '.js', '.mjs', '.cjs', '.py', '.lua', '.ps1', '.json', '.html', '.md', '.svg', '.css', '.txt'}
LOCAL_ID_KEYS = {'sessionid', 'session_id', 'threadid', 'thread_id', 'turnid', 'turn_id', 'questionid', 'question_id', 'call_id'}
SECRET_KEYS = {'token', 'access_token', 'refresh_token', 'password', 'api_key', 'apikey', 'secret'}
PROJECT_LINK = re.compile(r'(?i)(\]\()<?[A-Z]:[\\/]+CodexProjects[\\/]+(?:Deskfolk|liquid-glass-pet)[\\/]+([^)>]+)>?(\))')


def sanitize_text(text: str):
    # Keep file links meaningful while replacing host-specific directory roots.
    text = re.sub(r'(?i)[A-Z]:[\\/]+CodexProjects[\\/]+(?:Deskfolk|liquid-glass-pet)[\\/]+', '', text)
    text = re.sub(r'(?i)[A-Z]:[\\/]+CodexProjects[\\/]+(?:Deskfolk|liquid-glass-pet)(?=["`<>\s]|$)', '.', text)
    text = re.sub(r'(?i)[A-Z]:[\\/]+CodexProjects[\\/]+wakaba-mutsumi-3d[\\/]+', 'external-model-archive/', text)
    text = re.sub(r'(?i)[A-Z]:[\\/]+CodexProjects[\\/]+[^\s"`<>]+', '[local related project]', text)
    text = re.sub(r'(?i)[A-Z]:[\\/]+(?:CodexHome|Tmp)[\\/]+[^\r\n"<>`]*', '[local source location]', text)
    text = re.sub(r'(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s"<>:]+', '%USERPROFILE%', text)
    return text


def sanitize_json(value):
    if isinstance(value, dict):
        return {key: ('[local identifier omitted]' if key.lower() in LOCAL_ID_KEYS else '[local credential omitted]' if key.lower() in SECRET_KEYS else sanitize_json(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json(item) for item in value]
    return sanitize_text(value) if isinstance(value, str) else value


def portable_markdown(text: str, relative: Path):
    def replace(match):
        path = match.group(2).replace('\\', '/').rstrip('>')
        return '](' + posixpath.relpath(path, relative.parent.as_posix()) + ')'
    return sanitize_text(PROJECT_LINK.sub(replace, text))


def portable_authoring_script(text: str):
    """Convert only host-specific art-helper path literals, not product code."""
    prefix = ('from pathlib import Path\nimport os\n'
              'PUBLIC_PROJECT_ROOT = Path(__file__).resolve().parents[5]\n'
              '# Optional historical authoring input; current editable models are included.\n'
              'PUBLIC_REFERENCE_ROOT = Path(os.environ.get("DESKFOLK_ART_REFERENCE_ROOT", str(PUBLIC_PROJECT_ROOT / "external-model-archive")))\n')
    text = re.sub(r"(['\"])[A-Z]:/CodexProjects/(?:Deskfolk|liquid-glass-pet)/([^'\"]+)\1", lambda m: 'str(PUBLIC_PROJECT_ROOT / ' + repr(m.group(2)) + ')', text, flags=re.I)
    text = re.sub(r"(['\"])[A-Z]:/CodexProjects/wakaba-mutsumi-3d/([^'\"]+)\1", lambda m: 'str(PUBLIC_REFERENCE_ROOT / ' + repr(m.group(2)) + ')', text, flags=re.I)
    return prefix + text


def copy_public(source: Path, target: Path, relative: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() in {'.kra', '.ora'} and zipfile.is_zipfile(source):
        # Preserve pixel/layer payloads byte-for-byte; sanitize text metadata only.
        with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(target, 'w') as outgoing:
            for entry in incoming.infolist():
                payload = incoming.read(entry)
                if Path(entry.filename).suffix.lower() in {'.xml', '.json', '.txt'}:
                    payload = sanitize_text(payload.decode('utf-8')).encode('utf-8')
                outgoing.writestr(entry, payload)
    elif source.suffix.lower() in TEXT_EXTENSIONS:
        # Preserve executable/vector source bytes, including literal newlines in
        # shader strings. Metadata and documentation alone need rewriting.
        if source.suffix.lower() not in {'.md', '.json', '.txt'}:
            if source.suffix.lower() == '.py' and relative.parts[0] == 'assets':
                target.write_text(portable_authoring_script(source.read_text('utf-8')), encoding='utf-8', newline='\n')
                return
            shutil.copy2(source, target)
            return
        text = source.read_text('utf-8')
        if source.suffix.lower() == '.json' and ('verification' in source.parts or 'preview' in source.parts or source.name.endswith('-verification.json')):
            text = json.dumps(sanitize_json(json.loads(text)), ensure_ascii=False, indent=2)
        # Executable code retains its semantics; only documentation/asset metadata
        # are sanitized here. Code is separately scanned and must be portable.
        elif source.suffix.lower() == '.md':
            text = portable_markdown(text, relative)
        elif source.suffix.lower() in {'.json', '.txt'}:
            text = sanitize_text(text)
        target.write_text(text, encoding='utf-8', newline='\n')
    else:
        shutil.copy2(source, target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--destination', type=Path, default=Path('.cache/github-upload-source-ready'))
    args = parser.parse_args()
    root = args.root.resolve()
    target = args.destination.resolve()
    if target == root or root not in target.parents or target.parts[len(root.parts)] != '.cache':
        raise SystemExit('Export destination must be a separate directory inside project .cache.')
    selected = set(root / name for name in ROOT_FILES)
    selected.update(path for path in (root / 'assets/icons').rglob('*') if path.is_file())
    for dirname in CODE_DIRS:
        selected.update(path for path in (root / dirname).rglob('*') if path.is_file())
    for pattern in SCRIPT_PATTERNS:
        selected.update(path for path in (root / 'scripts').glob(pattern) if path.is_file())
    art = root / 'assets/characters/wakaba-mutsumi'
    for dirname in ART_DIRS:
        selected.update(path for path in (art / dirname).rglob('*') if path.is_file() and path.suffix.lower() not in {'.blend1', '.blend'} and 'frames' not in path.parts and path.name not in {'ROLLBACK.txt', 'GENERATION_PROMPTS.json'})
    # Existing read-only verification is copied with local IDs/paths omitted.
    selected.update(path for path in (art / 'v42-motion/verification').glob('*.json') if path.is_file())
    selected.update(path for path in (art / 'v41-3d/source').glob('*.kra') if path.is_file())
    for source in sorted(selected):
        if any(part in {'.cache', '__pycache__', 'node_modules'} for part in source.relative_to(root).parts):
            continue
        copy_public(source, target / source.relative_to(root), source.relative_to(root))
    # Blender sources are produced separately by privacy-blender.py. Refuse an
    # incomplete release rather than silently shipping runtime-only artwork.
    original_models = [path for path in (root / 'assets').rglob('*.blend') if 'source' in path.parts or 'portable-source' in path.parts]
    missing_models = [path.relative_to(root).as_posix() for path in original_models if not (target / path.relative_to(root)).is_file()]
    if missing_models:
        raise SystemExit('Run privacy-blender.py --portable-dir first; missing model copies: ' + ', '.join(missing_models))
    # The local repository ignores packed originals; only this portable snapshot
    # explicitly includes the copies inspected with the native applications.
    editable = [path for path in target.rglob('*') if path.is_file() and path.suffix.lower() in {'.blend', '.kra', '.ora', '.aseprite'}]
    extra_ignores = '\n# Reviewed portable editable sources in this snapshot.\n!/PUBLIC_SOURCE_MANIFEST.json\n'
    for directory in sorted({path.parent.relative_to(target).as_posix() for path in editable}):
        extra_ignores += '!/' + directory + '/\n'
    for path in sorted(editable):
        extra_ignores += '!/' + path.relative_to(target).as_posix() + '\n'
    # Art authoring helpers and layer assets accompany their native documents.
    # Only files already selected into this reviewed snapshot are admitted.
    for path in sorted(target.rglob('*')):
        if path.is_file() and 'source' in path.relative_to(target).parts and path not in editable:
            extra_ignores += '!/' + path.relative_to(target).as_posix() + '\n'
    (target / '.gitignore').write_text((root / '.gitignore').read_text('utf-8') + extra_ignores, encoding='utf-8')
    manifest = []
    for path in sorted(target.rglob('*')):
        if path.is_file() and path.name != 'PUBLIC_SOURCE_MANIFEST.json' and not any(part in {'node_modules', 'out', '.cache'} for part in path.relative_to(target).parts):
            manifest.append({'file': path.relative_to(target).as_posix(), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    result = {'uploadBoundary': 'This sanitized source snapshot; never the whole development workspace.', 'files': manifest, 'fileCount': len(manifest), 'bytes': sum(item['bytes'] for item in manifest), 'over100MiB': [item['file'] for item in manifest if item['bytes'] > 100 * 1024 * 1024], 'excluded': ['local Electron profiles', 'Codex sessions', 'local bridge tokens', 'rollback snapshots', 'builds/installers', 'automatic editor backup files', 'raw screenshot/chat attachments', 'unrelated external project archives'], 'nativeSourcePolicy': 'All current native models are packed portable Blender copies; Krita/OpenRaster metadata is sanitized with layer pixels unchanged; Aseprite editable payloads are byte-identical. Original source files remain untouched in the local development workspace.'}
    (target / 'PUBLIC_SOURCE_MANIFEST.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in {'files'}}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

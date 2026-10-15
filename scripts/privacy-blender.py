"""Run with Blender --background --python to inspect editable model metadata.

Only counts, object/property names and classification are recorded, never values.
Passing --portable-dir creates new packed copies; the originals stay untouched.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import struct

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--portable-dir', type=Path)
parser.add_argument('--inspect-dir', type=Path)
args = parser.parse_args(argv)
root = args.root.resolve()
spec = importlib.util.spec_from_file_location('privacy_preflight', root / 'scripts/privacy-preflight.py')
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)
paths = sorted(path for path in (root / 'assets').rglob('*.blend')
               if ('source' in path.parts or 'portable-source' in path.parts)
               and not any(part in {'.cache', 'rollback', 'frames'} for part in path.parts))
report = []
for path in paths:
    if args.inspect_dir:
        path = args.inspect_dir.resolve() / path.relative_to(root)
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    found = []
    file_label = path.relative_to(args.inspect_dir.resolve() if args.inspect_dir else root).as_posix()
    before_data = {'objects': len(bpy.data.objects), 'meshes': len(bpy.data.meshes),
                   'vertices': sum(len(mesh.vertices) for mesh in bpy.data.meshes),
                   'curves': len(bpy.data.curves), 'materials': len(bpy.data.materials),
                   'actions': len(bpy.data.actions)}
    images = list(bpy.data.images)
    for image in images:
        location = 'image/' + image.name
        found.extend(scanner.scan_text(image.filepath, file_label, location))
        for packed in image.packed_files:
            found.extend(scanner.scan_text(packed.filepath, file_label, location + '/packed-file'))
    for collection_name in ['scenes', 'objects', 'materials', 'meshes', 'texts']:
        for datablock in getattr(bpy.data, collection_name):
            location = collection_name + '/' + datablock.name
            for key in datablock.keys():
                value = datablock.get(key)
                if isinstance(value, str):
                    found.extend(scanner.scan_text(value, file_label, location + '/' + str(key)))
            if collection_name == 'texts':
                found.extend(scanner.scan_text(datablock.as_string(), file_label, location))
    entry = {'file': file_label, 'imageCount': len(images), 'packedImageCount': sum(bool(i.packed_file) for i in images), 'findings': found}
    if args.portable_dir:
        destination = args.portable_dir.resolve() / path.relative_to(root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.file.pack_all()
        for image in images:
            if image.packed_file:
                payload = image.packed_file.data
                portable_path = '//textures/' + Path(image.filepath.replace('\\', '/')).name
                image.filepath = portable_path
                if payload.startswith(b'\x89PNG\r\n\x1a\n'):
                    position, chunks = 8, []
                    while position < len(payload):
                        size, kind = struct.unpack_from('>I4s', payload, position)
                        if kind not in {b'tEXt', b'zTXt', b'iTXt'}:
                            chunks.append(payload[position:position + size + 12])
                        position += size + 12
                    clean = payload[:8] + b''.join(chunks)
                    if clean != payload:
                        image.unpack(method='REMOVE')
                        image.pack(data=clean, data_len=len(clean))
                for packed in image.packed_files:
                    packed.filepath = portable_path
        for scene in bpy.data.scenes:
            scene.render.filepath = '//previews/render'
        # Pack first, then use portable texture references in all supported
        # datablocks. No geometry, animation, material or image pixels change.
        for collection_name in ['libraries', 'movieclips', 'sounds', 'fonts']:
            for datablock in getattr(bpy.data, collection_name):
                if hasattr(datablock, 'filepath') and datablock.filepath and scanner.scan_text(datablock.filepath, '', ''):
                    datablock.filepath = '//resources/' + Path(datablock.filepath.replace('\\', '/')).name
        for collection_name in ['scenes', 'objects', 'materials', 'meshes', 'curves', 'actions', 'collections', 'images']:
            for datablock in getattr(bpy.data, collection_name):
                for key in list(datablock.keys()):
                    value = datablock.get(key)
                    if isinstance(value, str) and scanner.scan_text(value, '', ''):
                        datablock[key] = '[local source metadata omitted from portable copy]'
        # Text blocks may contain provenance comments. Preserve their code and
        # normalize only project-root path references in the portable copy.
        for text in bpy.data.texts:
            original_text = text.as_string()
            if scanner.scan_text(original_text, '', ''):
                import re
                normalized = re.sub(r'(?i)[A-Z]:[\\/]+CodexProjects[\\/]+(?:Deskfolk|liquid-glass-pet)[\\/]+', './', original_text)
                if normalized != original_text:
                    text.clear()
                    text.write(normalized)
        bpy.ops.wm.save_as_mainfile(filepath=str(destination), copy=True, compress=True)
        entry['portableCopyCreated'] = True
        entry['portableAllImagesPacked'] = all(i.packed_file or i.source in {'GENERATED', 'VIEWER'} for i in images)
        after_data = {'objects': len(bpy.data.objects), 'meshes': len(bpy.data.meshes),
                      'vertices': sum(len(mesh.vertices) for mesh in bpy.data.meshes),
                      'curves': len(bpy.data.curves), 'materials': len(bpy.data.materials),
                      'actions': len(bpy.data.actions)}
        assert before_data == after_data, 'Editable data counts changed'
        entry['editableDataCounts'] = before_data
        entry['editableDataCountsPreserved'] = True
    report.append(entry)
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps({'models': report}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'modelsInspected': len(report), 'metadataFindings': sum(len(m['findings']) for m in report), 'portableCopies': bool(args.portable_dir)}))

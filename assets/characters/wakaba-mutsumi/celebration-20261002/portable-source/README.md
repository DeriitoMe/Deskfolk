# Editable celebration sources

These are portable copies of the celebration artwork. Original local drafts are retained separately. Open the `.blend`, `.kra`, `.ora`, and `.aseprite` files directly in their respective applications.

- `mini-confetti-poppers.blend`: editable left and right poppers, with 22 meshes and relative render output paths. Geometry, transforms, and parent relationships match the original draft.
- `celebration-effects.kra` and `.ora`: layered sweat, stars, and confetti artwork. The Krita copy removes local author identity metadata while preserving its title, license fields, and every paint/layer payload.
- `touch-30fps.aseprite`: 48 frames, 1.6 seconds.
- `celebrate-poppers-30fps.aseprite`: 75 frames, 2.5 seconds.
- `celebrate-clap-30fps.aseprite`: 72 frames, 2.4 seconds.
- The remaining Aseprite files and `layers/` PNGs contain the individual editable effects.

The verification JSON files retain the original creation checks. Portable Blender copies were additionally reopened and compared in Blender. Aseprite, ORA, and layer PNGs are byte-identical to their drafts; Krita paint/layer archive members are byte-identical. Runtime exports are in the neighboring `runtime/` directory.

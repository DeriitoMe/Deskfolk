# Celebration and touch props

These props attach to the existing Q character. The character source stays in its original directory.

`runtime/mini-confetti-poppers.glb` contains the two roots `MiniPopper_L` and `MiniPopper_R`. Each grip is at the root origin; the exported axis is local +Y, and the aperture is at `(0, .24, 0)`. Diameter is `.18` and length is `.40`, in the character's existing units. All materials are unlit. Position the roots at the hand controls and point their local +Y axes upward and slightly outward.

`runtime/sweat-large.png` and `runtime/sweat-small.png` are transparent blue-green droplets, intended to appear together near the forehead during touch. Both include a light outline and a small ivory glint. Suggested billboard heights are `.17` and `.12`; preserve their 2:3 aspect ratio.

`runtime/gentle-star.png` is a quiet gold four-point star for the two-clap celebration. `runtime/confetti-strip.png` is neutral ivory paper with a fold that can be tinted in the runtime.

Editable sources are in `source/`: Blender poppers with independent mesh parts, four native Aseprite documents with separate contour/fill/shade/highlight layers, and one native Krita document with four effect groups. The OpenRaster interchange and layer PNGs are also included.

The measured runtime sequences are saved as `touch-30fps.aseprite` (48 frames, 1.6 seconds), `celebrate-poppers-30fps.aseprite` (75 frames, 2.5 seconds), and `celebrate-clap-30fps.aseprite` (72 frames, 2.4 seconds). Each has a labeled rendered animation layer and a full clip tag. Native frame durations repeat 33, 33, 34 milliseconds for exact 30 FPS average timing. GIF previews preserve each total duration with 30, 30, 40 millisecond frame durations. The importer is `scripts/assemble-celebration-timelines.lua`; native save/reopen records are in `source/animation-timelines-verification.json`.

Rebuild the props with `scripts/build-celebration-poppers.py` in Blender background mode. Rebuild the effect art with `scripts/build-celebration-effects.lua` in Aseprite batch mode, assemble the layer document with `scripts/assemble-celebration-effects-krita.py`, then use `scripts/export-celebration-effects-krita.py` to save and reopen it in Krita. Native save/reopen evidence is recorded in the source verification JSON files; the previews are exported from those tools. `scripts/verify-celebration-art.py` checks the native documents, transparent exports and GLB runtime contract.

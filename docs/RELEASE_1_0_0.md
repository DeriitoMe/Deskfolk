# Deskfolk v1.0.0

Deskfolk's first 1.0 release brings the latest desktop companion interactions, expressive animation, sound effects, and lifecycle fixes into one Windows build.

## Download

Download the Windows x64 installer from this release's **Assets**. Exit a running copy of Deskfolk before installing. The app and shortcut are named **Deskfolk**; existing compatible preferences, history, and saved placement are retained. Check the accompanying SHA256 checksums against the downloaded files. The installer is unsigned.

## Character and interaction

- Real-time 3D chibi Wakaba Mutsumi, gentle mouse following through the eyes, head, and body, and a head-only pixel desktop/tray icon.
- Faster headpats with a short press-and-rebound motion that responds to repeated clicks.
- A teary reaction after ten consecutive taps, with continuously moving water highlights and two strictly alternating reaction sounds.
- A dizzy reaction after three same-direction mouse circles while the pet is idle.
- Dragging with a crown suspension point, gravity and damping, a bounded swing of about 70 degrees, hair inertia, and the existing relaxed/struggling cycle.
- More visible nap Zs, finer translucent watering streams, larger watering props, improved side-hair shading, and geometry covering two hair gaps visible during watering.
- Two alternating celebration animations for confirmed successful task completions.

## Bubbles and sound

- White oval bubbles, larger connecting dots, dark-green bold text, and sequential entrance animation followed by a soft fade-out.
- Bubble placement follows the pet's head within the stable display area.
- Updated Chinese messages and matching short character sound effects, including an independent super-work cue.
- Headpat and both teary reaction sounds play at 75% volume. A teary voice is allowed to finish without overlapping headpat sounds.

## Work and event handling

- Synchronized code-like light animation in both eyes during work, running at the updated 1.5× animation rate.
- Super-work behavior for at least two distinct active projects, with subtle hair movement and an independent message/sound cue.
- More reliable native task start, completion, interruption, project identity, event ordering, and renderer startup delivery.
- Open browser projects and surviving background processes do not establish task activity on their own.
- Confirmed native questions have their own pending lifecycle. The visible question reaction lasts about eight seconds; answering is tracked separately.
- Historical questions from ended sessions are kept out of current pending reminders on restart.
- Success celebrations are queued per confirmed completion; interruption, failure, and quota exhaustion do not trigger success celebrations.

## Quota board and desktop behavior

- Right-click the pet to raise a wooden board showing the remaining five-hour account allowance when reliable data is available.
- The complete board interaction lasts about 3.8 seconds. Arm recovery overlaps the board fade for a continuous exit.
- Stable public canvas and native layout eliminate the previously reproduced blank frames, offsets, and clipping during click, board, and drag transitions.
- Refreshed settings and project views, saved placement, and optional companion auto-start enabled by default.

## Supported scope and limitations

- Windows x64 is the packaged platform; Wakaba Mutsumi is the current playable character.
- Supported native event sources are documented in the maintainer handoff. A selectable whale character and additional Agent adapters are not included in this release.
- Real input reminders use confirmed native question events. Compatibility/demo permission events are not a general live authorization interface.
- Pause and manual stop may share the same native interruption event. Missing terminal events are not replaced with a guessed inactivity timeout.
- The five-hour board is triggered by right-click. Automatic 75% / 50% / 25% threshold reminders are not implemented.
- Missing or expired quota data is shown as unavailable or needing refresh; weekly limits and model-specific buckets are not substituted for the five-hour allowance.
- The chibi form is active. Historical transformation code and artwork are retained for future work.

See the repository's maintainer handoff for architecture, supported event rules, and verification guidance. Published checksums identify this release's exact downloadable artifacts; historical local test reports identify the earlier builds they actually tested.

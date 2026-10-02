# Super-work project identity repair — 2026-10-02

## Cause and confirmed rule

The original monitor observed three working parent chats in distinct Codex sidebar projects, but all projects shared one workspace directory. The prior directory-based aggregation merged them into a single project. The user confirmed counting distinct Codex sidebar project identities instead. Chats in the same project count once, including when their current directories differ.

## Implementation

- `electron/codex-projects.ts` reads the local sidebar assignment sections of `.codex-global-state.json`, validates local project/session UUIDs and host membership, and caches only the session-to-project ID map. Project names and chat content do not participate in identity. Codex's files are not modified.
- Successful file snapshots are cached by size/mtime. Temporary missing, damaged, or concurrently replaced state retains the last verified ID map and retries. A valid assignment deletion clears the identity. Unsupported/unassigned sessions retain the canonical directory fallback. This adapter follows the observed local Desktop state format; if that format changes, its tests and adapter must be updated.
- `electron/codex-lifecycle.ts` attaches the current project ID to native start/context events, and reconciles assignment changes even without new log bytes. Restart catch-up also calibrates persisted pending questions. Metadata reconciliation cannot start or resume work, clear native questions, or revive a terminal turn.
- `shared/activity.ts` aggregates distinct working project IDs, excludes child agents, and retains the confirmed native identity against late hooks and older turns. Task lifecycle and success/celebration rules remain in effect.
- The preceding startup discovery repair remains: all log candidates are checked progressively, at most eight headers per poll; FIFO ordering prevents newer child logs from hiding an unchanged active parent.

## Verification

58 targeted logic tests passed. TypeScript checking, production build and diff whitespace checks passed. The packaged application passed 9 checks using a separate hidden Electron profile and native JSONL fixtures. Tests included two sidebar projects sharing one directory behind 40 newer child logs, multiple chats within one project, assignment changes without log writes, native stop/resume, partial project stop, ordinary-work downgrade, and final idle recovery. Full-power rendering measured 57.9 FPS.

The renderer files, animation resources and model bytes match the pre-change installed application. The executable and ASAR were updated together, Deskfolk restarted, and bridge health verified. Live read-only verification found 1 working parent chat(s) across 1 project(s), matching the current Codex sidebar assignments; the remaining live work at verification therefore correctly used ordinary work. The two-project super-work path was verified in the packaged production runtime.

![Packaged two-project super-work test](images/super-work-projects-20261002.png)

## Rollback

Source copies and the binary working-tree diff immediately before project-identity integration are preserved under `.cache/power-work-20261002/project-count-before`. Its `installed` folder preserves the pre-change executable, ASAR and launcher with a hash manifest. Stop Deskfolk before restoring the executable and ASAR as a matching pair. Earlier source and installed backups remain under `before`. No old artwork or editable source was deleted. Version remains 0.1.0. No GitHub push or release publication was performed.

## Reproduce the logic checks

`node --test shared/companion-feedback.test.ts shared/activity.test.ts electron/codex-lifecycle.test.ts electron/codex-projects.test.ts electron/renderer-events.test.ts`

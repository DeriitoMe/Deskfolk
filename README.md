# Deskfolk

A tiny Windows desktop companion featuring Wakaba Mutsumi, with a soft illustrated look and a real-time 3D character.

[Download v1.0.0](https://github.com/DeriitoMe/Deskfolk/releases/tag/v1.0.0) · [All releases](https://github.com/DeriitoMe/Deskfolk/releases) · [Release notes](docs/RELEASE_1_0_0.md)

## A little company on your desktop

- Gentle idle motion, naps with floating Zs, and a little cucumber-watering routine.
- Eye, head, and body tracking as the mouse moves.
- A quick, springy headpat reaction. Ten consecutive taps bring out a teary expression and one of two alternating reaction sounds.
- A dizzy reaction after circling the idle pet with the mouse three times.
- Gravity-driven dragging, a suspension point at the crown, swaying hair, and a playful struggle while being carried.
- Glowing eyes while work is in progress.
- Alternating celebration animations after confirmed successful tasks.
- White oval message bubbles with animated entrances and soft fades, plus optional character sound effects.
- A right-click quota board showing the remaining five-hour allowance when compatible account data is available.
- A head-only pixel icon, tray settings, local notification history, saved position, and optional companion auto-start enabled by default.

The current playable character is the chibi form of Wakaba Mutsumi.

## Download and install

1. Open [v1.0.0 on GitHub Releases](https://github.com/DeriitoMe/Deskfolk/releases/tag/v1.0.0).
2. Download the Windows x64 installer from **Assets**.
3. Exit any running copy of Deskfolk, run the installer, and launch **Deskfolk**.

The application and desktop shortcut are named **Deskfolk**. Existing installations retain their compatible local preferences and notification history. Windows may display a security prompt for the unsigned installer; verify the source and the published SHA256 checksums before choosing to run it.

## Interact

| Input | Reaction |
| --- | --- |
| Move the mouse | Gentle eye, head, and body tracking |
| Left-click | A quick headpat; ten consecutive taps trigger the teary reaction |
| Click and drag | Pick up the pet and let it swing |
| Circle the idle pet three times in one direction | A dizzy reaction |
| Right-click the pet | Raise the five-hour quota board |
| Right-click the system tray icon | Open settings, view current projects, or exit |

Settings include notifications, do-not-disturb mode, and startup behavior. The quota board displays an unavailable or refresh-needed state when a reliable five-hour allowance cannot be read.

## Agent integrations

This development branch adds native DeepSeek Harness support alongside Codex and Claude Code. Choose **All**, **Codex**, **Claude Code**, or **DeepSeek** in settings. The adapter observes actual work, tool execution, native questions, approvals and completion; it also restores current state after reconnection.

See the [Harness installation guide](plugins/deskfolk-deepseek-harness/README.md) and [implementation and verification notes](docs/deepseek-harness-adapter-20261019.md). The Windows build includes the external Harness plugin in `resources/plugins/deskfolk-deepseek-harness/`. Install it into the Harness profile you use. The published v1.0.0 download predates these adapters.

## Develop

Requirements: Windows, Node.js 20.19 or newer, and the Windows .NET Framework 4.x compiler included with Windows. The test suite uses Node's built-in TypeScript support; use Node.js 24 for the documented test commands.

```powershell
npm ci
npm run dev
```

Build the application:

```powershell
npm run build
```

Build a Windows installer:

```powershell
npm run dist:win
```

The installer is written to `release/`. For architecture, state-event rules, resource locations, and isolated verification, start with the [maintainer handoff](docs/AGENT_HANDOFF.md). Files with V41/V42 in their names are historical implementation names; the product version is defined in `package.json` and Git tags.

## Privacy

Preferences and notification history stay on the local computer. Public source and release exports exclude local session records, credentials, browser profiles, and temporary files. Maintainer documents describe supported interfaces and their limits.

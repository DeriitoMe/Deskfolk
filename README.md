# Deskfolk

A tiny desktop companion featuring Wakaba Mutsumi, with a soft, illustrated look and a real-time 3D character. Available for Windows.

## Features

- A transparent desktop pet with a head-only pixel icon, tray settings, and saved window position.
- Gentle idle motion, naps, cucumber watering, click reactions, and playful struggles when picked up.
- Smooth eye and body tracking as the mouse moves.
- Glowing eyes while work is in progress.
- Gravity-driven dragging with a suspension point at the crown and a smooth, bounded swing.
- Optional companion auto-start, enabled by default.
- Cute message bubbles and local notification history.

The current character is the chibi form. Additional appearance assets are retained for future work.

## Install

Download the Windows x64 installer from [Releases](https://github.com/DeriitoMe/Deskfolk/releases). Exit a running copy before installing. The Windows application and shortcut are named **Deskfolk**.

Open settings by right-clicking the system tray icon. Choose **Exit** from that menu to close the pet.

## Develop

Requirements: Windows, Node.js 20.19 or newer, and the Windows .NET Framework 4.x compiler included with Windows.

```powershell
npm ci
npm run dev
```

Build the application and installer:

```powershell
npm run build
node scripts/stage-v42-package.mjs
npx electron-builder --projectDir .cache/v42-package --win nsis
```

Installers are written to `release/v42`. Build output, local preferences, and caches are excluded from version control.

## Privacy

Preferences and notification history stay on the local computer. The repository excludes local session records, credentials, browser profiles, and temporary files.

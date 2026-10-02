"""Save a native layered Krita source and reopen it with the installed Krita app."""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/celebration-20261002"
CACHE = ROOT / ".cache/celebration-20261002"
CACHE.mkdir(parents=True, exist_ok=True)
font_cache = CACHE / "fontconfig"
font_cache.mkdir(exist_ok=True)
font_config = CACHE / "krita-fonts.conf"
font_config.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>' + font_cache.as_posix() + '</cachedir></fontconfig>', encoding="utf8")
env = os.environ.copy()
env.update({"QT_OPENGL": "software", "FONTCONFIG_FILE": str(font_config)})
env.pop("QT_QPA_PLATFORM", None)
executable = Path("F:/散/Krita (x64)/bin/krita.exe")

def export(source, target):
    print("KRITA_NATIVE_EXPORT", source.name, "->", target.name, flush=True)
    command = [str(executable), "--nosplash", "--export", "--export-filename", str(target), str(source)]
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    completed = subprocess.run(command, cwd=executable.parent, env=env, capture_output=True, timeout=45, startupinfo=startup)
    (CACHE / (target.stem + "-krita.log")).write_bytes(completed.stdout + completed.stderr)
    assert completed.returncode == 0 and target.exists(), (completed.returncode, completed.stdout, completed.stderr)

export(DEST / "source/celebration-effects.ora", DEST / "source/celebration-effects.kra")
export(DEST / "source/celebration-effects.kra", DEST / "preview/effects-krita-reopened.png")
print("NATIVE_KRITA_SAVED_AND_REOPENED", flush=True)

"""Prepare the guitar easter-egg clip and its note onsets.

    python -I scripts/prepare-guitar-solo-audio.py <source.wav>

Writes renderer/assets/audio/mutsumi-guitar-solo.wav: mono, 48 kHz, 24-bit,
RMS about -33 dBFS (roughly -34 LUFS as played at 0.75): about 10 dB under
the speech bubbles, since an 8 s run of bright guitar reads much louder than
a one-second voice line at the same level. 20 ms fade-in, 300 ms fade-out.
Prints the onset times (s) found with a spectral-flux detector; they drive
the picking hand (SOLO_ONSETS in shared/guitar-solo.ts).
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'renderer/assets/audio/mutsumi-guitar-solo.wav'
TARGET_RMS_DB, RATE = -33.0, 48000


def read(path):
    with wave.open(str(path)) as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = np.frombuffer(w.readframes(n), dtype=np.uint8)
    if sw == 3:
        b = raw.reshape(-1, 3).astype(np.int32)
        x = (b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)); x = np.where(x >= 1 << 23, x - (1 << 24), x) / float(1 << 23)
    elif sw == 2:
        x = raw.view('<i2') / 32768.0
    else:
        x = raw.view('<i4') / float(1 << 31)
    return x.reshape(-1, ch).mean(axis=1), sr


def onsets(x, sr):
    hop, size = 512, 2048
    window = np.hanning(size)
    frames = [np.abs(np.fft.rfft(window * x[i:i + size])) for i in range(0, len(x) - size, hop)]
    mag = np.log1p(np.array(frames) * 100)
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    times, last = [], -1.0
    for i in range(2, len(flux) - 2):
        local = flux[max(0, i - 8):i + 8]
        t = (i + 1) * hop / sr
        if flux[i] == local.max() and flux[i] > max(.6, np.median(local) + .5) and t - last > .09:
            times.append(round(t, 3)); last = t
    return times


x, sr = read(sys.argv[1])
found = onsets(x, sr)
if sr != RATE:
    t_new = np.arange(int(len(x) * RATE / sr)) / RATE
    x = np.interp(t_new, np.arange(len(x)) / sr, x)
rms = np.sqrt(np.mean(x ** 2))
gain = 10 ** (TARGET_RMS_DB / 20) / rms
y = x * gain
fade_in, fade_out = int(.02 * RATE), int(.3 * RATE)
y[:fade_in] *= np.linspace(0, 1, fade_in)
y[-fade_out:] *= np.linspace(1, 0, fade_out) ** 2
y = np.clip(y, -1, 1 - 2 ** -23)
pcm = np.round(y * (1 << 23)).astype(np.int32)
data = np.stack([pcm & 0xff, (pcm >> 8) & 0xff, (pcm >> 16) & 0xff], axis=1).astype(np.uint8).tobytes()
with wave.open(str(OUT), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(3); w.setframerate(RATE); w.writeframes(data)
peak = np.abs(y).max()
print(json.dumps({'seconds': round(len(y) / RATE, 3), 'gainDb': round(20 * np.log10(gain), 1),
                  'rmsDb': round(20 * np.log10(np.sqrt(np.mean(y ** 2))), 1), 'peakDb': round(20 * np.log10(peak), 1),
                  'onsets': found}))

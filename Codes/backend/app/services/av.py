"""ffmpeg / ffprobe helpers (async subprocess, no shell)."""
from __future__ import annotations

import asyncio
import json
import math
import struct
import tempfile
import wave
from pathlib import Path

from ..storage import storage


class AvError(RuntimeError):
    pass


async def run(*args: str, timeout: float = 600) -> bytes:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise AvError(f"{args[0]} timed out")
    if proc.returncode != 0:
        raise AvError(f"{args[0]} failed: {err.decode(errors='replace')[-400:]}")
    return out


def tmp(suffix: str) -> Path:
    fd, name = tempfile.mkstemp(suffix=suffix, prefix="my_", dir=storage().scratch_dir())
    import os
    os.close(fd)
    return Path(name)


async def probe(path: Path) -> dict:
    out = await run("ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path))
    return json.loads(out or b"{}")


async def duration(path: Path) -> float:
    try:
        info = await probe(path)
        return float(info.get("format", {}).get("duration") or 0.0)
    except (AvError, ValueError):
        return 0.0


async def to_wav16k(src: Path, dest: Path | None = None, *, clean: bool = False,
                    start: float | None = None, end: float | None = None) -> Path:
    """Mono 16 kHz PCM WAV. `clean` applies light vocal isolation (band-pass + denoise)."""
    dest = dest or tmp(".wav")
    args = ["ffmpeg", "-y", "-v", "error"]
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    if end is not None:
        args += ["-to", f"{end:.3f}"]
    args += ["-i", str(src), "-vn", "-ac", "1", "-ar", "16000"]
    if clean:
        args += ["-af", "highpass=f=80,lowpass=f=7800,afftdn=nf=-25,dynaudnorm=f=200"]
    args += ["-c:a", "pcm_s16le", str(dest)]
    await run(*args)
    return dest


async def to_mp3(src: Path, dest: Path | None = None, bitrate: str = "96k") -> Path:
    dest = dest or tmp(".mp3")
    await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-b:a", bitrate, str(dest))
    return dest


async def silences(wav: Path, noise_db: int = -32, min_s: float = 0.45) -> list[tuple[float, float]]:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "info", "-i", str(wav), "-af", f"silencedetect=noise={noise_db}dB:d={min_s}",
        "-f", "null", "-", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    spans: list[tuple[float, float]] = []
    start = None
    for line in err.decode(errors="replace").splitlines():
        if "silence_start:" in line:
            start = float(line.split("silence_start:")[1].split()[0])
        elif "silence_end:" in line and start is not None:
            end = float(line.split("silence_end:")[1].split()[0])
            spans.append((start, end))
            start = None
    return spans


def speech_segments(silent: list[tuple[float, float]], total: float, min_len: float = 1.5,
                    max_len: float = 12.0) -> list[tuple[float, float]]:
    """Invert silence spans into speech segments, merging tiny ones and splitting long ones."""
    segs: list[tuple[float, float]] = []
    cur = 0.0
    for s, e in silent:
        if s - cur > 0.25:
            segs.append((cur, s))
        cur = e
    if total - cur > 0.25:
        segs.append((cur, total))
    merged: list[tuple[float, float]] = []
    for s, e in segs:
        if merged and (s - merged[-1][1] < 0.6) and (e - merged[-1][0] <= max_len):
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    out: list[tuple[float, float]] = []
    for s, e in merged:
        while e - s > max_len:
            out.append((s, s + max_len))
            s += max_len
        if e - s >= min_len:
            out.append((s, e))
    return out


async def extract_frames(video: Path, out_dir: Path, every_s: float = 1.0, max_frames: int = 40) -> list[tuple[float, Path]]:
    dur = await duration(video)
    if dur <= 0:
        dur = 10.0
    step = max(every_s, dur / max_frames)
    out_dir.mkdir(parents=True, exist_ok=True)
    await run("ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf", f"fps=1/{step:.3f},scale='min(1280,iw)':-2",
              "-q:v", "3", str(out_dir / "f_%04d.jpg"))
    frames = sorted(out_dir.glob("f_*.jpg"))
    return [(i * step, p) for i, p in enumerate(frames)]


async def strip_video_metadata(src: Path, dest: Path) -> Path:
    """Drop all container metadata (incl. GPS) without re-encoding."""
    try:
        await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", "0:v?", "-map", "0:a?",
                  "-map_metadata", "-1", "-c", "copy", "-movflags", "+faststart", str(dest))
    except AvError:
        await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-map_metadata", "-1", "-c:v", "libx264",
                  "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", str(dest))
    return dest


async def tag_ai_generated(src: Path, dest: Path) -> Path:
    """Embed an AI-generated marker in container metadata (brief 6.4 / 7)."""
    await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-c", "copy", "-map_metadata", "-1",
              "-metadata", "comment=AI-generated recreation (Miss You). Not a real recording.",
              "-metadata", "title=AI-generated", "-metadata", "artist=Miss You AI",
              "-movflags", "+faststart", str(dest))
    return dest


async def loopify(src: Path, dest: Path, fade: float = 0.8) -> Path:
    """Make a clip loop seamlessly by cross-fading its tail into its head."""
    dur = await duration(src)
    if dur < 2.5:
        await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                  "-movflags", "+faststart", str(dest))
        return dest
    body = dur - fade
    filt = (f"[0:v]split[a][b];[a]trim=0:{body:.3f},setpts=PTS-STARTPTS[main];"
            f"[b]trim={body:.3f}:{dur:.3f},setpts=PTS-STARTPTS[tail];"
            f"[main]trim=0:{fade:.3f},setpts=PTS-STARTPTS[head];"
            f"[main]trim={fade:.3f}:{body:.3f},setpts=PTS-STARTPTS[rest];"
            f"[tail][head]xfade=transition=fade:duration={fade:.3f}:offset=0[joint];"
            f"[rest][joint]concat=n=2:v=1:a=0[v]")
    try:
        await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-filter_complex", filt, "-map", "[v]", "-an",
                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
                  "-movflags", "+faststart", str(dest))
    except AvError:
        await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                  "-movflags", "+faststart", str(dest))
    return dest


async def animated_still(image: Path, dest: Path, seconds: float = 8.0, variant: str = "idle") -> Path:
    """Fallback 'video' from a still: slow handheld sway + gentle breathing zoom.

    Used when no hosted video provider is available (brief 4.3 graceful degradation).
    """
    fps = 24
    n = int(seconds * fps)
    amp = 6 if variant == "idle" else 9
    # Periodic in n so the loop is seamless.
    zoom = f"1.06+0.012*sin(2*PI*on/{n})"
    x = f"iw/2-(iw/zoom/2)+{amp}*sin(2*PI*on/{n})"
    y = f"ih/2-(ih/zoom/2)+{amp * 0.6:.1f}*sin(4*PI*on/{n}+1)"
    await run("ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(image),
              "-vf", f"scale=1440:-2,zoompan=z='{zoom}':x='{x}':y='{y}':d=1:s=720x1280:fps={fps},"
                     f"format=yuv420p",
              "-frames:v", str(n), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
              "-movflags", "+faststart", str(dest), timeout=300)
    return dest


async def still_with_audio(image: Path, audio: Path, dest: Path) -> Path:
    """A talking message without a talking-head provider: animated still + voice."""
    dur = max(await duration(audio), 1.0)
    fps = 24
    n = int(dur * fps) + fps
    await run("ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(image), "-i", str(audio),
              "-filter_complex",
              f"[0:v]scale=1440:-2,zoompan=z='1.05+0.015*sin(2*PI*on/{fps * 8})':"
              f"x='iw/2-(iw/zoom/2)+5*sin(2*PI*on/{fps * 6})':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps={fps},"
              f"format=yuv420p[v]",
              "-map", "[v]", "-map", "1:a", "-frames:v", str(n), "-shortest", "-c:v", "libx264", "-preset", "veryfast",
              "-crf", "24", "-c:a", "aac", "-b:a", "96k",
              "-metadata", "comment=AI-generated recreation (Miss You). Not a real recording.",
              "-movflags", "+faststart", str(dest), timeout=600)
    return dest


def tone_wav(seconds: float = 1.0, freq: float = 220.0, rate: int = 16000) -> bytes:
    """A soft tone — used only by mock providers in tests."""
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * freq * i / rate)))
                          for i in range(int(seconds * rate)))
        w.writeframes(frames)
    return buf.getvalue()

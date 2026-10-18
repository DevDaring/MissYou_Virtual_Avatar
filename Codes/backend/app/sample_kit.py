"""Build the fictional sample family kit (config/sample_kit/) once.

Every face and voice is AI-generated (xAI) — no real people. Lets anyone try
the full setup flow: a family video with three people → pick one → confirm the
voice → clone → scene → call. Run: python -m app.sample_kit   (≈ $0.40)
"""
from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from .config import settings
from .providers import xai_media
from .services import av

OUT = settings.config_dir / "sample_kit"
GROUP = ("Photorealistic candid smartphone photo of a fictional Bengali Indian family of three adults sitting together "
         "on a sofa at home, all faces clearly visible and looking at the camera, well lit: on the left a kind "
         "grandfather in his early seventies with white hair, a neat white moustache, thin-rimmed glasses and a cream "
         "kurta; in the middle his daughter in her forties in a blue cotton saree; on the right his grandson in his "
         "early twenties in a grey t-shirt. Warm afternoon light, natural skin texture, realistic, no text.")
SOLO = [("Keep the exact same elderly grandfather from <IMAGE_0> (the man on the left) — same face, glasses, white "
         "hair and moustache. Show only him, a close natural portrait, smiling gently, sitting on a balcony with "
         "plants, morning light, realistic phone photo."),
        ("Keep the exact same elderly grandfather from <IMAGE_0> (the man on the left) — same face, glasses, white "
         "hair and moustache. Show only him reading a newspaper and looking up at the camera with a warm smile, "
         "living room, soft window light, realistic phone photo.")]
VIDEO = ("Home video filmed on a phone. The grandfather on the left looks at the camera and speaks warmly and slowly in "
         "Indian English: \"Happy birthday, my dear. Eat on time, study well, and call your Dadu every Sunday, okay?\" "
         "His daughter and grandson smile and nod. Only the grandfather speaks. Gentle, natural, no music.")


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    group = OUT / "family_sofa.jpg"
    if not group.exists():
        group.write_bytes(await xai_media.image(GROUP, [], aspect_ratio="4:3", feature="sample_kit"))
    for i, prompt in enumerate(SOLO, 1):
        f = OUT / f"dadu_{i}.jpg"
        if not f.exists():
            f.write_bytes(await xai_media.image(prompt, [group], aspect_ratio="3:4", feature="sample_kit"))
    vid = OUT / "family_birthday_video.mp4"
    if not vid.exists():
        raw = tmp / "v.mp4"
        raw.write_bytes(await xai_media.video(VIDEO, group, seconds=8, feature="sample_kit", with_audio=True))
        await av.run("ffmpeg", "-y", "-v", "error", "-i", str(raw), "-c:v", "libx264", "-preset", "veryfast",
                     "-crf", "26", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(vid))
    (OUT / "README.txt").write_text("Fictional sample family for trying Miss You. All faces and voices are "
                                    "AI-generated (xAI Grok Imagine). No real people are depicted.\n")
    shutil.rmtree(tmp, ignore_errors=True)
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())

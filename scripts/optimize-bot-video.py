"""Build the transparent hero animation and its still from the source MP4.

Requires imageio-ffmpeg, NumPy, Pillow and SciPy.
"""

from contextlib import closing
from io import BytesIO
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image
from scipy import ndimage


PUBLIC = Path(__file__).resolve().parents[1] / "public"
SOURCE = PUBLIC / "Bot_typing_on_keyboard_f1cf8890 (1).mp4"
ANIMATION = PUBLIC / "pipelixr-agent-typing.webp"
STILL = PUBLIC / "pipelixr-agent-typing-still.webp"


def isolate_bot(pixels: np.ndarray) -> Image.Image:
    """Keep dark interior details and feather only the outside edge."""
    padding = 6
    silhouette = np.pad(pixels.max(axis=-1) >= 26, padding, mode="edge")
    silhouette = ndimage.binary_closing(silhouette, iterations=2)
    silhouette = ndimage.binary_fill_holes(silhouette)
    silhouette = ndimage.binary_opening(silhouette, iterations=2)
    labels, count = ndimage.label(silhouette)
    if not count:
        raise ValueError("No bot silhouette detected in the source frame")

    largest = np.bincount(labels.ravel())[1:].argmax() + 1
    outline = ndimage.binary_erosion(labels == largest, iterations=2)
    alpha = ndimage.gaussian_filter(outline.astype(np.uint8) * 255, sigma=0.75, output=np.float32)
    alpha = np.rint(alpha[padding:-padding, padding:-padding]).astype(np.uint8)

    frame = Image.fromarray(pixels).convert("RGBA")
    frame.putalpha(Image.fromarray(alpha))
    return frame


def main() -> None:
    with closing(imageio_ffmpeg.read_frames(str(SOURCE), output_params=["-fps_mode", "passthrough"])) as video:
        metadata = next(video)
        width, height = metadata["size"]
        frames = [
            isolate_bot(np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3))
            for raw in video
        ]

    frame_ms = 1000 / metadata["fps"]
    durations = [
        round((index + 1) * frame_ms) - round(index * frame_ms)
        for index in range(len(frames))
    ]
    print(f"Encoding {len(frames)} frames at {width}x{height} and {metadata['fps']:g} fps")

    animation = BytesIO()
    frames[0].save(
        animation,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        minimize_size=True,
        quality=84,
        method=4,
    )
    ANIMATION.write_bytes(animation.getbuffer())
    frames[0].save(STILL, quality=92, method=4)
    print(f"Saved {ANIMATION.name} ({ANIMATION.stat().st_size / 1e6:.1f} MB) and {STILL.name}")


if __name__ == "__main__":
    main()

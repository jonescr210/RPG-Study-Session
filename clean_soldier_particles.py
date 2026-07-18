from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


SOURCE_DIR = Path("assets/enemies")
OUTPUT_DIR = SOURCE_DIR / "clean"


def clean_sprite(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[..., :3]
    original_alpha = rgba[..., 3]
    high = rgb.max(axis=2)
    low = rgb.min(axis=2)
    red_energy = rgb[..., 0].astype(np.int16) - np.maximum(
        rgb[..., 1], rgb[..., 2]
    ).astype(np.int16)

    # The soldier itself is a dense, connected black/red mass. Gray liquid and
    # surrounding particles are comparatively bright, thin, or disconnected.
    core = (original_alpha > 20) & ((high < 105) | (red_energy > 20))
    # A wider opening severs the thin effect tendrils from the much broader
    # armor, limbs, weapons, and equipment before selecting the main mass.
    core = ndimage.binary_opening(core, structure=np.ones((7, 7)), iterations=1)
    core = ndimage.binary_closing(core, structure=np.ones((5, 5)), iterations=2)

    labels, count = ndimage.label(core)
    if count:
        sizes = ndimage.sum(core, labels, range(1, count + 1))
        main_label = int(np.argmax(sizes)) + 1
        body = labels == main_label
    else:
        body = core

    # Expand just enough to restore antialiased armor edges and red glow.
    body = ndimage.binary_dilation(body, structure=np.ones((3, 3)), iterations=5)
    body = ndimage.binary_closing(body, structure=np.ones((5, 5)), iterations=2)
    body = ndimage.binary_fill_holes(body)

    # Feather only the outermost pixel so game scaling remains smooth.
    matte = ndimage.gaussian_filter(body.astype(np.float32), sigma=0.55)
    matte = np.clip((matte - 0.08) / 0.84, 0, 1)
    rgba[..., 3] = np.minimum(original_alpha, np.round(matte * 255).astype(np.uint8))
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for source in sorted(SOURCE_DIR.glob("enemy-soldier-*.png")):
        cleaned = clean_sprite(Image.open(source))
        cleaned.save(OUTPUT_DIR / source.name, optimize=True)


if __name__ == "__main__":
    main()

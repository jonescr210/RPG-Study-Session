from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


SOURCE = Path("assets/shadow-enemies/clean-final")
OUTPUT = Path("assets/shadow-enemies/clean-final-no-gold")


def fix_edges(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    alpha = rgba[..., 3]
    rgb = rgba[..., :3].astype(np.int16)

    # Limit correction to the narrow matte around the transparent silhouette.
    transparent = alpha == 0
    edge_band = ndimage.binary_dilation(transparent, iterations=4) & (alpha > 0)
    edge_band |= (alpha > 0) & (alpha < 210)

    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    contaminated = edge_band & (g > b + 7) & (g > 20)

    # Gold/green fringe comes from the green staging background mixing with
    # the intended red edge. Suppress green while retaining red illumination.
    corrected_green = b + np.minimum(4, np.maximum(0, (g - b) // 8))
    rgb[..., 1] = np.where(contaminated, corrected_green, g)

    # Very faint contaminated pixels read as a colored halo; fade only those.
    strong_green = contaminated & (g > r * 0.72) & (alpha < 150)
    rgba[..., 3] = np.where(strong_green, (alpha * 0.55).astype(np.uint8), alpha)
    rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for source in sorted(SOURCE.glob("shadow-enemy-*.png")):
        fix_edges(Image.open(source)).save(OUTPUT / source.name, optimize=True)


if __name__ == "__main__":
    main()

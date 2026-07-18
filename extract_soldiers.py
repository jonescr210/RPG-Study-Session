from pathlib import Path
from PIL import Image, ImageFilter


SOURCE = Path(r"C:\Users\jones\AppData\Local\Temp\codex-clipboard-f9136778-7b87-49a5-bc30-ecff1251b293.png")
OUTPUT = Path("assets/enemies")

# Boundaries fall midway through the clear gaps between the five figures.
SLICES = [
    (20, 405),
    (425, 830),
    (845, 1230),
    (1235, 1645),
    (1640, 2085),
]


def remove_checkerboard(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = px[x, y]
            hi, lo = max(r, g, b), min(r, g, b)
            saturation = hi - lo
            # The baked checkerboard consists of near-neutral light grays.
            # A soft transition retains anti-aliased red/black artwork edges.
            if saturation <= 10 and lo >= 205:
                alpha = 0
            elif saturation <= 16 and lo >= 180:
                alpha = min(255, max(0, int((205 - lo) * 10.2)))
            else:
                alpha = 255
            px[x, y] = (r, g, b, alpha)
    return rgba


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    for index, (left, right) in enumerate(SLICES, 1):
        cut = remove_checkerboard(source.crop((left, 65, right, 675)))
        alpha = cut.getchannel("A")
        bbox = alpha.getbbox()
        if bbox:
            cut = cut.crop(bbox)

        # Fit consistently without scaling up, leaving room for energy wisps.
        canvas = Image.new("RGBA", (512, 640), (0, 0, 0, 0))
        scale = min(472 / cut.width, 600 / cut.height, 1.0)
        if scale < 1:
            cut = cut.resize(
                (round(cut.width * scale), round(cut.height * scale)),
                Image.Resampling.LANCZOS,
            )
        x = (canvas.width - cut.width) // 2
        y = canvas.height - cut.height - 20
        canvas.alpha_composite(cut, (x, y))
        canvas.save(OUTPUT / f"enemy-soldier-{index}.png", optimize=True)


if __name__ == "__main__":
    main()

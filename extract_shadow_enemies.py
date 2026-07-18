from pathlib import Path
from PIL import Image


SOURCE = Path(r"C:\Users\jones\AppData\Local\Temp\codex-clipboard-7bd55a01-7cde-4d20-904f-9830b847a570.png")
OUTPUT = Path("assets/shadow-enemies/source-cutouts")
SLICES = [(0, 305), (300, 615), (605, 925), (910, 1230), (1210, 1535)]


def remove_checkerboard(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = px[x, y]
            hi, lo = max(r, g, b), min(r, g, b)
            saturation = hi - lo
            if saturation <= 10 and lo >= 215:
                alpha = 0
            elif saturation <= 16 and lo >= 185:
                alpha = min(255, max(0, int((215 - lo) * 8.5)))
            else:
                alpha = 255
            px[x, y] = (r, g, b, alpha)
    return rgba


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    for index, (left, right) in enumerate(SLICES, 1):
        cut = remove_checkerboard(source.crop((left, 180, right, 825)))
        bbox = cut.getchannel("A").getbbox()
        if bbox:
            cut = cut.crop(bbox)
        canvas = Image.new("RGBA", (512, 640), (0, 0, 0, 0))
        scale = min(472 / cut.width, 600 / cut.height, 1.0)
        cut = cut.resize(
            (round(cut.width * scale), round(cut.height * scale)),
            Image.Resampling.LANCZOS,
        )
        canvas.alpha_composite(
            cut,
            ((canvas.width - cut.width) // 2, canvas.height - cut.height - 20),
        )
        canvas.save(OUTPUT / f"shadow-enemy-{index}.png", optimize=True)


if __name__ == "__main__":
    main()

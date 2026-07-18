from pathlib import Path
from PIL import Image


SOURCE = Path(r"C:\Users\jones\AppData\Local\Temp\codex-clipboard-aae9198f-82e8-45d5-a562-8cc69998d3d4.png")
OUTPUT = Path("assets/alien-enemies/source-cutouts")
SLICES = [(0, 370), (360, 720), (710, 1060), (1045, 1430), (1410, 1774)]


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
        cut = remove_checkerboard(source.crop((left, 145, right, 710)))
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
            ((canvas.width - cut.width) // 2, (canvas.height - cut.height) // 2),
        )
        canvas.save(OUTPUT / f"alien-enemy-{index}.png", optimize=True)


if __name__ == "__main__":
    main()

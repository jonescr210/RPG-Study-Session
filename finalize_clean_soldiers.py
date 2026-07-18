from pathlib import Path
from PIL import Image


ROOT = Path("assets/enemies/clean-final")


def main() -> None:
    for index in range(1, 6):
        image = Image.open(ROOT / f"alpha-{index}.png").convert("RGBA")
        bbox = image.getchannel("A").getbbox()
        if bbox:
            image = image.crop(bbox)
        scale = min(472 / image.width, 600 / image.height)
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (512, 640), (0, 0, 0, 0))
        canvas.alpha_composite(
            image,
            ((canvas.width - image.width) // 2, canvas.height - image.height - 20),
        )
        canvas.save(ROOT / f"enemy-soldier-{index}.png", optimize=True)


if __name__ == "__main__":
    main()

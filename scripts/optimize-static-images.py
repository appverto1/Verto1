#!/usr/bin/env python3
"""Create bounded-size WebP derivatives without altering original fallback files.

The original PNG/JPEG assets are retained because PWA icons, e-mail images, and
legacy browser clients may still need their existing paths.
"""
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
TUTORIALS = ROOT / "services/help-media"
REPORT = ROOT / "scripts/image-webp-report.json"

def convert(source: Path, widths: tuple[int, ...], quality: int = 82) -> dict:
    with Image.open(source) as opened:
        original = ImageOps.exif_transpose(opened)
        if original.mode not in ("RGB", "RGBA"):
            original = original.convert("RGBA" if "A" in original.getbands() or "transparency" in original.info else "RGB")
        width, height = original.size
        if width < 1 or height < 1:
            raise ValueError(f"Invalid image dimensions: {source}")
        output = []
        for desired_width in widths:
            display_width = min(width, desired_width)
            derivative = original.copy()
            if display_width < width:
                display_height = max(1, round(height * display_width / width))
                derivative = derivative.resize((display_width, display_height), Image.Resampling.LANCZOS)
            suffix = f"-{desired_width}.webp"
            target = source.with_name(source.stem + suffix)
            derivative.save(target, "WEBP", quality=quality, method=6)
            with Image.open(target) as check:
                if check.format != "WEBP" or check.size != derivative.size:
                    raise ValueError(f"WebP derivative failed validation: {target}")
            output.append({"file": str(target.relative_to(ROOT)), "bytes": target.stat().st_size,
                           "width": derivative.width, "height": derivative.height})
    return {"source": str(source.relative_to(ROOT)), "originalBytes": source.stat().st_size,
            "originalWidth": width, "originalHeight": height, "derivatives": output}

def main():
    entries = []
    # Public content images are retained for fallback, and supplied at 480/960/1440px.
    for path in sorted(PUBLIC.glob("*")):
        if path.is_file() and path.suffix.lower() in (".png", ".jpg", ".jpeg"):
            entries.append(convert(path, (480, 960, 1440)))
    # Logos used in React: actual rendering is usually 32-80px (symbol),
    # or ~200-300px (professional sidebar horizontal logo).
    for stem, widths in (("verto-symbol", (128, 256)), ("verto-logo-horizontal", (512, 1024))):
        entries.append(convert(PUBLIC / "branding" / "verto" / (stem + ".png"), widths, 88))
    # Tutorial screenshots require authenticated access. Only the image bytes change;
    # the original JPEG remains the fallback for clients lacking image/webp support.
    tutorials = sorted(TUTORIALS.glob("verto-tutorial-*.jpg"))
    if not tutorials:
        raise RuntimeError("Missing protected help-media screenshots")
    for path in tutorials:
        entries.append(convert(path, (640, 1363), 83))
    # Deterministic size inventory is checked in CI and useful for later optimization.
    REPORT.write_text(json.dumps({"version": 1, "images": entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    originals = sum(x["originalBytes"] for x in entries)
    desktop = sum(x["derivatives"][-1]["bytes"] for x in entries)
    print(f"Optimized {len(entries)} non-PWA images (including {len(tutorials)} protected tutorials).")
    print(f"Original bytes {originals}; desktop WebP bytes {desktop}; reduction {100*(1-desktop/originals):.1f}%")

if __name__ == "__main__":
    main()

"""Prepare the user-supplied key art (.work/keyart) as upscaled plates in .work/keyart/hd.
5.webp is a 3×3 storyboard; only the hero panels without invented UI are cut out."""
from pathlib import Path
from PIL import Image, ImageFilter

K = Path(__file__).resolve().parent / ".work" / "keyart"
(K / "hd").mkdir(parents=True, exist_ok=True)
sb = Image.open(K / "5.webp").convert("RGB")
xs = [(0, 556), (561, 1110), (1116, 1672)]
ys = [(0, 312), (318, 625), (631, 941)]
panels = {"sb-hulk": (1, 0), "sb-doraemon": (1, 1), "sb-kratos": (1, 2), "sb-spider": (2, 0), "sb-title": (0, 0), "sb-chamber": (0, 2)}
for name, (r, c) in panels.items():
    (x0, x1), (y0, y1) = xs[c], ys[r]
    p = sb.crop((x0 + 2, y0 + 2, x1 - 2, y1 - 2))
    p = p.resize((p.width * 3, p.height * 3), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2.2, percent=90, threshold=2))
    p.save(K / "hd" / f"{name}.jpg", quality=95)
for n in ("3", "4"):
    Image.open(K / f"{n}.webp").convert("RGB").save(K / "hd" / f"kratos-{n}.jpg", quality=95)
print("key art ready")

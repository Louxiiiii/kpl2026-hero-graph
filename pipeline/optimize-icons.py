
import os, sys
from PIL import Image

root = r"C:\Users\lenovo\Documents\deepseek-harness\default-workspace\kpl2026\assets\hero"
out = root
converted = 0
skipped = 0
before = 0
after = 0
for name in sorted(os.listdir(root)):
    if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        continue
    hid = name.rsplit(".", 1)[0]
    src = os.path.join(root, name)
    dst = os.path.join(out, hid + ".webp")
    if name.endswith(".webp"):
        skipped += 1
        continue
    before += os.path.getsize(src)
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (11, 15, 23))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    im = im.resize((64, 64), Image.LANCZOS)
    im.save(dst, "WEBP", quality=82, method=6)
    after += os.path.getsize(dst)
    os.remove(src)
    converted += 1

print("converted", converted, "skipped", skipped)
print("before", round(before/1024), "KB -> after", round(after/1024), "KB")

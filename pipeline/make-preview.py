
from PIL import Image
src = r"C:\Users\lenovo\Documents\deepseek-harness\default-workspace\kpl2026\preview.png"
dst = r"C:\Users\lenovo\Documents\deepseek-harness\default-workspace\kpl2026\preview.webp"
im = Image.open(src).convert("RGB")
im = im.resize((1200, int(1200 * im.height / im.width)), Image.LANCZOS)
im.save(dst, "WEBP", quality=80, method=6)
import os
print("preview.webp", round(os.path.getsize(dst)/1024), "KB")

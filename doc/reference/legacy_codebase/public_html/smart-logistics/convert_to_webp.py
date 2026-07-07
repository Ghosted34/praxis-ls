from PIL import Image
import os

src = "assets/img/kaizen-smart-ls.jpg"
dest = "assets/img-webp/kaizen-smart-ls.webp"

os.makedirs("assets/img-webp", exist_ok=True)

img = Image.open(src).convert("RGBA")
img.save(dest, "WEBP", quality=90, method=6)

print("✔ Converted:", dest)

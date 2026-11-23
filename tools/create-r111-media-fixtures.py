"""Reproduce tiny valid fictional image inputs for media sanitization tests.

Run with Python + Pillow. All images are geometric colour fields, not horse
photos. Metadata contains invented sentinels solely to test removal.
"""
from pathlib import Path
import base64
import hashlib
import json
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "media-r111"
ROOT.mkdir(parents=True, exist_ok=True)
OWNER = "SYNTHETIC-OWNER-SENTINEL"
XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/">SYNTHETIC-XMP-GPS-SENTINEL</x:xmpmeta>'
exif = Image.Exif()
exif[315] = OWNER
exif[34853] = {1: "N", 2: (1.0, 2.0, 3.0), 3: "E", 4: (4.0, 5.0, 6.0)}
im = Image.new("RGB", (3, 3), (48, 101, 112))
im.putpixel((1, 1), (234, 218, 181))
im.save(ROOT / "metadata.jpg", exif=exif)
info = PngImagePlugin.PngInfo()
info.add_itxt("XML:com.adobe.xmp", XMP.decode())
info.add_text("Owner", OWNER)
im.save(ROOT / "metadata.png", pnginfo=info, exif=exif)
im.save(ROOT / "metadata.webp", exif=exif, xmp=XMP)
im.save(ROOT / "lossless-metadata.webp", lossless=True, exif=exif, xmp=XMP)
im.save(ROOT / "metadata.avif", exif=exif, xmp=XMP)
im.save(ROOT / "metadata.gif", comment=OWNER.encode())
# An application extension with well-formed sub-blocks can also carry text.
gif = (ROOT / "metadata.gif").read_bytes()
application = b"\x21\xff\x0bXMP DataXMP" + bytes([len(XMP)]) + XMP + b"\x00"
(ROOT / "metadata.gif").write_bytes(gif[:-1] + application + gif[-1:])
second = Image.new("RGB", (3, 3), (231, 186, 121))
im.save(ROOT / "animated-metadata.webp", save_all=True, append_images=[second], duration=[80, 80], loop=0, exif=exif, xmp=XMP)
im.save(ROOT / "animated-metadata.gif", save_all=True, append_images=[second], duration=[80, 80], loop=0, comment=OWNER.encode())
im.save(ROOT / "progressive-metadata.jpg", progressive=True, exif=exif)
mime_types = {".jpg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif"}
images = {}
for file in sorted(ROOT.iterdir()):
    if file.suffix not in mime_types:
        continue
    raw = file.read_bytes()
    images[file.name] = {"mime_type": mime_types[file.suffix], "sha256": hashlib.sha256(raw).hexdigest(), "base64": base64.b64encode(raw).decode("ascii")}
    file.unlink()
(ROOT / "images.json").write_text(json.dumps({"description": "Fictional 3x3 geometric images with invented EXIF/GPS/XMP sentinels. Canonical bytes for source-only test exports.", "images": images}, indent=2) + "\n")
print(f"Created {len(images)} fictional regression fixtures as source JSON in {ROOT}")

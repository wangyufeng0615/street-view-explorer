#!/usr/bin/env python3
"""Rebuild the home cover images in frontend/public/cover/<id>.webp.

Source imagery is Sentinel-2 cloudless 2016 by EOX (CC BY 4.0, attribution is
shown on the cover). Each region is a centre point plus a web-mercator zoom; the
stitched 3200x2600 mosaic gets its deep ocean (a flat fill with seams in the
source) repainted as natural navy with faint NASA Blue Marble bathymetry, then
is resized to 2048px wide and encoded with cwebp: quality 82, or aimed straight
at a 400KB budget when that would be larger. sharp_yuv keeps fine colour detail.

Usage: python3 scripts/build_cover_images.py [--cache DIR] [--out DIR] [id ...]
Needs Pillow, numpy and cwebp. Tiles and the NASA map are cached and reused;
set HTTPS_PROXY if the hosts are slow. The region list must match
frontend/src/data/coverPlaces.js. After regenerating, bump COVER_IMAGE_VERSION
in frontend/src/utils/coverGate.js: nginx caches these files for a year.
"""

import argparse
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None

TILE_URL = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
NASA_URL = (
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/"
    "world.topo.bathy.200407.3x21600x10800.jpg"
)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "cover")
MOSAIC_W, MOSAIC_H = 3200, 2600
FINAL_W, QUALITY, BUDGET = 2048, 82, 400_000
LUMA = np.array([0.299, 0.587, 0.114], np.float32)

# id, latitude, longitude, zoom
REGIONS = [
    ("namib", -24.08, 15.55, 11),
    ("bahamas", 24.33, -78.05, 11),
    ("sossusvlei", -24.73, 15.35, 12),
    ("shark_bay", -25.85, 113.7, 11),
    ("balkhash", 46.5, 75.0, 10),
    ("richat", 21.13, -11.4, 12),
    ("salt_lake", 41.15, -112.55, 11),
    ("urmia", 37.7, 45.4, 11),
    ("betsiboka", -15.85, 46.35, 12),
    ("ganges", 21.9, 89.4, 10),
    ("lut", 30.4, 59.0, 11),
    ("nasser", 22.2, 31.6, 11),
    ("dead_sea", 31.45, 35.45, 11),
    ("luxor", 25.75, 32.7, 11),
    ("eyre", -28.95, 137.3, 11),
    ("uyuni", -20.2, -67.55, 11),
    ("etosha", -18.85, 16.3, 11),
    ("manicouagan", 51.4, -68.7, 11),
    ("qinghai", 36.9, 100.15, 11),
    ("lofoten", 68.15, 13.9, 11),
    ("florida_keys", 24.75, -81.1, 11),
    ("arguin", 19.9, -16.4, 11),
    ("dakhla", 23.75, -15.85, 11),
    ("male", 4.35, 73.5, 12),
    ("wahiba", 22.05, 58.75, 11),
    ("grand_canyon", 36.2, -112.4, 11),
    ("okavango", -19.35, 22.9, 11),
    ("manaus", -3.1, -59.9, 11),
    ("natron", -2.35, 36.02, 12),
    ("lopnur", 40.45, 90.55, 11),
]


def merc_px(lat, lng, z):
    n = 256 * 2**z
    r = math.radians(lat)
    return (lng + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def px_lat(y, z):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / (256 * 2**z)))))


def px_lng(x, z):
    return x / (256 * 2**z) * 360 - 180


def blur(gray, radius):
    img = Image.fromarray((np.clip(gray, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255


def fetch_tile(cache, z, x, y):
    path = os.path.join(cache, "tiles", f"{z}_{x}_{y}.jpg")
    if not os.path.exists(path):
        for attempt in range(4):
            try:
                req = urllib.request.Request(
                    TILE_URL.format(z=z, x=x, y=y), headers={"User-Agent": "atlas-cover-build"}
                )
                data = urllib.request.urlopen(req, timeout=30).read()
                break
            except OSError:
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)
        with open(path, "wb") as f:
            f.write(data)
    return Image.open(path).convert("RGB")


def stitch(cache, lat, lng, z):
    cx, cy = merc_px(lat, lng, z)
    x0, y0 = cx - MOSAIC_W / 2, cy - MOSAIC_H / 2
    tx0, ty0 = int(x0 // 256), int(y0 // 256)
    tx1, ty1 = int((x0 + MOSAIC_W) // 256), int((y0 + MOSAIC_H) // 256)
    jobs = [(x, y) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    with ThreadPoolExecutor(6) as pool:
        for (x, y), img in zip(jobs, pool.map(lambda j: fetch_tile(cache, z, *j), jobs)):
            canvas.paste(img, ((x - tx0) * 256, (y - ty0) * 256))
    ox, oy = int(x0 - tx0 * 256), int(y0 - ty0 * 256)
    bounds = (px_lng(x0, z), px_lng(x0 + MOSAIC_W, z), px_lat(y0 + MOSAIC_H, z), px_lat(y0, z))
    return canvas.crop((ox, oy, ox + MOSAIC_W, oy + MOSAIC_H)), bounds


def nasa_colour(bm, bounds, z):
    """NASA topo-bathy colour for the box, re-projected onto the mercator rows."""
    lng0, lng1, lat0, lat1 = bounds
    bx0, bx1 = (lng0 + 180) / 360 * 21600, (lng1 + 180) / 360 * 21600
    by0, by1 = (90 - lat1) / 180 * 10800, (90 - lat0) / 180 * 10800
    crop = bm.crop((int(bx0) - 2, int(by0) - 2, int(bx1) + 3, int(by1) + 3)).convert("RGB")
    cw, ch = max(int(bx1) - int(bx0) + 5, 2), max(int(by1) - int(by0) + 5, 2)
    crop = np.asarray(crop.resize((cw, ch), Image.BICUBIC)).astype(np.float32) / 255
    _, cy0 = merc_px(lat1, lng0, z)
    cols = ((np.linspace(lng0, lng1, MOSAIC_W) + 180) / 360 * 21600 - (int(bx0) - 2)).astype(int)
    cols = np.clip(cols, 0, cw - 1)
    out = np.zeros((MOSAIC_H, MOSAIC_W, 3), np.float32)
    for i in range(MOSAIC_H):
        row = int((90 - px_lat(cy0 + i + 0.5, z)) / 180 * 10800 - (int(by0) - 2))
        out[i] = crop[min(max(row, 0), ch - 1), cols]
    return out


def polish(img, nasa, z):
    s2 = np.asarray(img).astype(np.float32) / 255
    k = 2 ** (z - 10)
    lum = s2 @ LUMA
    r, g, b = s2[..., 0], s2[..., 1], s2[..., 2]
    sat = s2.max(axis=2) - s2.min(axis=2)
    dark_water = (lum < 0.26) & (b >= r * 1.02) & (g < 0.32)
    # flat grey patches over the sea; turquoise shallows and silt plumes are more saturated
    grey_patch = (sat < 0.07) & (lum < 0.5)
    # only repaint where NASA also says open water: mountain shadows and lakes stay untouched
    nr, ng, nb = nasa[..., 0], nasa[..., 1], nasa[..., 2]
    sea = blur(blur(((nb > nr * 1.25) & (nb > ng * 1.05)).astype(np.float32), 3 * k) > 0.5, 3 * k) > 0.5
    deep = (dark_water | grey_patch).astype(np.float32) * sea
    deep = blur(blur(deep, 4 * k) > 0.5, 5 * k)
    if deep.max() > 0.05:
        nl = nasa @ LUMA
        wm = deep > 0.5
        rel = (nl - nl[wm].mean()) / (nl[wm].std() + 1e-4)
        shade = np.clip(1 + 0.12 * blur(np.clip(rel * 0.25 + 0.5, 0, 1), 2 * k) * 2 - 0.12, 0.85, 1.15)
        ocean = np.array([0.07, 0.21, 0.36], np.float32) * shade[..., None]
        s2 = s2 * (1 - deep[..., None]) + ocean * deep[..., None]
    # pale deserts and salt flats get a gentle gamma so they don't look washed out
    mean = float((s2 @ LUMA).mean())
    if mean > 0.56:
        s2 = np.power(np.clip(s2, 0, 1), 1 + (mean - 0.56) * 1.6)
    lo = s2 @ LUMA
    s2 = lo[..., None] + (s2 - lo[..., None]) * 1.06
    s2 = np.clip((s2 - 0.5) * 1.05 + 0.52, 0, 1)
    return Image.fromarray((s2 * 255 + 0.5).astype(np.uint8))


def encode(img, dst):
    img = img.resize((FINAL_W, round(img.height * FINAL_W / img.width)), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        img.save(tmp.name)
        base = ["cwebp", "-quiet", "-m", "6", "-sharp_yuv", "-metadata", "none"]
        subprocess.run(base + ["-q", str(QUALITY), tmp.name, "-o", dst], check=True)
        if os.path.getsize(dst) > BUDGET:
            subprocess.run(base + ["-size", str(BUDGET), "-pass", "6", tmp.name, "-o", dst], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache", default=os.path.expanduser("~/.cache/atlas-cover"))
    parser.add_argument("--out", default=OUT_DIR, help="output directory")
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args()
    os.makedirs(os.path.join(args.cache, "tiles"), exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    nasa_path = os.path.join(args.cache, "bmng.jpg")
    if not os.path.exists(nasa_path):
        print("downloading NASA Blue Marble ...", flush=True)
        urllib.request.urlretrieve(NASA_URL, nasa_path)
    bm = Image.open(nasa_path)
    for rid, lat, lng, z in REGIONS:
        if args.ids and rid not in args.ids:
            continue
        mosaic, bounds = stitch(args.cache, lat, lng, z)
        dst = os.path.join(args.out, f"{rid}.webp")
        encode(polish(mosaic, nasa_colour(bm, bounds, z), z), dst)
        print(f"{rid}: {os.path.getsize(dst) // 1024}KB", flush=True)


if __name__ == "__main__":
    sys.exit(main())

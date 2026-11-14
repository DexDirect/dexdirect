"""Render the paper figures used on the page from the PDF (needs poppler-utils, Pillow, numpy).

    python3 tools/build_figures.py [static/pdf/DexDirect_Humanoids_2026.pdf]

Regions are PDF points (x0, y0, x1, y1) on the page; whitespace around each render is trimmed.
"""
import glob, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

PDF = sys.argv[1] if len(sys.argv) > 1 else 'static/pdf/DexDirect_Humanoids_2026.pdf'
OUT = 'static/images'
FIGS = {  # name: (page, region, dpi, max width, webp quality)
    'teaser_setup':    (1, (313, 190, 558, 344), 600, 1800, 88),  # Fig. 1
    'system_overview': (3, (54, 50, 558, 342),   400, 2400, 88),  # Fig. 2
    'interfaces':      (4, (54, 168, 299, 281),  600, 2000, 90),  # Fig. 4
    'nasa_tlx':        (6, (54, 50, 299, 142),   600, 2000, 92),  # Fig. 5
}

def render(page, box, dpi, tmp):
    k = dpi / 72; x0, y0, x1, y1 = box
    base = os.path.join(tmp, 'r')
    subprocess.run(['pdftoppm', '-r', str(dpi), '-f', str(page), '-l', str(page), '-singlefile', '-png',
                    '-x', str(int(x0 * k)), '-y', str(int(y0 * k)), '-W', str(int((x1 - x0) * k)), '-H', str(int((y1 - y0) * k)),
                    PDF, base], check=True)
    im = Image.open(base + '.png').convert('RGB')
    ys, xs = np.where(np.asarray(im).astype(int).sum(axis=2) < 745)
    pad = int(6 * k)
    return im.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + pad), min(im.height, ys.max() + pad)))

def save(im, name, width=None, q=88):
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(f'{OUT}/{name}.webp', 'WEBP', quality=q, method=6)
    print(f'{name}.webp', im.size)

with tempfile.TemporaryDirectory() as tmp:
    for name, (page, box, dpi, width, q) in FIGS.items():
        save(render(page, box, dpi, tmp), name, width, q)
    # Fig. 6 rollout frames: the four 540x540 JPEGs embedded on page 6, in order t = 0, 5, 10, 15 s.
    subprocess.run(['pdfimages', '-f', '6', '-l', '6', '-j', PDF, os.path.join(tmp, 'p6')], check=True)
    frames = [f for f in sorted(glob.glob(os.path.join(tmp, 'p6-*.jpg'))) if Image.open(f).size == (540, 540)]
    for t, f in zip((0, 5, 10, 15), frames):
        save(Image.open(f).convert('RGB'), f'rollout_t{t:02d}', None, 85)

# Social preview: 1200x630 center crop of the hero poster.
h = Image.open(f'{OUT}/posters/hero_wide.jpg').convert('RGB')
ch = round(h.width * 630 / 1200)
y0 = (h.height - ch) // 2
h.crop((0, y0, h.width, y0 + ch)).resize((1200, 630), Image.LANCZOS).save(f'{OUT}/og.jpg', quality=86)
print('og.jpg (1200, 630)')

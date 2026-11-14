# DexDirect project page

A static project page for *DexDirect: Direct Kinesthetic Arm Guidance for Efficient Dexterous Demonstration Collection* (IEEE-RAS Humanoids 2026). The layout is a showroom style: a full-screen hero video, spec-number rows, split feature sections and a task carousel. The earlier classic layout is kept in `backup/v1-classic/`. It is plain HTML, CSS and JS with no build step, so it can go straight onto GitHub Pages or any static host.

## Preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly also works. The only exception is the 3D slot's module import, which browsers block on `file://`.

## Layout

```
index.html                 the page
static/css/style.css       styles (tokens at the top of the file)
static/js/main.js          autoplay-on-visible clips, nav highlight, BibTeX copy, chart tooltip, 3D lazy-mount
static/js/viewer3d.js      EMPTY interactive-3D slot: implement mount(el) here
static/videos/             hero, full video, method clips, user-study montage, policy rollout, tasks/*
static/images/             paper figures (WebP), posters/, og.jpg, favicon.svg
static/pdf/                the paper
tools/                     scripts that regenerate the media from the raw footage and the PDF
```

## Interactive 3D slot

`<section id="explore-3d">` sits in the middle of the page, between System Overview and Tasks. It holds an empty 16:9 box, `<div id="viewer-3d" class="viewer-3d is-empty" data-module="static/js/viewer3d.js">`. `main.js` imports that module when the box nears the viewport and calls `mount(el)`. Append a canvas or iframe, then remove `is-empty`. `viewer3d.js` includes a commented three.js + glTF example.

## Before publishing

- [x] arXiv link ([2607.27784](https://arxiv.org/abs/2607.27784)) in the nav, menu, overview buttons, footer and BibTeX.
- [ ] Add the code link. Search `TODO` in `index.html` and remove `is-soon` / `aria-disabled` from that button.
- [ ] Optionally link the author names to homepages.
- [x] `og:image` / `og:url` point at https://dexdirect.github.io/dexdirect/ (update both if the page moves to another domain).
- [ ] Replace the 3D placeholder, or delete the section.

## Where the media comes from

| File | Source |
|---|---|
| `videos/hero_wide.*`, `hero_portrait.*` | `IMG_9573.MOV` 1:32–1:52, iPhone 4K HDR (HLG) tone-mapped to SDR, cropped below the operator's face and AI-upscaled frame by frame (Real-ESRGAN `realesr-general-x4v3`, `tools/render_hero.py`). `wide` is 2560×1440; `portrait` is 1080×1920 and its crop follows the robot hand. Portrait screens (≤ 3:4) get `portrait` through `<source media>`. Each cut is AV1 (`.av1.mp4`), HEVC (`.hevc.mp4`, for Safari) and H.264 (`.mp4`) |
| `videos/dexdirect_video.mp4` | `ICHR26_0289_VI_fi.mp4` (final video), video stream copied. Its audio track is silent |
| `videos/how_left.mp4`, `how_right.mp4` | final video 16.3–22.65 s and 22.8–29.15 s |
| `videos/user_study.mp4` | final video 36.7–46.7 s, title cropped off |
| `videos/policy_rollout.mp4` | final video 46.85 s–end |
| `videos/tasks/*.mp4` | DJI user-study clips 0121–0125, workspace crop at 1×. See `tools/build_media.sh` for exact windows |
| figures | rendered from the paper PDF by `tools/build_figures.py` |

Faces: task-clip windows and crops were chosen with a face detector (OpenCV YuNet) so that people's faces stay out of frame. Both hero crops stay below y = 850 in the 4K frame; in that segment the operator's face never comes lower than y = 774. `tools/encode_clip.py` also blurs any face that still touches the crop. Fig. 1 already has the operator's face blurred in the paper.

To change a clip window or crop, edit `tools/build_media.sh` (hero crops: `tools/render_hero.py`) and rerun it:

```bash
RAW=/path/to/box/downloads YUNET=/path/to/face_detection_yunet_2023mar.onnx \
ESRGAN=/path/to/realesrgan_weights tools/build_media.sh
```

The hero step needs a CUDA GPU (about 5 minutes on an RTX 4070 Ti) and writes a few GB of lossless masters to a temporary folder (`MASTERS=` to choose it).

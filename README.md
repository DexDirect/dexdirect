# DexDirect project page

A static project page for *DexDirect: Direct Kinesthetic Arm Guidance for Efficient Dexterous Demonstration Collection* (IEEE-RAS Humanoids 2026). The layout is a showroom style: a full-screen hero video, spec-number rows, split feature sections and a task carousel. The earlier classic layout is kept in `backup/v1-classic/`. It is plain HTML, CSS and JS with no build step, so it can go straight onto GitHub Pages or any static host.

## Preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly shows everything except the simulation, which browsers refuse to run on `file://`. Use the server for that.

## Layout

```
index.html                 the page
static/css/style.css       styles (tokens at the top of the file)
static/js/main.js          autoplay-on-visible clips, nav highlight, Method scroll steps, BibTeX copy, chart tooltip, 3D lazy-mount
static/js/playground.js    the MuJoCo simulation in the 3D section (drag the arm, webcam hand, cubes)
static/sim/                MuJoCo model of the station: dexdirect.xml + meta.json (tools/sim/build_sim.py)
static/3d/                 robot.glb (+ robot.plain.glb fallback) and hand_landmarker.task (tools/build_3d.sh)
static/videos/             hero, full video, method clips, user-study montage, policy rollout, tasks/*
static/images/             paper figures (WebP), posters/, og.jpg, favicon.svg
static/pdf/                the paper
tools/                     scripts that regenerate the media from the raw footage and the PDF
```

## Simulation playground

`<section id="explore-3d">` ("Try It in Simulation"), right after the Method section, runs a MuJoCo model of the station in the browser. `main.js` imports `static/js/playground.js` when the box nears the viewport. The module shows a poster and a Start button and downloads nothing heavy before the click: the MuJoCo WebAssembly build (`@mujoco/mujoco` 4.0.1, about 2.7 MB compressed), three.js and the robot model.

- **Arm.** Drag the orange handle. A spring pulls the grabbed point toward the pointer, capped at 40 N, plus a torque that holds the wrist orientation. The PiPER arm is gravity-compensated with low joint damping and no position stiffness, as in the real drag mode, so it stays where you let go. The wheel moves the target in depth and Q / E roll the wrist. Dragging anywhere else orbits the camera.
- **Hand.** "Use my webcam" tracks one hand with MediaPipe Hand Landmarker in the browser; nothing is uploaded. The landmarks are retargeted to the 13 MIDAS actuators with the landmark mapping from `midas_hand_retargeter` (`postprocess.py`, ported to JS):
  - finger curl comes from the PIP/DIP bend, and ab/ad from the in-palm finger direction;
  - the thumb gets MCP/DIP flexion, CMC side sweep and opposition.

  The port keeps the default tuning, the per-joint low-pass filter (α = 0.25) and the neutral calibration ("Calibrate" or C). In the team's teleop this layer overrides every active joint after the dex-retargeting vector solve, so the vector solve is skipped here. On 300 random hands the JS port matches the Python code to within 2e-5 rad. The mapping uses only relative geometry, so either hand works. Without a webcam, the grip slider or the space bar closes the hand into a power grasp.
- **Scene.** A table, a tray and four 4 cm, 40 g cubes (friction 1.2). Reset restores the home keyframe.
- **Model.** `tools/sim/build_sim.py` generates `static/sim/dexdirect.xml` from:
  - the PiPER body tree in AgileX's URDF, clamped to the side of a vertical post as on the station;
  - the MIDAS hand subtree from `midas_whole_hand.xml` (contact primitives, PIP–DIP linkages, position actuators), mounted where the STEP puts it;
  - collision capsules on links 3–6.

  The integrator is implicitfast at 2 ms, and the home pose is solved so that nothing touches at start. The page draws `robot.glb` and poses it from the simulated joint angles. Geometry and colours in `robot.glb` come from the team's STEP. Its joint axes come from the URDFs, each fitted to the STEP to about 0.5 mm.
- **Rebuild.** `STEP=... tools/build_3d.sh` (scripts in `tools/3d/` and `tools/sim/`). The poster, `static/images/posters/playground.jpg`, is a screenshot of the live scene.
- **Hosting.**
  - Everything loads from the page's folder and jsdelivr. Opened straight from disk (`file://`), browsers refuse the module and its fetches, so the box asks for a local server instead.
  - The webcam needs HTTPS (GitHub Pages is fine) or localhost, and does not work inside sandboxed iframes.
  - The engine needs WebAssembly and `eval`: MuJoCo's JS bindings generate functions at load time. A host whose Content-Security-Policy forbids either gets a clear message instead of the simulation.
  - A host that only allows requests to its own origin needs a copy of the engine binary next to the model, at `static/sim/mujoco.wasm` (the same file as `@mujoco/mujoco@4.0.1/mujoco.wasm`). The page tries the CDN first, then that copy. The repo does not ship this file, because GitHub Pages does not need it.
- **Licences.**
  - MuJoCo: Apache-2.0.
  - PiPER URDF and meshes (agilexrobotics/piper_ros): MIT.
  - MIDAS hand model and retargeting (midas_hand_mujoco, midas_hand_retargeter): MIT.
  - MediaPipe Hand Landmarker model: Apache-2.0.
  - three.js: MIT.

## Method scroll section

`<section id="method">` pins a wide clip (`method.mp4`) under the nav and the Fig. 2 data-collection diagram under the clip, while three steps scroll past beside the diagram: Left hand, Right hand, Recording. `main.js` activates the step that has crossed the reading line, a little above the middle of the space under the pinned part. The active step dims the other side of the clip, shows that hand's label and moves the orange highlight box on the diagram; Recording dims nothing. The camera faces the operator, so the left hand is on the right of the frame. The dim split and label positions are `.video-dim-*` / `.video-tag-*` in `style.css`, in percent of the clip width. The highlight rectangles are the `.scrolly[data-active=...]` rules, given as percentages of `method_diagram.webp`. Below 861 px wide or 600 px tall, the clip and a diagram row stack at the top and the steps scroll beneath them. Without JS nothing pins and the steps read in order.

## Before publishing

- [x] arXiv link ([2607.27784](https://arxiv.org/abs/2607.27784)) in the nav, menu, overview buttons, footer and BibTeX.
- [ ] Add the code link. Search `TODO` in `index.html` and remove `is-soon` / `aria-disabled` from that button.
- [x] Author names link to personal pages: Beom Jun Kim, Jonathan Liu, Alvin Zhu, Mingzhang Zhu. Wrap the other names the same way once they have a page.
- [x] `og:image` / `og:url` point at https://dexdirect.github.io/dexdirect/ (update both if the page moves to another domain).
- [x] Simulation playground in the 3D section.

## Where the media comes from

| File | Source |
|---|---|
| `videos/hero_wide.*`, `hero_portrait.*` | `IMG_9573.MOV` 1:32–1:52, iPhone 4K HDR (HLG) tone-mapped to SDR, cropped below the operator's face and AI-upscaled frame by frame (Real-ESRGAN `realesr-general-x4v3`, `tools/render_hero.py`). `wide` is 2560×1440; `portrait` is 1080×1920 and its crop follows the robot hand. Portrait screens (≤ 3:4) get `portrait` through `<source media>`. Each cut is AV1 (`.av1.mp4`), HEVC (`.hevc.mp4`, for Safari) and H.264 (`.mp4`) |
| `videos/dexdirect_video.mp4` | `ICHR26_0289_VI_fi.mp4` (final video), video stream copied. Its audio track is silent |
| `videos/method.mp4` | Method scroll section: `IMG_9573.MOV` 2:17.2–2:26.0, the full width of the frame below y = 880 in 4K (the operator's face stays above y = 819 there), tone-mapped to SDR like the hero, 1920×640. The last 0.5 s dissolves into the first so the loop is seamless |
| `videos/how_left.mp4`, `how_right.mp4` | final video 16.3–22.65 s and 22.8–29.15 s, full frame. Used only by the two-row layout in `backup/v1-classic/` |
| `videos/user_study.mp4` | final video 36.7–46.7 s, title cropped off |
| `videos/policy_rollout.mp4` | final video 46.85 s–end |
| `videos/tasks/*.mp4` | DJI user-study clips 0121–0125, workspace crop at 1×. See `tools/build_media.sh` for exact windows |
| figures | rendered from the paper PDF by `tools/build_figures.py`. `method_diagram.webp` is the "Data Collection" panel of Fig. 2 |

Faces: task-clip windows and crops were chosen with a face detector (OpenCV YuNet) so that people's faces stay out of frame. Both hero crops stay below y = 850 in the 4K frame; in that segment the operator's face never comes lower than y = 774. `tools/encode_clip.py` also blurs any face that still touches the crop. Fig. 1 already has the operator's face blurred in the paper.

To change a clip window or crop, edit `tools/build_media.sh` (hero crops: `tools/render_hero.py`) and rerun it:

```bash
RAW=/path/to/box/downloads YUNET=/path/to/face_detection_yunet_2023mar.onnx \
ESRGAN=/path/to/realesrgan_weights tools/build_media.sh
```

The hero step needs a CUDA GPU (about 5 minutes on an RTX 4070 Ti) and writes a few GB of lossless masters to a temporary folder (`MASTERS=` to choose it).

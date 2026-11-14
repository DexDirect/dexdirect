#!/usr/bin/env bash
# Rebuild every video and poster under static/ from the raw footage in the shared Box folder.
#
#   RAW=/path/to/box/downloads YUNET=/path/to/face_detection_yunet_2023mar.onnx \
#   ESRGAN=/path/to/realesrgan_weights tools/build_media.sh
#
# Needs: an ffmpeg build with libx264, libx265, libsvtav1 and zscale (zimg); python3 with opencv-python>=4.8
# and numpy; for the hero, torch with a CUDA GPU.
# YuNet model: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
# Real-ESRGAN weights (realesr-general-x4v3.pth + realesr-general-wdn-x4v3.pth):
#   https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=${RAW:?set RAW to the folder holding the Box downloads}
YUNET=${YUNET:?set YUNET to face_detection_yunet_2023mar.onnx}
ESRGAN=${ESRGAN:?set ESRGAN to the folder holding the Real-ESRGAN weights}
FF=${FFMPEG:-ffmpeg}
V=static/videos; P=static/images/posters
FINAL="$RAW/ICHR26_0289_VI_fi.mp4"
mkdir -p "$V/tasks" "$P"
X264=(-c:v libx264 -preset slow -profile:v high -g 60 -movflags +faststart -an)

# Hero: iPhone HDR (HLG) clip, 1:32-1:52. tools/render_hero.py tone-maps it, crops below the operator's face
# (y >= 850), AI-upscales every frame and writes two lossless masters: a 2560x1440 cut for landscape screens and
# a 1080x1920 cut for portrait screens that follows the robot hand. Each is then encoded as AV1, HEVC (for
# Safari) and H.264 (fallback); index.html lists them in that order.
MASTERS=${MASTERS:-$(mktemp -d)}
python3 tools/render_hero.py --src "$RAW/IMG_9573.MOV" --weights "$ESRGAN" --out "$MASTERS" --ffmpeg "$FF"
# hqdn3d (temporal only) steadies the fine detail the upscaler adds to static background between frames.
TO709="zscale=matrix=709:range=limited:filter=spline36,format=yuv420p,hqdn3d=0:0:4:4"
TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +faststart -an)
hero() {  # cut av1-crf hevc-crf h264-crf
  # The masters are MKV, which rounds timestamps to 1 ms; -r on the input gives the encodes exact 29.97 fps timing.
  local in=(-r 30000/1001 -i "$MASTERS/hero_$1_master.mkv")
  "$FF" -y -loglevel error "${in[@]}" -vf "$TO709" -c:v libsvtav1 -preset 4 -crf "$2" -g 120 -svtav1-params tune=0 \
    "${TAGS[@]}" "$V/hero_$1.av1.mp4"
  "$FF" -y -loglevel error "${in[@]}" -vf "$TO709" -c:v libx265 -preset slow -crf "$3" -tag:v hvc1 \
    -x265-params keyint=120:min-keyint=60:log-level=error "${TAGS[@]}" "$V/hero_$1.hevc.mp4"
  "$FF" -y -loglevel error "${in[@]}" -vf "$TO709" -c:v libx264 -preset slow -crf "$4" -profile:v high -g 120 \
    "${TAGS[@]}" "$V/hero_$1.mp4"
}
hero wide     40 29 27     # ~8.4 / 8.6 / 9.9 MB, VMAF 92-94 against the master
hero portrait 40 28 27     # ~5.1 / 6.4 / 6.4 MB

# Segments of the final supplementary video (its audio track is silent, so it is dropped).
"$FF" -y -loglevel error -i "$FINAL" -map 0:v:0 -c:v copy -an -movflags +faststart "$V/dexdirect_video.mp4"
"$FF" -y -loglevel error -ss 16.3  -t 6.35  -i "$FINAL" -vf "scale=1280:720:flags=lanczos" -crf 24 "${X264[@]}" "$V/how_left.mp4"
"$FF" -y -loglevel error -ss 22.8  -t 6.35  -i "$FINAL" -vf "scale=1280:720:flags=lanczos" -crf 24 "${X264[@]}" "$V/how_right.mp4"
"$FF" -y -loglevel error -ss 36.7  -t 10    -i "$FINAL" -vf "crop=1840:700:40:160,scale=1280:488:flags=lanczos,setsar=1" -crf 25 "${X264[@]}" "$V/user_study.mp4"
"$FF" -y -loglevel error -ss 46.85 -t 24.75 -i "$FINAL" -vf "scale=1280:720:flags=lanczos" -crf 25 "${X264[@]}" "$V/policy_rollout.mp4"

# Task clips: workspace crop of the DJI study footage, 640x480. Any face YuNet finds touching the
# crop is blurred (safety net), and the windows were picked so that faces stay out of frame.
task() {  # file start duration "x y w h" name
  # shellcheck disable=SC2086
  python3 tools/encode_clip.py "$FF" "$YUNET" "$RAW/$1" "$2" "$3" $4 640 480 "$V/tasks/$5.mp4" 28
}
task DJI_20260708164913_0124_D.MP4  6     20    "930 660 480 360"  jenga
task DJI_20260708165809_0125_D.MP4  28    20    "900 640 480 360"  usb
task DJI_20260708163719_0121_D.MP4  18.5  17.5  "958 618 544 408"  lazy_susan
task DJI_20260708164051_0122_D.MP4  75.5  16    "920 620 600 450"  whiteboard
task DJI_20260708164442_0123_D.MP4  88    20    "870 630 560 420"  keyboard

# Posters (first frame shown before a clip loads).
poster() { "$FF" -y -loglevel error -ss "$2" -i "$1" -frames:v 1 ${4:+-vf "$4"} -q:v 4 "$3"; }
poster "$V/hero_wide.mp4"      0   "$P/hero_wide.jpg" "scale=1920:1080:flags=lanczos"
poster "$V/hero_portrait.mp4"  0   "$P/hero_portrait.jpg"
poster "$V/dexdirect_video.mp4" 8  "$P/dexdirect_video.jpg"
poster "$V/how_left.mp4"       0.5 "$P/how_left.jpg"
poster "$V/how_right.mp4"      0.5 "$P/how_right.jpg"
poster "$V/user_study.mp4"     1   "$P/user_study.jpg"
poster "$V/policy_rollout.mp4" 3   "$P/policy_rollout.jpg"
for n in jenga usb lazy_susan whiteboard keyboard; do poster "$V/tasks/$n.mp4" 0.4 "$P/task_$n.jpg"; done
echo "done"

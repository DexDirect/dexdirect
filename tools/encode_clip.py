# Crop a 1080p clip segment, blur any detected face that intrudes into the crop, encode H.264 for web.
# usage: encode_clip.py FF MODEL SRC T0 DUR X Y W H OUTW OUTH OUT [CRF]
import sys, subprocess, json
import numpy as np, cv2
FF, MODEL, SRC = sys.argv[1:4]
T0, DUR = float(sys.argv[4]), float(sys.argv[5])
X, Y, W, H, OW, OH = map(int, sys.argv[6:12]); OUT = sys.argv[12]; CRF = sys.argv[13] if len(sys.argv) > 13 else '27'
assert W % 2 == 0 and H % 2 == 0, 'crop dims must be even'
FW, FH = 1920, 1080; DW, DH = 960, 544; sx, sy = FW / DW, FH / DH
det = cv2.FaceDetectorYN.create(MODEL, '', (DW, DH), 0.55, 0.3, 5000)
# pass 1: detect on full frames (downscaled), keep boxes that touch the crop (in crop coords)
p = subprocess.Popen([FF, '-hide_banner', '-loglevel', 'error', '-ss', str(T0), '-t', str(DUR), '-i', SRC,
                      '-vf', f'scale={DW}:{DH}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
boxes = []
while True:
    b = p.stdout.read(DW * DH * 3)
    if len(b) < DW * DH * 3: break
    _, faces = det.detect(np.frombuffer(b, np.uint8).reshape(DH, DW, 3))
    fb = []
    if faces is not None:
        for f in faces:
            x, y, w, h, s = f[0]*sx, f[1]*sy, f[2]*sx, f[3]*sy, float(f[-1])
            if w < 36: continue
            # expand box generously (hair/chin)
            cx, cy = x + w/2, y + h/2
            # trigger only if the (slightly padded) raw face box overlaps the crop
            tw, th = w*1.25, h*1.3
            if cx + tw/2 <= X or cy + th/2 <= Y or cx - tw/2 >= X + W or cy - th/2 >= Y + H: continue
            w2, h2 = w*1.7, h*1.9
            bx0, by0, bx1, by1 = cx - w2/2 - X, cy - h2/2 - Y, cx + w2/2 - X, cy + h2/2 - Y
            fb.append([max(0, int(bx0)), max(0, int(by0)), min(W, int(bx1)), min(H, int(by1)), round(s, 2)])
    boxes.append(fb)
p.wait()
n = len(boxes); HOLD = 8
dil = [[bb for j in range(max(0, i-HOLD), min(n, i+HOLD+1)) for bb in boxes[j]] for i in range(n)]
hits = [i for i in range(n) if boxes[i]]
# pass 2: crop, blur, encode
dec = subprocess.Popen([FF, '-hide_banner', '-loglevel', 'error', '-ss', str(T0), '-t', str(DUR), '-i', SRC,
                        '-vf', f'crop={W}:{H}:{X}:{Y}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen([FF, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
                        '-s', f'{W}x{H}', '-r', '30000/1001', '-i', '-',
                        '-vf', f'scale={OW}:{OH}:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow',
                        '-crf', CRF, '-profile:v', 'high', '-g', '60', '-movflags', '+faststart', '-an', OUT], stdin=subprocess.PIPE)
i = 0
while True:
    b = dec.stdout.read(W * H * 3)
    if len(b) < W * H * 3: break
    fr = np.frombuffer(b, np.uint8).reshape(H, W, 3).copy()
    for (x0, y0, x1, y1, s) in (dil[i] if i < n else []):
        if x1 - x0 < 4 or y1 - y0 < 4: continue
        roi = fr[y0:y1, x0:x1]
        small = cv2.resize(roi, (max(1, (x1-x0)//14), max(1, (y1-y0)//14)), interpolation=cv2.INTER_AREA)
        fr[y0:y1, x0:x1] = cv2.GaussianBlur(cv2.resize(small, (x1-x0, y1-y0), interpolation=cv2.INTER_NEAREST), (0, 0), 6)
    enc.stdin.write(fr.tobytes()); i += 1
enc.stdin.close(); enc.wait(); dec.wait()
print(json.dumps({'out': OUT.split('/')[-1], 'frames': i, 'face_hit_frames': len(hits), 'first_hits': hits[:12]}))

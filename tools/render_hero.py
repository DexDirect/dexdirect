#!/usr/bin/env python3
"""Render the hero loops from the iPhone HDR clip into lossless masters.

Steps: tone-map HLG -> SDR, crop below the operator's face, AI-upscale each frame with Real-ESRGAN
(realesr-general-x4v3, denoise 0.5), then downscale to the delivery size. The web encodes are made from
the masters by tools/build_media.sh.

  python3 tools/render_hero.py --src RAW/IMG_9573.MOV --weights DIR --out DIR [--ffmpeg ffmpeg] [--only wide|portrait]

DIR holds realesr-general-x4v3.pth and realesr-general-wdn-x4v3.pth from
https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0 . Needs torch (CUDA GPU) and numpy.
"""
import argparse, queue, subprocess, threading
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

T0, DUR, FPS = 92.0, 20.0, '30000/1001'
TM = ('zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,'
      'tonemap=tonemap=mobius:param=0.3:desat=0,zscale=t=bt709,format=gbrp,format=rgb24')
M = 16      # context margin decoded around each crop for the upscaler, trimmed afterwards
DENOISE = 0.5


def smoothstep(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def portrait_center(t):
    """Horizontal centre (4K px) of the phone crop: holds on the arm and handle, then eases right as the
    hand moves out over the Jenga tower (5.5-9.5 s) and stays there while it picks a block."""
    return 2705 + 135 * smoothstep((t - 5.5) / 4.0)


# Every crop stays at y >= 850 in 4K coordinates: the operator's face never comes lower than y = 774
# in this segment (YuNet scan), so both loops are face-free without blurring.
VARIANTS = {
    'wide': dict(region=(1031 - M, 850 - M, 2328 + 2 * M, 1310 + M),      # x, y, w, h decoded from 4K
                 win=(2328, 1310), x0=lambda t: M, y0=M, out=(2560, 1440)),
    'portrait': dict(region=(2300, 850 - M, 960, 1310 + M),
                     win=(736, 1310), x0=lambda t: portrait_center(t) - 368 - 2300, y0=M, out=(1080, 1920)),
}


class SRVGGNetCompact(nn.Module):
    """Real-ESRGAN realesr-general-x4v3 architecture."""

    def __init__(self, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        body = [nn.Conv2d(3, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        for _ in range(num_conv):
            body += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        body.append(nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1))
        self.body = nn.ModuleList(body)
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for m in self.body:
            out = m(out)
        return self.upsampler(out) + F.interpolate(x, scale_factor=self.upscale, mode='nearest')


def load_net(weights_dir):
    def sd(name):
        d = torch.load(f'{weights_dir}/{name}', map_location='cpu', weights_only=True)
        return d.get('params_ema', d.get('params', d))
    a, b = sd('realesr-general-x4v3.pth'), sd('realesr-general-wdn-x4v3.pth')
    net = SRVGGNetCompact()
    # Real-ESRGAN's denoise-strength interpolation between the plain and the weak-denoise weights.
    net.load_state_dict({k: DENOISE * a[k] + (1 - DENOISE) * b[k] for k in a}, strict=True)
    return net.eval().half().cuda()


def render(name, args, net):
    v = VARIANTS[name]
    rx, ry, rw, rh = v['region']
    ow, oh = v['out']
    ww, wh = v['win']
    dec = subprocess.Popen(
        [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-ss', str(T0), '-t', str(DUR), '-i', args.src,
         '-vf', f'crop={rw}:{rh}:{rx}:{ry},{TM}', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    # Lossless RGB master. MKV stores timestamps in ms; build_media.sh reads it with `-r 30000/1001` before `-i`
    # for exact 29.97 fps timing. (When comparing frames against it, re-time both sides on a 1/30000 timebase.)
    out_path = f'{args.out}/hero_{name}_master.mkv'
    enc = subprocess.Popen(
        [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
         '-s', f'{ow}x{oh}', '-r', FPS, '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp',
         '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'rgb', out_path],
        stdin=subprocess.PIPE)

    frame_bytes = rw * rh * 3
    q_in, q_out = queue.Queue(maxsize=6), queue.Queue(maxsize=6)

    def reader():
        while True:
            buf = dec.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                q_in.put(None)
                return
            q_in.put(buf)

    def writer():
        while True:
            b = q_out.get()
            if b is None:
                enc.stdin.close()
                return
            enc.stdin.write(b)

    threading.Thread(target=reader, daemon=True).start()
    wt = threading.Thread(target=writer, daemon=True)
    wt.start()
    i = 0
    with torch.no_grad():
        while True:
            buf = q_in.get()
            if buf is None:
                break
            t = i / (30000 / 1001)
            x = torch.frombuffer(bytearray(buf), dtype=torch.uint8).view(rh, rw, 3).cuda()
            x = x.permute(2, 0, 1)[None].half().div_(255)
            y = net(x)                                             # 4x
            x0 = int(round(v['x0'](t) * 4))                         # quarter-pixel crop position
            y0 = v['y0'] * 4
            y = y[:, :, y0:y0 + wh * 4, x0:x0 + ww * 4]
            y = F.interpolate(y.float(), size=(oh, ow), mode='bicubic', antialias=True, align_corners=False)
            img = y.clamp_(0, 1).mul_(255).round_().byte()[0].permute(1, 2, 0).contiguous().cpu().numpy()
            q_out.put(img.tobytes())
            i += 1
            if i % 100 == 0:
                print(f'{name}: {i} frames', flush=True)
    q_out.put(None)
    wt.join()
    dec.wait()
    enc.wait()
    print(f'{name}: {i} frames -> {out_path}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--weights', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--ffmpeg', default='ffmpeg')
    ap.add_argument('--only', choices=list(VARIANTS))
    args = ap.parse_args()
    net = load_net(args.weights)
    for name in ([args.only] if args.only else VARIANTS):
        render(name, args, net)


if __name__ == '__main__':
    main()

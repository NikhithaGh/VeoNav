import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
const input = resolve(process.argv[2] || 'demo-output/panoramax-njnyDW/segment-1');
const output = resolve('public/v2-pune');
const route = JSON.parse(await readFile(join(output, 'route.json'), 'utf8'));
const credits = JSON.parse(await readFile(join(output, 'credits.json'), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'pune-forward-'));
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.error || r.status) throw new Error(r.error?.message || r.stderr);
}
try {
  for (let i = 0; i < credits.length; i++) {
    const name = String(i).padStart(3, '0');
    const road = join(scratch, 'road.png');
    ffmpeg(['-i', join(input, 'images', `${name}.jpg`), '-vf', `v360=input=equirect:output=flat:yaw=${credits[i].yaw}:h_fov=85:v_fov=55:w=640:h=360`, '-frames:v', '1', road]);
    const footer = await sharp(join(input, 'frames', `${name}.png`)).extract({ left: 0, top: 360, width: 640, height: 72 }).png().toBuffer();
    await sharp(road).extend({ bottom: 72, background: '#101827' }).composite([{ input: footer, top: 360, left: 0 }]).png().toFile(join(scratch, `${name}.png`));
  }
  ffmpeg(['-framerate', '5/8', '-i', join(scratch, '%03d.png'), '-vf', 'framerate=fps=30:interp_start=0:interp_end=255:scene=100', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'forward.mp4')]);
  route.forward = { src: '/v2-pune/forward.mp4', secondsPerFrame: 1.6, lastFrameSeconds: (credits.length - 1) * 1.6 };
  await writeFile(join(output, 'route.json'), JSON.stringify(route, null, 2));
  await writeFile(join(output, 'credits.json'), JSON.stringify(credits.map(c => ({ ...c, modifications: 'Route-relative +90 degree calibrated perspective, resized and attributed; forward-only temporal frame blending (no loop reset).' })), null, 2));
  console.log('Prepared forward-only Pune video');
} finally { await rm(scratch, { recursive: true, force: true }); }

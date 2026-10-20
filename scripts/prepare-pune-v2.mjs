import { readFile, mkdir, writeFile, copyFile, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { distance } from './panoramax-demo.mjs';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-pune-v2.mjs <generated segment directory>');
const input = resolve(source);
const output = resolve('public/v2-pune');
const credits = JSON.parse(await readFile(join(input, 'credits.json'), 'utf8'));
if (credits.length < 8) throw new Error('At least eight credited frames are required');
for (let i = 0; i < credits.length; i++) await access(join(input, 'frames', `${String(i).padStart(3, '0')}.png`));
await mkdir(output, { recursive: true });
let meters = 0;
const points = credits.map((frame, i) => {
  if (i) meters += distance(credits[i - 1].coordinates, frame.coordinates);
  return { coordinates: frame.coordinates, meters, capturedAt: frame.capturedAt };
});
const scratch = await mkdtemp(join(tmpdir(), 'veonav-eased-'));
const clips = [];
try {
for (let start = 0; start < credits.length - 1; start += 5) {
  const count = Math.min(8, credits.length - start);
  const file = `smooth-${String(start).padStart(2, '0')}`;
  const inputs = [];
  for (let j = 0; j < count; j++) {
    const frame = join(scratch, `${j}.png`);
    const yaw = ((credits[start + j].yaw + 90 + 540) % 360) - 180;
    const road = join(scratch, 'road.png');
    const projection = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', join(input, 'images', `${String(start + j).padStart(3, '0')}.jpg`),
      '-vf', `v360=input=equirect:output=flat:yaw=${yaw}:h_fov=85:v_fov=55:w=640:h=360`,
      '-frames:v', '1', road], { encoding: 'utf8' });
    if (projection.error || projection.status !== 0) throw new Error(projection.error?.message || projection.stderr);
    const footer = await sharp(join(input, 'frames', `${String(start + j).padStart(3, '0')}.png`)).extract({ left: 0, top: 360, width: 640, height: 72 }).png().toBuffer();
    await sharp(road).extend({ bottom: 72, background: '#101827' }).composite([{ input: footer, top: 360, left: 0 }]).png().toFile(frame);
    inputs.push('-loop', '1', '-framerate', '30', '-t', '2.4', '-i', frame);
  }
  inputs.push('-loop', '1', '-framerate', '30', '-t', '2.4', '-i', join(scratch, '0.png'));
  const filters = [];
  for (let j = 1; j <= count; j++) {
    const left = j === 1 ? '[0:v]' : `[v${j - 1}]`;
    filters.push(`${left}[${j}:v]xfade=transition=custom:duration=0.8:offset=${(j * 1.6).toFixed(1)}:expr='A*(P*P*(3-2*P))+B*(1-P*P*(3-2*P))'[v${j}]`);
  }
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputs,
    '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', `[v${count}]`,
    '-t', String(count * 1.6 + 0.8), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(output, `${file}.mp4`)], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
  await copyFile(join(scratch, '0.png'), join(output, `${file}.png`));
  clips.push({ id: file, startMeters: points[start].meters, endMeters: points[start + count - 1].meters,
    durationSeconds: count * 1.6 + 0.8, src: `/v2-pune/${file}.mp4`, poster: `/v2-pune/${file}.png` });
}
} finally { await rm(scratch, { recursive: true, force: true }); }
await writeFile(join(output, 'credits.json'), JSON.stringify(credits.map(credit => ({ ...credit,
  yaw: ((credit.yaw + 90 + 540) % 360) - 180, cameraOffsetDegrees: 90,
  modifications: 'Route-relative perspective crop with user-confirmed +90 degree camera calibration; 85 degree horizontal field of view; resize; attribution; eased crossfades and loop reset',
})), null, 2));
await writeFile(join(output, 'route.json'), JSON.stringify({
  id: 'pune-panoramax-v2', title: 'Pune · recorded street preview', distanceMeters: meters,
  captureDate: credits[0].capturedAt.slice(0, 10), creator: credits[0].creator,
  license: credits[0].license, licenseUrl: credits[0].licenseUrl,
  points, clips, lookAheadMeters: 40, speedMetersPerSecond: 4, cameraOffsetDegrees: 90,
  disclaimer: 'Historical recorded track. Not a verified driving route; no live GPS or turn/flyover guidance.',
}, null, 2));
console.log(`Prepared ${clips.length} look-ahead clips and ${Math.round(meters)} m of track in ${output}`);

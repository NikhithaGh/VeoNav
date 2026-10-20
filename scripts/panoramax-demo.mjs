import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const API = 'https://api.panoramax.xyz/api';
export const REGIONS = [
  { name: 'Mumbai', bbox: [72.77, 18.88, 73.05, 19.30] },
  { name: 'Hyderabad', bbox: [78.25, 17.20, 78.65, 17.60] },
  { name: 'Pune', bbox: [73.7, 18.4, 74.05, 18.7] },
];
const LICENSES = new Set(['etalab-2.0', 'CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0']);
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
export function distance(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function bearing(a, b) {
  const r = Math.PI / 180, d = (b[0] - a[0]) * r;
  return (Math.atan2(Math.sin(d) * Math.cos(b[1] * r), Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos(d)) / r + 360) % 360;
}
export function usable(item) {
  const p = item?.properties;
  const c = item?.geometry?.coordinates;
  return !!(p && item.collection && Array.isArray(c) && c.length >= 2 && c.slice(0, 2).every(Number.isFinite)
    && p['pers:interior_orientation']?.field_of_view === 360
    && Number.isFinite(p['view:azimuth']) && LICENSES.has(p.license)
    && p['geovisio:producer'] && item.assets?.sd?.href);
}
export function continuous(a, b) {
  const gap = distance(a.geometry.coordinates, b.geometry.coordinates);
  const seconds = (Date.parse(b.properties.datetime) - Date.parse(a.properties.datetime)) / 1000;
  return usable(b) && a.collection === b.collection && a.id !== b.id
    && b.properties['geovisio:rank_in_collection'] === a.properties['geovisio:rank_in_collection'] + 1
    && gap >= 0.5 && gap <= 40 && seconds >= 0 && seconds <= 30;
}
export function options(args) {
  const result = { count: 5, frames: 16, output: 'demo-output', indiaOnly: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--india-only') result.indiaOnly = true;
    else if (key === '--help') result.help = true;
    else if (['--count', '--frames', '--output', '--region'].includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      result[key.slice(2)] = ['--output', '--region'].includes(key) ? value : Number(value);
    } else throw new Error(`Unknown option: ${key}`);
  }
  if (!Number.isInteger(result.count) || result.count < 1 || result.count > 5) throw new Error('Count must be 1–5');
  if (!Number.isInteger(result.frames) || result.frames < 4 || result.frames > 40) throw new Error('Frames must be 4–40');
  if (result.region && !REGIONS.some(r => r.name.toLowerCase() === result.region.toLowerCase())) throw new Error('Region must be Mumbai, Hyderabad, or Pune');
  return result;
}
async function request(url, image = false) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS provider URLs are accepted');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'VeoNav-Panoramax-Demo/1.0' } });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  if (image) {
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Expected an image response');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 20_000_000) throw new Error('Image exceeds 20 MB limit');
    return bytes;
  }
  return response.json();
}
function encode(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (result.error) throw new Error('FFmpeg is required on PATH; install it before running the demo');
  if (result.status !== 0) throw new Error(`FFmpeg failed: ${result.stderr.slice(-2000)}`);
}
async function sequence(seed, frames) {
  const items = [seed];
  while (items.length < frames) {
    const href = items.at(-1).links?.find(l => l.rel === 'next')?.href;
    if (!href) break;
    const next = await request(href);
    if (!continuous(items.at(-1), next) || items.some(i => i.id === next.id)) break;
    items.push(next);
  }
  return items;
}
async function render(items, folder, label, sharp) {
  await mkdir(join(folder, 'images'), { recursive: true });
  await mkdir(join(folder, 'frames'));
  const scratch = await mkdtemp(join(tmpdir(), 'veonav-render-'));
  const metadata = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i], p = item.properties;
      const name = String(i).padStart(3, '0');
      const image = join(folder, 'images', `${name}.jpg`);
      await writeFile(image, await request(item.assets.sd.href, true));
      const dimensions = await sharp(image).metadata();
      if (Math.abs(dimensions.width / dimensions.height - 2) > 0.1) throw new Error('Expected a 2:1 equirectangular panorama');
      const heading = i < items.length - 1 ? bearing(item.geometry.coordinates, items[i + 1].geometry.coordinates)
        : bearing(items[i - 1].geometry.coordinates, item.geometry.coordinates);
      const yaw = ((heading - p['view:azimuth'] + 540) % 360) - 180;
      const projected = join(scratch, 'view.png');
      encode(['-i', image, '-vf', `v360=input=equirect:output=flat:yaw=${yaw}:h_fov=100:v_fov=65:w=640:h=360`, '-frames:v', '1', projected]);
      const credit = `${p['geovisio:producer']} | ${p.license} | ${String(p.datetime).slice(0, 10)}`;
      const svg = `<svg width="640" height="72"><rect width="640" height="72" fill="#101827"/><g fill="white" font-family="sans-serif" font-size="13"><text x="12" y="20">${escapeXml(label)} · HISTORICAL DEMO — NOT DRIVING GUIDANCE</text><text x="12" y="42">Panoramax · ${escapeXml(credit)}</text><text x="12" y="62">Perspective crop / animated sequence · Full sources in credits.json</text></g></svg>`;
      await sharp(projected).extend({ bottom: 72, background: '#101827' }).composite([{ input: Buffer.from(svg), top: 360, left: 0 }]).png().toFile(join(folder, 'frames', `${name}.png`));
      metadata.push({ id: item.id, collection: item.collection, coordinates: item.geometry.coordinates, heading, yaw,
        capturedAt: p.datetime, creator: p['geovisio:producer'], license: p.license,
        licenseUrl: item.links?.find(l => l.rel === 'license')?.href,
        source: item.links?.find(l => l.rel === 'self')?.href, asset: item.assets.sd.href,
        modifications: 'Perspective crop, resize, attribution footer; sequenced into animation' });
    }
    const input = join(folder, 'frames', '%03d.png');
    encode(['-framerate', '3', '-i', input, '-filter_complex', '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', join(folder, 'preview.gif')]);
    encode(['-framerate', '3', '-i', input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(folder, 'preview.mp4')]);
    await writeFile(join(folder, 'credits.json'), JSON.stringify(metadata, null, 2));
    await writeFile(join(folder, 'route.geojson'), JSON.stringify({ type: 'Feature', properties: { label, verifiedRoadRoute: false }, geometry: { type: 'LineString', coordinates: items.map(i => i.geometry.coordinates) } }, null, 2));
    return metadata;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
export async function main(args = process.argv.slice(2)) {
  const config = options(args);
  if (config.help) { console.log('npm run demo:panoramax -- [--count 1..5] [--frames 4..40] [--output demo-output] [--region Pune] [--india-only]'); return; }
  encode(['-version']);
  const { default: sharp } = await import('sharp');
  const root = resolve(config.output);
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, 'panoramax-'));
  const report = { createdAt: new Date().toISOString(), config, coverage: [], previews: [], errors: [] };
  const used = new Set(), starts = [];
  try {
    for (const region of REGIONS.filter(r => !config.region || r.name.toLowerCase() === config.region.toLowerCase())) {
      if (report.previews.length >= config.count) break;
      console.log(`Checking ${region.name}…`);
      let seeds;
      try {
        const url = new URL(`${API}/search`);
        url.search = new URLSearchParams({ bbox: region.bbox.join(','), limit: '100', filter: 'field_of_view = 360' });
        const data = await request(url);
        if (!Array.isArray(data.features)) throw new Error('Invalid search response');
        seeds = data.features.filter(usable).sort((a, b) => String(a.collection).localeCompare(String(b.collection))
          || a.properties['geovisio:rank_in_collection'] - b.properties['geovisio:rank_in_collection']);
        report.coverage.push({ region: region.name, bbox: region.bbox, returned: data.features.length, usable: seeds.length, searchLimit: 100 });
      } catch (error) { report.errors.push({ region: region.name, error: error.message }); continue; }
      let attempts = 0;
      for (const seed of seeds) {
        if (report.previews.length >= config.count || attempts >= 12) break;
        if (used.has(seed.id) || starts.some(c => distance(c, seed.geometry.coordinates) < 250)) continue;
        attempts++;
        const folderName = `segment-${report.previews.length + 1}`;
        const folder = join(output, folderName);
        try {
          const items = await sequence(seed, config.frames);
          if (items.length < config.frames || items.some(i => used.has(i.id))) continue;
          const length = items.slice(1).reduce((sum, item, i) => sum + distance(items[i].geometry.coordinates, item.geometry.coordinates), 0);
          if (length < 30) continue;
          console.log(`Rendering ${folderName}: ${region.name}, ${items.length} frames, ${Math.round(length)} m`);
          await render(items, folder, `${region.name} / ${folderName}`, sharp);
          report.previews.push({ folder: folderName, region: region.name, frames: items.length, distanceMeters: Math.round(length), collection: seed.collection });
          items.forEach(item => used.add(item.id)); starts.push(seed.geometry.coordinates);
        } catch (error) {
          report.errors.push({ region: region.name, seed: seed.id, error: error.message });
          await rm(folder, { recursive: true, force: true });
        }
      }
    }
  } finally {
    await writeFile(join(output, 'manifest.json'), JSON.stringify(report, null, 2));
    const cards = report.previews.map(p => `<section><h2>${escapeXml(p.region)} / ${p.folder}</h2><p>${p.frames} frames · ${p.distanceMeters} m</p><video controls loop muted playsinline width="640" src="${p.folder}/preview.mp4"></video><p><a href="${p.folder}/preview.gif">GIF</a> · <a href="${p.folder}/credits.json">Sources and licenses</a> · <a href="${p.folder}/route.geojson">Recorded track</a></p></section>`).join('\n');
    await writeFile(join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VeoNav — Panoramax demos</title><style>body{font:16px system-ui;background:#101827;color:white;max-width:900px;margin:40px auto;padding:16px}a{color:#75dcff}video{max-width:100%}section{margin:40px 0}</style><h1>VeoNav: recorded street previews</h1><p>Historical imagery, perspective-cropped and animated. These are recorded segments, not verified driving routes or turn/flyover instructions. No GPS trigger or routing integration is included. Preserve credits and applicable licenses when sharing.</p>${cards}<p><a href="manifest.json">Coverage and run report</a></p></html>`);
  }
  console.log(`Created ${report.previews.length}/${config.count} previews: ${output}`);
  if (report.previews.length < config.count) throw new Error(`Insufficient usable sequences; see ${join(output, 'manifest.json')}`);
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

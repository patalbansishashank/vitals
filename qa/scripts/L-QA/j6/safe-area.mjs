// Max distance of ink/yellow pixels from the centre, as a fraction of the icon size, for the maskable icons (safe zone: <= 0.40).
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
for (const f of ['public/icons/icon-192-maskable.png', 'public/icons/icon-512-maskable.png', 'apps/android/brand/playstore-512.png']) {
  const { data, info } = await sharp(ROOT + f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bgR = data[0], bg = [data[0], data[1], data[2]];
  let max = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > 60) { const r = Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) / info.width; if (r > max) max = r; }
  }
  console.log(f, `${info.width}x${info.height}`, 'ground', bg.join(','), 'farthest content radius / size =', max.toFixed(3), max <= 0.4 ? 'inside safe zone' : 'OUTSIDE 0.40 safe zone');
}

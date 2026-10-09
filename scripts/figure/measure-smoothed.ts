// Measures smoothed target deltas (from scripts/figure/blender/smooth_targets.py) with the bake's own residual, next
// to the unsmoothed target. Run: node scripts/figure/measure-smoothed.ts <diagnose>-source.json <blender-out.json>
import { readFileSync } from 'node:fs';
import { affineResidual, distribution, oneRing, twoRing } from './lib/smoothness.ts';

const source = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { positions: number[]; triangles: number[]; targets: Record<string, number[]> };
const smoothed = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as { blender: string; results: Record<string, Record<string, number[]>> };
const n = source.positions.length / 3;
const rings = twoRing(oneRing(source.triangles, n));
console.log(`Blender ${smoothed.blender}`);
for (const [id, methods] of Object.entries(smoothed.results)) {
  const raw = source.targets[id]!;
  const before = distribution(affineResidual(source.positions, raw, rings), 0.3);
  console.log(`${id}: before mean=${before.mean.toFixed(4)} p99=${before.p99.toFixed(3)} max=${before.max.toFixed(3)} >3mm=${before.over}`);
  for (const [name, d] of Object.entries(methods)) {
    const after = distribution(affineResidual(source.positions, d, rings), 0.3);
    let moved = 0, sum = 0;
    for (let v = 0; v < n; v++) { const m = Math.hypot(d[3 * v]! - raw[3 * v]!, d[3 * v + 1]! - raw[3 * v + 1]!, d[3 * v + 2]! - raw[3 * v + 2]!); moved = Math.max(moved, m); sum += m; }
    console.log(`   ${name.padEnd(36)} mean=${after.mean.toFixed(4)} p99=${after.p99.toFixed(3)} max=${after.max.toFixed(3)} >3mm=${String(after.over).padStart(5)} moved max=${moved.toFixed(3)} mean=${(sum / n).toFixed(4)}`);
  }
}

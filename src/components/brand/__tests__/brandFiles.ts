// Readers for the committed brand files (written by design/brand/vitals-mark.py): a small XML parser, an Android
// vector-drawable → SVG converter, .ico / .icns decoders and pixel helpers. Test-only; nothing here generates assets.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const ROOT = path.resolve(__dirname, '../../../..');
export const at = (rel: string) => path.join(ROOT, rel);
export const read = (rel: string) => readFileSync(at(rel), 'utf8');

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

/** Parses the subset of XML the resources use (declaration, comments, elements, attributes). Throws if malformed. */
export function parseXml(src: string): XmlNode {
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  const doc: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [doc];
  for (const t of src.matchAll(re)) {
    const [, close, open, attrSrc, selfClose, text, stray] = t;
    if (stray) throw new Error(`malformed XML near offset ${t.index}`);
    if (text !== undefined) {
      if (stack.length === 1 && text.trim()) throw new Error('text outside the root element');
      stack.at(-1)!.text += text.trim();
      continue;
    }
    if (close) {
      const top = stack.pop();
      if (!top || top.name !== close) throw new Error(`</${close}> closes <${top?.name}>`);
      continue;
    }
    if (!open) continue;
    const attrs: Record<string, string> = {};
    for (const [, k, v] of (attrSrc ?? '').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
      if (k! in attrs) throw new Error(`duplicate attribute ${k}`);
      attrs[k!] = v!;
    }
    const node: XmlNode = { name: open, attrs, children: [], text: '' };
    stack.at(-1)!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack.at(-1)!.name}>`);
  if (doc.children.length !== 1) throw new Error('expected one root element');
  return doc.children[0]!;
}

export const A = (n: XmlNode, k: string) => n.attrs[`android:${k}`];
export const all = (n: XmlNode): XmlNode[] => [n, ...n.children.flatMap(all)];
export const find = (n: XmlNode, name: string, attr?: [string, string]) =>
  all(n).filter((c) => c.name === name && (!attr || A(c, attr[0]) === attr[1]));

/** name → colour from a values XML. */
export const readColours = (xml: string) =>
  Object.fromEntries(
    parseXml(xml)
      .children.filter((n) => n.name === 'color')
      .map((n) => [n.attrs.name!, n.text]),
  );

function paint(value: string | undefined, colours: Record<string, string>) {
  if (!value) return null;
  let v = value;
  if (v.startsWith('@color/')) {
    const c = colours[v.slice(7)];
    if (!c) throw new Error(`unknown colour ${value}`);
    v = c;
  }
  const hex = v.replace('#', '');
  if (hex.length === 8) {
    const alpha = parseInt(hex.slice(0, 2), 16) / 255;
    return alpha === 0 ? null : { colour: `#${hex.slice(2)}`, alpha };
  }
  if (hex.length === 6) return { colour: `#${hex}`, alpha: 1 };
  throw new Error(`unsupported colour ${value}`);
}

const num = (n: XmlNode, k: string, d: number) => (A(n, k) === undefined ? d : Number(A(n, k)));

/** Android's group matrix: translate(-pivot), scale, translate(translate + pivot). */
const groupTransform = (g: XmlNode) => {
  const [px, py] = [num(g, 'pivotX', 0), num(g, 'pivotY', 0)];
  return `translate(${num(g, 'translateX', 0) + px} ${num(g, 'translateY', 0) + py}) scale(${num(g, 'scaleX', 1)} ${num(g, 'scaleY', 1)}) translate(${-px} ${-py})`;
};

/** A vector drawable as a standalone SVG in its own viewport (groups' scale 0, e.g. the splash dot, stays hidden). */
export function vectorToSvg(xml: string, colours: Record<string, string> = {}) {
  const root = parseXml(xml);
  if (root.name !== 'vector') throw new Error(`expected <vector>, got <${root.name}>`);
  const walk = (n: XmlNode): string => {
    if (n.name === 'group') return `<g transform="${groupTransform(n)}">${n.children.map(walk).join('')}</g>`;
    if (n.name !== 'path') throw new Error(`unsupported element <${n.name}>`);
    const fill = paint(A(n, 'fillColor'), colours);
    const stroke = paint(A(n, 'strokeColor'), colours);
    const attrs = [`d="${A(n, 'pathData')}"`, `fill="${fill ? fill.colour : 'none'}"`];
    if (fill && fill.alpha < 1) attrs.push(`fill-opacity="${fill.alpha}"`);
    if (stroke && num(n, 'strokeWidth', 0) > 0) {
      attrs.push(`stroke="${stroke.colour}"`, `stroke-width="${num(n, 'strokeWidth', 0)}"`);
      const a = stroke.alpha * num(n, 'strokeAlpha', 1);
      if (a < 1) attrs.push(`stroke-opacity="${a}"`);
      attrs.push(`stroke-linecap="${A(n, 'strokeLineCap') ?? 'butt'}"`);
    }
    return `<path ${attrs.join(' ')}/>`;
  };
  const w = num(root, 'viewportWidth', 108);
  const h = num(root, 'viewportHeight', 108);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${root.children.map(walk).join('')}</svg>`;
}

/** Common launcher masks (AOSP shape paths on a 100 box), placed on the visible 72 dp of the 108 dp layers. */
export const LAUNCHER_MASKS: Record<string, string> = {
  circle: 'M50,0 A50,50 0,1 1,50,100 A50,50 0,1 1,50,0 Z',
  squircle: 'M50,0 C10,0 0,10 0,50 C0,90 10,100 50,100 C90,100 100,90 100,50 C100,10 90,0 50,0 Z',
  'rounded-square': 'M50,0 L92,0 C96.42,0 100,3.58 100,8 L100,92 C100,96.42 96.42,100 92,100 L8,100 C3.58,100 0,96.42 0,92 L0,8 C0,3.58 3.58,0 8,0 Z',
  teardrop: 'M50,0 A50,50 0,0 1 100,50 L100,85 A15,15 0,0 1 85,100 L50,100 A50,50 0,0 1 0,50 A50,50 0,0 1 50,0 Z',
};
export const maskSvg = (name: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><path transform="translate(18 18) scale(0.72)" d="${LAUNCHER_MASKS[name]}"/></svg>`;

export type Raw = { data: Buffer; size: number };

/** RGBA pixels of an image file or buffer (square). */
export async function raw(input: string | Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== info.height) throw new Error('not square');
  return { data, size: info.width };
}

/** RGBA pixels of an SVG string rasterised at size × size. */
export async function rasterise(svg: string, size: number): Promise<Raw> {
  const box = Number(svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/)?.[1] ?? size);
  return raw(await sharp(Buffer.from(svg), { density: (72 * size) / box }).resize(size, size).png().toBuffer());
}

export const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.size + x) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!, r.data[i + 3]!] as const;
};
export const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const dist = (a: readonly number[], b: readonly number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i]! - b[i]!)));
export const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** The images inside a .ico: width, height (0 → 256) and the PNG bytes. */
export function decodeIco(buf: Buffer) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an .ico');
  return Array.from({ length: buf.readUInt16LE(4) }, (_, i) => {
    const e = 6 + 16 * i;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    return { width: buf[e] || 256, height: buf[e + 1] || 256, data: buf.subarray(offset, offset + size) };
  });
}

/** The blocks inside an .icns: four-character type and the PNG bytes. */
export function decodeIcns(buf: Buffer) {
  if (buf.toString('latin1', 0, 4) !== 'icns' || buf.readUInt32BE(4) !== buf.length) throw new Error('not an .icns');
  const out: { type: string; data: Buffer }[] = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o + 4);
    out.push({ type: buf.toString('latin1', o, o + 4), data: buf.subarray(o + 8, o + len) });
    o += len;
  }
  return out;
}

export const ICNS_TYPES: Record<string, number> = { icp4: 16, icp5: 32, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };

/** Point at `r` from the design-space centre along `deg`, mapped into an icon whose outer edge sits at frac × size. */
export const onIcon = (size: number, frac: number, r: number, deg: number, outer = 9.95) => {
  const k = (frac * size) / outer;
  const a = (deg * Math.PI) / 180;
  return [Math.floor(size / 2 + r * k * Math.cos(a)), Math.floor(size / 2 + r * k * Math.sin(a))] as const;
};

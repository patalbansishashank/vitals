/**
 * Patient-details stripping (docs/SUITE_SPEC.md §13.5.6). Pure (the canvas helper only draws on a context it is given).
 *
 * Before anything from a report reaches an AI provider, every line that matches the patient-block patterns (name,
 * age/sex, patient id / UHID / lab no / registration, referred by, phone, address, barcode / sample id / accession,
 * collected at / collection centre, email, Aadhaar / passport / PAN-like numbers) is removed from text, and the page
 * header region plus any known boxes of such lines are filled in images. Only the sample date is kept (returned
 * separately, for the person to confirm).
 *
 *   redactText(text)                    → { text, sampleDate, removed }
 *   isPatientLine(line)                 → boolean
 *   patientBoxes(lines)                 → Box[] (lines with known positions: the matched lines and their wrapped tails)
 *   maskImage(image, opts)              → a masked copy of an RGBA image (header band of `headerFraction`, default 0.22)
 *   maskCanvas(ctx, width, height, opts) → fills the same regions on a 2D canvas context
 */
import type { LocalDate } from '@/store';

/** One line of the patient block is enough to drop the line. Case-insensitive unless the pattern needs capitals. */
export const PATIENT_LINE_PATTERNS: readonly RegExp[] = [
  // name
  /\bpatient'?s?\s*name\b|\bname\s+of\s+(the\s+)?patient\b|^\s*name\b|\bname\s*[:-]/i,
  /\b(Mr|Mrs|Ms|Miss|Master|Baby|Smt|Shri|Sri|Kum|Mx)\.?\s+[A-Z][A-Za-z]+/,
  // age / sex / date of birth
  /\b(age|sex|gender)\b\s*(\/\s*(sex|gender)\b)?\s*[:-]/i,
  /\b\d{1,3}\s*(y|yr|yrs|years?)\s*\/?\s*(\d{1,2}\s*m(onths?)?\s*\/?\s*)?(m|f|male|female|o|other)\b/i,
  /\bdob\b|\bdate\s+of\s+birth\b/i,
  // ids
  /\b(patient\s*id|pid|uhid|mrn|mr\s*no|ip\s*no|op\s*no|uid|lab\s*(no|id|code)|labcode|reg(istration)?\.?\s*(no|id|number)|visit\s*(no|id)|bill\s*no|order\s*(no|id)|cr\s*no|episode\s*(no|id)|ref(erence)?\s*(no|id)|customer\s*id|client\s*(id|code|name))\b/i,
  // referred by / doctor
  /\b(ref(erred)?\.?\s*(by|dr|doctor|physician)|referring\s*(doctor|physician|dr|clinician)|consultant|clinician)\b/i,
  /\bDr\.?\s+[A-Z][A-Za-z]+/,
  // phone
  /\b(phone|mobile|mob|contact|tel|telephone|cell|whatsapp)\b\.?\s*(no\.?|number)?\s*[:-]/i,
  /(\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/,
  /\+\d{1,3}[\s-]?\d{2,5}[\s-]?\d{3,5}[\s-]?\d{0,5}/,
  /\b0\d{2,4}[\s-]\d{3,4}[\s-]?\d{4}\b/,
  // address
  /\b(address|addr|pin\s*code|pincode)\b/i,
  // barcode / sample id / accession
  /\b(bar\s*code|sample\s*(id|no|number)|specimen\s*(id|no|number)|accession|acc\.?\s*no|sid|vial\s*id|tube\s*id|srf\s*id)\b/i,
  // collected at / collection centre / location
  /\b(collect(ed|ion)\s*(at|centre|center|point|location|from|by)|centre|center|branch|location|processed\s*at|hospital\s*name|ward|opd|bed\s*no)\b/i,
  // email
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  // Aadhaar (12 digits in groups of 4), Indian passport, PAN
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  /\b(aadhaar|aadhar|passport|pan\s*no)\b/i,
  /\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/,
  /\b[A-Z]{5}\d{4}[A-Z]\b/,
];

/** A wrapped tail of an address or a collection-centre line is dropped with it (it matches nothing on its own). */
const WRAPPING =
  /\b(address|addr|collect(ed|ion)\s*(at|centre|center|point|location)|centre|center|location|ward)\b/i;

export const isPatientLine = (line: string): boolean => PATIENT_LINE_PATTERNS.some((re) => re.test(line));

/* ------------------------------------------------------------------------------------------- dates */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

function iso(y: number, m: number, d: number): LocalDate | undefined {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The first date in a string: 2026-09-14, 14/09/2026, 14-09-26, 14 Sep 2026, 14/Sep/2026, Sep 14, 2026 (day first). */
export function parseDate(s: string): LocalDate | undefined {
  const pats: Array<[RegExp, (m: RegExpExecArray) => LocalDate | undefined]> = [
    [/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => iso(+m[1]!, +m[2]!, +m[3]!)],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, (m) => iso(+m[3]!, +m[2]!, +m[1]!)],
    [
      /\b(\d{1,2})(?:st|nd|rd|th)?[-/.\s]*([A-Za-z]{3,9})\.?[-/.,\s]*(\d{4}|\d{2})\b/,
      (m) => {
        const mo = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3)];
        return mo ? iso(+m[3]!, mo, +m[1]!) : undefined;
      },
    ],
    [
      /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/,
      (m) => {
        const mo = MONTHS[m[1]!.toLowerCase().slice(0, 3)];
        return mo ? iso(+m[3]!, mo, +m[2]!) : undefined;
      },
    ],
  ];
  let best: { at: number; date: LocalDate } | null = null;
  for (const [re, f] of pats) {
    const m = re.exec(s);
    if (!m) continue;
    const date = f(m);
    if (date && (!best || m.index < best.at)) best = { at: m.index, date };
  }
  return best?.date;
}

/** Date labels, best first: collection, then registration, receipt, report. */
const DATE_LABELS: ReadonlyArray<{ rank: number; re: RegExp }> = [
  {
    rank: 0,
    re: /\b(sample\s+)?(collected|collection|drawn|sampling|specimen\s+date)\b(\s*(on|date|time|date\s*\/\s*time|date\s*&\s*time|dt))?/gi,
  },
  { rank: 1, re: /\b(registered|registration|booked|booking)\b(\s*(on|date|time))?/gi },
  { rank: 2, re: /\b(received|receiving|accessioned)\b(\s*(on|date|time))?/gi },
  {
    rank: 3,
    re: /\b(reported|report\s*(date|released|generated|printed)|released|authori[sz]ed|printed|validated)\b(\s*(on|date|time))?/gi,
  },
];

const ANY_LABEL =
  /\b(sample\s+)?(collected|collection|drawn|registered|registration|booked|booking|received|reported|report|released|authori[sz]ed|printed|validated)\b/gi;

/**
 * The sample date from the report's lines: the date after "Sample Collected on", "Collected", "Collection Date" wins
 * over "Registered", "Received" and "Reported". `undefined` when no labelled date is found (the person types it).
 */
export function findSampleDate(lines: readonly string[]): LocalDate | undefined {
  let best: { rank: number; date: LocalDate } | null = null;
  for (const line of lines) {
    const starts = [...line.matchAll(ANY_LABEL)].map((m) => m.index);
    for (const { rank, re } of DATE_LABELS) {
      if (best && best.rank <= rank) break;
      for (const m of line.matchAll(re)) {
        const from = m.index + m[0].length;
        const next = starts.find((s) => s >= from);
        const date = parseDate(line.slice(from, next ?? line.length).slice(0, 40));
        if (date && (!best || rank < best.rank)) best = { rank, date };
      }
    }
  }
  return best?.date;
}

/* ------------------------------------------------------------------------------------------- text */

export interface RedactedText {
  text: string;
  /** The sample date found before the lines were removed (to be confirmed by the person). */
  sampleDate?: LocalDate;
  /** How many lines were removed. */
  removed: number;
}

/** Remove every patient-block line (and the wrapped tail of an address line) from `text`; keep the sample date apart. */
export function redactText(text: string): RedactedText {
  const lines = text.split(/\r?\n/);
  const sampleDate = findSampleDate(lines);
  const keep: string[] = [];
  let removed = 0;
  let tail = false;
  for (const line of lines) {
    const hit = isPatientLine(line);
    // a short line without a label right after an address line is its wrapped tail
    const isTail =
      tail &&
      !hit &&
      line.trim() !== '' &&
      !/[:]/.test(line) &&
      line.trim().length <= 60 &&
      !/\d+(\.\d+)?\s*(mg|g|u|iu|mmol|µ|ng|pg|%)/i.test(line);
    if (hit || isTail) {
      removed++;
      tail = hit ? WRAPPING.test(line) : false;
      continue;
    }
    tail = false;
    keep.push(line);
  }
  return { text: keep.join('\n'), sampleDate, removed };
}

/* ------------------------------------------------------------------------------------------- images */

/** A box in image or page coordinates, origin top-left. */
export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A line with its position (layout.ts `Line` fits). */
export interface PositionedLine {
  page: number;
  text: string;
  box: Box;
}

/** Boxes of the patient-block lines, each with its wrapped tail (the next line on the page, when it is close below). */
export function patientBoxes(lines: readonly PositionedLine[]): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!isPatientLine(l.text)) continue;
    out.push(l.box);
    const next = lines[i + 1];
    if (
      next &&
      next.page === l.page &&
      WRAPPING.test(l.text) &&
      !isPatientLine(next.text) &&
      next.box.y - (l.box.y + l.box.h) < l.box.h * 1.2
    )
      out.push(next.box);
  }
  return out;
}

/** RGBA pixels (ImageData-like). */
export interface ImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface MaskOptions {
  /** Fraction of the height from the top filled as the page header (default 0.22; 0 to skip). */
  headerFraction?: number;
  /** Extra boxes to fill, in pixels of this image (`page` is ignored). */
  boxes?: readonly Box[];
  /** Pixels added around each box (default 4). */
  padding?: number;
  /** Fill grey level, 0–255 (default 255, white). */
  fill?: number;
}

export const DEFAULT_HEADER_FRACTION = 0.22;

function regions(width: number, height: number, opts: MaskOptions): Array<[number, number, number, number]> {
  const pad = opts.padding ?? 4;
  const header = Math.ceil(height * Math.min(1, Math.max(0, opts.headerFraction ?? DEFAULT_HEADER_FRACTION)));
  const out: Array<[number, number, number, number]> = [];
  if (header > 0) out.push([0, 0, width, header]);
  for (const b of opts.boxes ?? []) {
    const x0 = Math.max(0, Math.floor(b.x - pad));
    const y0 = Math.max(0, Math.floor(b.y - pad));
    const x1 = Math.min(width, Math.ceil(b.x + b.w + pad));
    const y1 = Math.min(height, Math.ceil(b.y + b.h + pad));
    if (x1 > x0 && y1 > y0) out.push([x0, y0, x1 - x0, y1 - y0]);
  }
  return out;
}

/** A masked copy of an RGBA image: the header band and every box filled with an opaque flat colour. */
export function maskImage(img: ImageLike, opts: MaskOptions = {}): ImageLike {
  const data = new Uint8ClampedArray(img.data);
  const fill = opts.fill ?? 255;
  for (const [x, y, w, h] of regions(img.width, img.height, opts)) {
    for (let r = y; r < y + h; r++) {
      let i = (r * img.width + x) * 4;
      for (let c = 0; c < w; c++, i += 4) {
        data[i] = fill;
        data[i + 1] = fill;
        data[i + 2] = fill;
        data[i + 3] = 255;
      }
    }
  }
  return { width: img.width, height: img.height, data };
}

/** The minimum a 2D canvas context needs here (CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D both fit). */
export interface FillContext {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Fill the same regions as `maskImage` on a canvas. */
export function maskCanvas(ctx: FillContext, width: number, height: number, opts: MaskOptions = {}): void {
  const f = opts.fill ?? 255;
  ctx.fillStyle = `rgb(${f},${f},${f})`;
  for (const [x, y, w, h] of regions(width, height, opts)) ctx.fillRect(x, y, w, h);
}

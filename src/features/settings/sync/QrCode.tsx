import { useMemo } from 'react';
import { encode } from 'uqr';

/** One SVG path of the dark modules (no innerHTML, no data: URL). */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return { size, d };
}

/** QR code for a pairing URI, dark on a white quiet zone in every theme so phone cameras read it. */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={className} data-testid="pairing-qr">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

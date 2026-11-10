'use client';

import { useMemo } from 'react';
import { encodeQr } from './qr';

/** A QR code as inline SVG (dark modules on white, 4-module quiet zone, as scanners expect). */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { path, dim } = useMemo(() => {
    const matrix = encodeQr(value);
    const quiet = 4;
    let d = '';
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      });
    });
    return { path: d, dim: matrix.length + quiet * 2 };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', borderRadius: 8 }}
    >
      <rect width={dim} height={dim} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

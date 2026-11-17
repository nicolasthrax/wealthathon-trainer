'use client';
import { useEffect, useRef } from 'react';

/** Canvas sparkline: cheap to redraw on every tick. */
export function Sparkline({ data, from, to, width = 56, height = 14 }: { data: Float64Array; from: number; to: number; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== width * dpr) { c.width = width * dpr; c.height = height * dpr; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const n = to - from;
    if (n < 2) return;
    const step = Math.max(1, Math.floor(n / width));
    let lo = Infinity, hi = -Infinity;
    for (let i = from; i <= to; i += step) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
    lo = Math.min(lo, data[to]); hi = Math.max(hi, data[to]);
    const span = hi - lo || 1;
    g.beginPath();
    for (let i = from, k = 0; i <= to; i += step, k++) {
      const x = ((i - from) / n) * (width - 1), y = height - 1 - ((data[i] - lo) / span) * (height - 2);
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.lineTo(width - 1, height - 1 - ((data[to] - lo) / span) * (height - 2));
    g.strokeStyle = data[to] >= data[from] ? '#2bd685' : '#ff5c74';
    g.lineWidth = 1;
    g.stroke();
  }, [data, from, to, width, height]);
  return <canvas ref={ref} className="spark" style={{ width, height }} />;
}

import { useMemo } from "react";

export interface CandlePoint {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Overlays {
  ema50?: (number | null)[];
  ema200?: (number | null)[];
  bbUpper?: (number | null)[];
  bbLower?: (number | null)[];
  bbMiddle?: (number | null)[];
}

interface Props {
  data: CandlePoint[];
  overlays?: Overlays;
  chartHeight?: number;
}

const W = 1000;
const MARGIN = { top: 8, right: 68, bottom: 28, left: 4 };

function buildLinePath(xs: number[], ys: (number | null)[]): string {
  const parts: string[] = [];
  let inSegment = false;
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] === null) { inSegment = false; continue; }
    parts.push(`${inSegment ? "L" : "M"} ${xs[i].toFixed(1)},${(ys[i] as number).toFixed(1)}`);
    inSegment = true;
  }
  return parts.join(" ");
}

export function CandlestickChart({ data, overlays = {}, chartHeight = 380 }: Props) {
  const H = chartHeight;
  const cW = W - MARGIN.left - MARGIN.right;
  const cH = H - MARGIN.top - MARGIN.bottom;

  const { priceMin, priceMax, xs, toY, yTicks } = useMemo(() => {
    const allPrices: number[] = [];
    data.forEach((d) => { allPrices.push(d.high, d.low); });
    (overlays.ema50 ?? []).forEach((v) => { if (v !== null) allPrices.push(v); });
    (overlays.ema200 ?? []).forEach((v) => { if (v !== null) allPrices.push(v); });
    (overlays.bbUpper ?? []).forEach((v) => { if (v !== null) allPrices.push(v); });
    (overlays.bbLower ?? []).forEach((v) => { if (v !== null) allPrices.push(v); });

    const raw_min = Math.min(...allPrices);
    const raw_max = Math.max(...allPrices);
    const pad = (raw_max - raw_min) * 0.04;
    const pMin = raw_min - pad;
    const pMax = raw_max + pad;
    const range = pMax - pMin || 1;

    const toY = (p: number) => MARGIN.top + cH - ((p - pMin) / range) * cH;
    const xs = data.map((_, i) => MARGIN.left + (data.length <= 1 ? cW / 2 : (i / (data.length - 1)) * cW));

    const TICK_COUNT = 6;
    const yTicks = Array.from({ length: TICK_COUNT }, (_, i) => pMin + (range / (TICK_COUNT - 1)) * i);

    return { priceMin: pMin, priceMax: pMax, xs, toY, yTicks };
  }, [data, overlays, cH, cW]);

  const candleWidth = Math.max(1.5, Math.min(12, (cW / data.length) * 0.65));

  const xTickEvery = Math.max(1, Math.floor(data.length / 8));

  const bbPath = useMemo(() => {
    const upper = overlays.bbUpper;
    const lower = overlays.bbLower;
    if (!upper || !lower) return "";
    const topPoints: string[] = [];
    const botPoints: string[] = [];
    for (let i = 0; i < data.length; i++) {
      if (upper[i] !== null && lower[i] !== null) {
        topPoints.push(`${xs[i].toFixed(1)},${toY(upper[i] as number).toFixed(1)}`);
        botPoints.push(`${xs[i].toFixed(1)},${toY(lower[i] as number).toFixed(1)}`);
      }
    }
    if (topPoints.length < 2) return "";
    return `M ${topPoints.join(" L ")} L ${botPoints.reverse().join(" L ")} Z`;
  }, [data, overlays.bbUpper, overlays.bbLower, xs, toY]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-full"
      style={{ height: H, display: "block" }}
    >
      {/* Horizontal grid */}
      {yTicks.map((v) => (
        <line
          key={v}
          x1={MARGIN.left}
          y1={toY(v)}
          x2={W - MARGIN.right}
          y2={toY(v)}
          stroke="oklch(1 0 0 / 0.05)"
          strokeWidth={1}
        />
      ))}

      {/* Bollinger fill */}
      {bbPath && (
        <path d={bbPath} fill="oklch(0.7 0.04 255 / 0.07)" stroke="none" />
      )}

      {/* Bollinger bands */}
      {overlays.bbUpper && (
        <path
          d={buildLinePath(xs, overlays.bbUpper)}
          fill="none"
          stroke="oklch(0.7 0.04 255 / 0.55)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      )}
      {overlays.bbLower && (
        <path
          d={buildLinePath(xs, overlays.bbLower)}
          fill="none"
          stroke="oklch(0.7 0.04 255 / 0.55)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      )}
      {overlays.bbMiddle && (
        <path
          d={buildLinePath(xs, overlays.bbMiddle)}
          fill="none"
          stroke="oklch(0.7 0.04 255 / 0.3)"
          strokeWidth={1}
        />
      )}

      {/* EMA 200 */}
      {overlays.ema200 && (
        <path
          d={buildLinePath(xs, overlays.ema200)}
          fill="none"
          stroke="var(--brand-violet)"
          strokeWidth={1.4}
        />
      )}

      {/* EMA 50 */}
      {overlays.ema50 && (
        <path
          d={buildLinePath(xs, overlays.ema50)}
          fill="none"
          stroke="var(--brand-amber)"
          strokeWidth={1.4}
        />
      )}

      {/* Candles */}
      {data.map((d, i) => {
        const x = xs[i];
        const isUp = d.close >= d.open;
        const color = isUp ? "var(--bull)" : "var(--bear)";
        const bodyTop = toY(Math.max(d.open, d.close));
        const bodyBot = toY(Math.min(d.open, d.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);

        return (
          <g key={d.t}>
            <line
              x1={x}
              y1={toY(d.high)}
              x2={x}
              y2={toY(d.low)}
              stroke={color}
              strokeWidth={1}
              opacity={0.9}
            />
            <rect
              x={x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyH}
              fill={color}
              opacity={0.85}
            />
          </g>
        );
      })}

      {/* Y-axis labels */}
      {yTicks.map((v) => (
        <text
          key={v}
          x={W - MARGIN.right + 5}
          y={toY(v) + 4}
          fontSize={10}
          fill="oklch(0.7 0.03 255 / 0.7)"
        >
          {v > 1000 ? v.toFixed(0) : v > 10 ? v.toFixed(2) : v.toFixed(4)}
        </text>
      ))}

      {/* X-axis labels */}
      {data.map((d, i) => {
        if (i % xTickEvery !== 0 && i !== data.length - 1) return null;
        return (
          <text
            key={d.t}
            x={xs[i]}
            y={H - 6}
            fontSize={10}
            fill="oklch(0.7 0.03 255 / 0.7)"
            textAnchor="middle"
          >
            {new Date(d.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </text>
        );
      })}

      {/* Legend */}
      {overlays.ema50 && (
        <g>
          <rect x={MARGIN.left + 4} y={MARGIN.top + 4} width={18} height={2} fill="oklch(0.83 0.17 85)" rx={1} />
          <text x={MARGIN.left + 26} y={MARGIN.top + 11} fontSize={9} fill="oklch(0.7 0.03 255 / 0.7)">EMA50</text>
        </g>
      )}
      {overlays.ema200 && (
        <g>
          <rect x={MARGIN.left + 70} y={MARGIN.top + 4} width={18} height={2} fill="var(--brand-violet)" rx={1} />
          <text x={MARGIN.left + 92} y={MARGIN.top + 11} fontSize={9} fill="oklch(0.7 0.03 255 / 0.7)">EMA200</text>
        </g>
      )}
    </svg>
  );
}

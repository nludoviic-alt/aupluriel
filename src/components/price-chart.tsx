import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function PriceChart({
  data,
  color = "var(--brand-cyan)",
}: {
  data: { t: number; price: number }[];
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          stroke="oklch(0.7 0.03 255 / 0.5)"
          fontSize={11}
          minTickGap={40}
        />
        <YAxis
          dataKey="price"
          domain={["auto", "auto"]}
          stroke="oklch(0.7 0.03 255 / 0.5)"
          fontSize={11}
          width={70}
          tickFormatter={(v: number) => v.toFixed(2)}
        />
        <Tooltip
          contentStyle={{
            background: "oklch(0.20 0.035 260)",
            border: "1px solid oklch(1 0 0 / 0.08)",
            borderRadius: 10,
            fontSize: 12,
          }}
          labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
          formatter={(v: number) => [v.toFixed(4), "Prix"]}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke={color}
          strokeWidth={2}
          fill="url(#priceFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
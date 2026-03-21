"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts"

interface WeeklyRevenueChartProps {
  data: { week: string; revenue: number }[]
}

function formatGBP(pence: number) {
  return `\u00A3${(pence / 100).toFixed(0)}`
}

export function WeeklyRevenueChart({ data }: WeeklyRevenueChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-[0.82rem] text-warm-grey">
        No revenue data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8DCC8" vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 11, fill: "#8A8070" }}
          tickLine={false}
          axisLine={{ stroke: "#E8DCC8" }}
        />
        <YAxis
          tickFormatter={(v) => formatGBP(Number(v))}
          tick={{ fontSize: 11, fill: "#8A8070" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value) => [formatGBP(Number(value)), "Revenue"]}
          contentStyle={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E8DCC8",
            borderRadius: "8px",
            fontSize: "13px",
            color: "#473728",
          }}
        />
        <Bar dataKey="revenue" fill="#C4A95A" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

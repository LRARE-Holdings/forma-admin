"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"

interface RevenueByClassProps {
  data: { className: string; revenue: number }[]
}

const CHART_COLORS = [
  "#C4A95A", // gold
  "#D4713A", // ember
  "#5A8F4A", // success
  "#473728", // cocoa
  "#E8936A", // blush
  "#8A8070", // warm grey
]

function formatGBP(pence: number) {
  return `\u00A3${(pence / 100).toFixed(0)}`
}

export function RevenueByClass({ data }: RevenueByClassProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[0.82rem] text-warm-grey">
        No class revenue data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 48)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
      >
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatGBP(v)}
          tick={{ fontSize: 11, fill: "#8A8070" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="className"
          tick={{ fontSize: 12, fill: "#473728" }}
          tickLine={false}
          axisLine={false}
          width={120}
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
        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { SeriesPoint } from "@/lib/analytics/dashboard";

const config = {
  registrations: { label: "Registrations", color: "var(--chart-1)" },
  bookings: { label: "Bookings", color: "var(--chart-2)" },
} satisfies ChartConfig;

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", ...opts }).format(new Date(`${iso}T12:00:00Z`));

export function RegistrationsChart({ data }: { data: SeriesPoint[] }) {
  const empty = data.every((d) => d.registrations === 0 && d.bookings === 0);
  return (
    <div className="relative">
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            {(["registrations", "bookings"] as const).map((k) => (
              <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.35} />
                <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.03} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={28}
            tickFormatter={(v: string) => fmtDay(v, { day: "numeric", month: "short" })}
          />
          <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} domain={[0, (max: number) => Math.max(4, max)]} />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={<ChartTooltipContent indicator="line" labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtDay(p[0].payload.date, { weekday: "short", day: "numeric", month: "short" }) : "")} />}
          />
          <Area dataKey="registrations" type="monotone" stroke="var(--color-registrations)" strokeWidth={2} fill="url(#fill-registrations)" />
          <Area dataKey="bookings" type="monotone" stroke="var(--color-bookings)" strokeWidth={2} fill="url(#fill-bookings)" />
          <ChartLegend content={<ChartLegendContent />} />
        </AreaChart>
      </ChartContainer>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-10">
          <span className="rounded-full border bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">No registrations or bookings in this period</span>
        </div>
      )}
    </div>
  );
}

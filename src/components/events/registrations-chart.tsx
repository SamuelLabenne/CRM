"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = { total: { label: "Total registrations", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Cumulative registrations per day. `label` is pre-formatted on the server. */
export function RegistrationsChart({ data }: { data: { label: string; count: number; total: number }[] }) {
  return (
    <ChartContainer config={config} className="h-48 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="regFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area dataKey="total" type="monotone" stroke="var(--color-total)" strokeWidth={2} fill="url(#regFill)" />
      </AreaChart>
    </ChartContainer>
  );
}

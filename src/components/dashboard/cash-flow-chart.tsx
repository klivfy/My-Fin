"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatDateShort } from "@/lib/format";
import type { DailyBalancePoint } from "@/lib/queries/dashboard";

export function CashFlowChart({ data }: { data: DailyBalancePoint[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-sm font-medium text-on-surface">Saldo acumulado no período (R$)</CardTitle>
        <p className="flex items-center gap-4 text-xs text-on-surface-variant">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-primary" aria-hidden />
            Realizado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-on-surface-variant" aria-hidden />
            Projetado
          </span>
        </p>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDateShort(value)}
              tick={{ fontSize: 11, fill: "var(--color-on-surface-variant)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-outline-variant)" }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(value: number) => formatBRL(value)}
              tick={{ fontSize: 11, fill: "var(--color-on-surface-variant)" }}
              width={90}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value) => formatBRL(Number(value))}
              labelFormatter={(label) => formatDateShort(String(label))}
              contentStyle={{
                background: "var(--color-surface-container-high)",
                border: "1px solid var(--color-outline-variant)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke="var(--color-on-surface-variant)"
              strokeDasharray="4 4"
              strokeWidth={2}
              dot={false}
              name="Projetado"
            />
            <Line
              type="monotone"
              dataKey="realized"
              stroke="var(--color-primary)"
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
              name="Realizado"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

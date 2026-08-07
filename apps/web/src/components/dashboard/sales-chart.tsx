"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function SalesChart({
  data = [],
}: {
  data?: Array<{ hour: string; revenue: number; orders: number }>;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] w-full items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 text-center">
        <div>
          <p className="text-sm font-semibold">Henüz satış verisi yok</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tamamlanan siparişler oluştuğunda saatlik satış grafiği burada görünecek.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -16, right: 8, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="dixora-sales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--brand)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="hour"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(value) => `₺${Math.round(value / 1000)}K`}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            contentStyle={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              boxShadow: "0 12px 30px rgb(0 0 0 / 0.10)",
              fontSize: 12,
            }}
            formatter={(value) => [
              new Intl.NumberFormat("tr-TR", {
                style: "currency",
                currency: "TRY",
                maximumFractionDigits: 0,
              }).format(Number(value)),
              "Satış",
            ]}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--brand)"
            strokeWidth={2.5}
            fill="url(#dixora-sales)"
            activeDot={{ r: 5, strokeWidth: 3, fill: "var(--card)", stroke: "var(--brand)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";

const RISK_SERIES = [
  { key: "bajo", label: "Riesgo bajo", color: "var(--good)", icon: "●" },
  { key: "medio", label: "Riesgo medio", color: "var(--warning)", icon: "▲" },
  { key: "alto", label: "Riesgo alto", color: "var(--critical)", icon: "■" },
] as const;

const axisTick = { fill: "var(--muted)", fontSize: 11 };

function ChartTooltip({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-surface px-3 py-2 text-xs shadow-soft">
      <div className="mb-1 font-medium text-fg">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-fg-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium text-fg">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function IncidentsByDayChart({ data }: { data: { label: string; bajo: number; medio: number; alto: number }[] }) {
  const totals = RISK_SERIES.map((s) => data.reduce((acc, d) => acc + d[s.key], 0));
  const all = totals.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-2" aria-label="Leyenda">
        {RISK_SERIES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
            <span className="tabular font-medium text-fg">{totals[i]}</span>
            <span className="tabular text-muted">({Math.round((totals[i] / all) * 100)}%)</span>
          </li>
        ))}
      </ul>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
            <Tooltip content={ChartTooltip} cursor={{ fill: "var(--surface-2)" }} />
            {RISK_SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="riesgo"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={2}
                maxBarSize={24}
                radius={i === RISK_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SignalBarChart({ data }: { data: { label: string; n: number }[] }) {
  return (
    <div style={{ height: Math.max(120, data.length * 36) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={190} tick={{ ...axisTick, fill: "var(--fg-2)" }} tickLine={false} axisLine={false} />
          <Tooltip content={ChartTooltip} cursor={{ fill: "var(--surface-2)" }} />
          <Bar
            dataKey="n"
            name="Casos con la señal"
            fill="var(--accent)"
            maxBarSize={18}
            radius={[0, 4, 4, 0]}
            label={{ position: "right", fill: "var(--fg-2)", fontSize: 11 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

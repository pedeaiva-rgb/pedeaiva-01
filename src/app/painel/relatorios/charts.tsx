"use client";

import { useState } from "react";
import { Table2 } from "lucide-react";
import { brl } from "@/lib/money";
import type { Bucket } from "@/lib/reports";

type Metric = "revenue" | "count";
const fmt = (m: Metric, v: number) => (m === "revenue" ? brl(v) : `${v} pedido${v === 1 ? "" : "s"}`);
/** Eixo: números redondos e curtos (R$ 1,2 mil). */
const compact = (m: Metric, v: number) => {
  if (m === "count") return String(v);
  const r = v / 100;
  return r >= 1000 ? `R$ ${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(r)}`;
};
/** Teto "redondo" do eixo (1, 2, 5 × 10ⁿ). */
const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
};

/**
 * Colunas de uma série (uma cor só): faturamento ou pedidos por dia/hora.
 * Passar o mouse ou focar uma coluna mostra o valor; "Ver em tabela" mostra todos os números.
 */
export function ColumnChart({ data, labelEvery = 1, ariaLabel }: { data: Bucket[]; labelEvery?: number; ariaLabel: string }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const vals = data.map((d) => (metric === "revenue" ? d.revenue : d.count));
  const top = niceMax(Math.max(0, ...vals));
  const h = hover != null ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-sand p-0.5 text-xs font-bold" role="group" aria-label="Medida">
          {(["revenue", "count"] as Metric[]).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={`rounded-full px-3 py-1 ${metric === m ? "bg-surface shadow" : "text-muted"}`}>
              {m === "revenue" ? "Faturamento" : "Pedidos"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setTable(!table)} className="inline-flex items-center gap-1 text-xs font-bold text-muted hover:text-ink">
          <Table2 className="h-3.5 w-3.5" /> {table ? "Ver gráfico" : "Ver em tabela"}
        </button>
      </div>

      {table ? (
        <DataTable rows={data.map((d) => [d.label, brl(d.revenue), String(d.count)])} head={["", "Faturamento", "Pedidos"]} />
      ) : (
        <div className="relative pl-14" role="img" aria-label={ariaLabel}>
          {/* Eixo e grade: linhas finas, discretas. */}
          {[1, 0.5, 0].map((f) => (
            <div key={f} className="absolute right-0 left-14 border-t border-line" style={{ top: `${(1 - f) * 160}px` }}>
              <span className="absolute -top-2 -left-14 w-12 text-right text-[10px] text-muted tabular-nums">{compact(metric, top * f)}</span>
            </div>
          ))}
          <div className="relative flex h-40 items-end gap-0.5">
            {data.map((d, i) => {
              const v = vals[i];
              const hgt = v > 0 ? Math.max(2, (v / top) * 160) : 0;
              return (
                <div
                  key={d.key}
                  tabIndex={0}
                  aria-label={`${d.label}: ${brl(d.revenue)}, ${d.count} pedido${d.count === 1 ? "" : "s"}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
                >
                  <div
                    className={`w-full max-w-6 rounded-t-[4px] transition ${hover === i ? "bg-tomato-deep" : "bg-tomato"} group-focus-visible:ring-2 group-focus-visible:ring-ink`}
                    style={{ height: hgt }}
                  />
                </div>
              );
            })}
          </div>
          {/* Rótulos centralizados na coluna e sem cortar (só de tantos em tantos, para não encavalar). */}
          <div className="mt-1 flex h-4 gap-0.5">
            {data.map((d, i) => (
              <span key={d.key} className="relative min-w-0 flex-1">
                {i % labelEvery === 0 && <span className="absolute left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted">{d.label}</span>}
              </span>
            ))}
          </div>
          {h && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl bg-charcoal px-3 py-2 text-xs whitespace-nowrap text-cream shadow-lg"
              style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${(hover! + 0.5) / data.length})` }}
            >
              <p className="text-sm font-bold">{fmt(metric, metric === "revenue" ? h.revenue : h.count)}</p>
              <p className="text-cream/70">
                {h.label} · {metric === "revenue" ? `${h.count} pedido${h.count === 1 ? "" : "s"}` : brl(h.revenue)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Barras horizontais com o valor na ponta (cada linha já é a tabela). */
export function BarList({ rows, empty = "Sem vendas no período." }: { rows: { label: string; value: number; display: string; sub?: string }[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-bold tabular-nums">
              {r.display}
              {r.sub && <span className="ml-1.5 text-xs font-normal text-muted">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-sand">
            <div className="h-2 rounded-full bg-tomato" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ head, rows, empty = "Sem dados no período." }: { head: string[]; rows: string[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="max-h-96 overflow-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-sand text-left text-xs text-muted">
          <tr>
            {head.map((x, i) => (
              <th key={i} className={`px-2.5 py-2 font-bold ${i > 0 ? "text-right" : ""}`}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => (
                <td key={j} className={`px-2.5 py-1.5 ${j > 0 ? "text-right tabular-nums" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

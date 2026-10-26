import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Download, Info } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui";
import { change, serverNow } from "@/lib/dashboard";
import { brl } from "@/lib/money";
import { CHANNEL_LABEL, PAYMENT_LABEL } from "@/lib/order-labels";
import { loadReport, MAX_ORDERS } from "@/lib/report-data";
import {
  byCourier,
  byDay,
  byField,
  byHour,
  bySeller,
  byService,
  byWeekday,
  coupons,
  dayStart,
  periodFrom,
  previousPeriod,
  products,
  serviceByWaiter,
  spDay,
  summary,
  times,
  type Period,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { BarList, ColumnChart, DataTable } from "./charts";

export const metadata: Metadata = { title: "Relatórios" };

const DAY = 864e5;
const shift = (day: string, n: number) => spDay(new Date(dayStart(day).getTime() + n * DAY + 12 * 3600_000));
const dateBR = (d: string) => d.split("-").reverse().join("/");

/** Atalhos de período (em dias de Brasília). */
function presets(today: string) {
  const [y, m] = today.split("-").map(Number);
  const firstThis = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastPrev = shift(firstThis, -1);
  const firstPrev = `${lastPrev.slice(0, 7)}-01`;
  return [
    { label: "Hoje", from: today, to: today },
    { label: "Ontem", from: shift(today, -1), to: shift(today, -1) },
    { label: "7 dias", from: shift(today, -6), to: today },
    { label: "30 dias", from: shift(today, -29), to: today },
    { label: "Este mês", from: firstThis, to: today },
    { label: "Mês passado", from: firstPrev, to: lastPrev },
  ];
}

export default async function ReportsPage({ searchParams }: PageProps<"/painel/relatorios">) {
  const t = (await getTenant())!;
  if (!allowed(t, "relatorios")) return <NoAccess />;
  const sp = await searchParams;
  const today = spDay(new Date(serverNow()));
  const p = periodFrom(typeof sp.de === "string" ? sp.de : undefined, typeof sp.ate === "string" ? sp.ate : undefined, today);
  const prev = previousPeriod(p);
  const sb = await createClient();
  const r = await loadReport(sb, t.pizzeria.id, p, prev);

  const s = summary(r.orders, r.tabs);
  const before = summary(r.previous);
  const days = byDay(r.orders, p);
  const prod = products(r.orders, r.categoryOf);
  const tm = times(r.orders, r.events);
  const sellers = bySeller(r.orders, r.personName);
  const waiters = serviceByWaiter(r.tabs, r.personName);
  const riders = byCourier(r.orders, r.courierName);
  const cups = coupons(r.orders);
  const share = (v: number) => (s.revenue ? `${Math.round((v / s.revenue) * 100)}%` : "");
  const qs = `de=${p.from}&ate=${p.to}`;

  return (
    <>
      <PageHeader title="Relatórios" subtitle={`${dateBR(p.from)} a ${dateBR(p.to)} · comparado com ${dateBR(prev.from)} a ${dateBR(prev.to)}`} />

      <Filters p={p} today={today} />

      {r.truncated && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-dende-soft p-3 text-sm text-warning">
          <Info className="h-4 w-4" /> O período tem mais de {MAX_ORDERS.toLocaleString("pt-BR")} pedidos: os números mostram só os primeiros. Escolha um período menor.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Faturamento" value={brl(s.revenue)} delta={change(s.revenue, before.revenue)} upIsGood />
        <Kpi label="Pedidos" value={String(s.count)} delta={change(s.count, before.count)} upIsGood />
        <Kpi label="Ticket médio" value={brl(s.avgTicket)} delta={change(s.avgTicket, before.avgTicket)} upIsGood />
        <Kpi label="Cancelados" value={String(s.cancelledCount)} hint={s.cancelledValue ? `${brl(s.cancelledValue)} em pedidos` : "nenhum valor perdido"} delta={change(s.cancelledCount, before.cancelledCount)} />
        <Kpi label="Descontos (cupons)" value={brl(s.discounts)} hint="já descontado do faturamento" />
        <Kpi label="Taxas de entrega" value={brl(s.deliveryFees)} hint="incluídas no faturamento" />
        <Kpi label="Taxa de serviço (mesas)" value={brl(s.serviceFee)} hint="contas fechadas no período" />
        <Kpi label="Clientes diferentes" value={String(s.customers)} hint="pelo nome no pedido" />
      </div>

      <Panel title="Vendas por dia" className="mt-4">
        {s.count ? (
          <ColumnChart data={days} labelEvery={Math.max(1, Math.ceil(days.length / 10))} ariaLabel="Faturamento por dia no período" />
        ) : (
          <p className="text-sm text-muted">Sem vendas no período.</p>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Horário dos pedidos">
          {s.count ? <ColumnChart data={byHour(r.orders)} labelEvery={4} ariaLabel="Faturamento por hora do dia" /> : <p className="text-sm text-muted">Sem vendas no período.</p>}
        </Panel>
        <Panel title="Dia da semana">
          <BarList rows={s.count ? byWeekday(r.orders).map((b) => ({ label: b.label, value: b.revenue, display: brl(b.revenue), sub: `${b.count} ped.` })) : []} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Por canal">
          <BarList rows={byField(r.orders, "channel", CHANNEL_LABEL).map((b) => ({ label: b.label, value: b.revenue, display: brl(b.revenue), sub: share(b.revenue) }))} />
        </Panel>
        <Panel title="Forma de pagamento">
          <BarList rows={byField(r.orders, "payment_method", PAYMENT_LABEL).map((b) => ({ label: b.label, value: b.revenue, display: brl(b.revenue), sub: share(b.revenue) }))} />
        </Panel>
        <Panel title="Entrega, retirada ou mesa">
          <BarList rows={byService(r.orders).map((b) => ({ label: b.label, value: b.revenue, display: brl(b.revenue), sub: `${b.count} ped.` }))} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Produtos mais vendidos">
          <DataTable
            head={["Produto", "Qtd.", "Faturamento", "%"]}
            rows={prod.items.slice(0, 30).map((x) => [x.name, String(x.qty), brl(x.revenue), share(x.revenue)])}
            empty="Sem vendas no período."
          />
          {prod.items.length > 30 && <p className="mt-2 text-xs text-muted">Mostrando os 30 primeiros de {prod.items.length}. A lista completa vem na planilha de itens.</p>}
        </Panel>
        <Panel title="Por categoria">
          <BarList rows={prod.categories.map((c) => ({ label: c.name, value: c.revenue, display: brl(c.revenue), sub: `${c.qty} un.` }))} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Tempos médios">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Preparo" value={tm.prep != null ? `${tm.prep} min` : "—"} hint="da confirmação ao pronto" />
            <Kpi label="Entrega" value={tm.delivery != null ? `${tm.delivery} min` : "—"} hint="da saída até o cliente" />
          </div>
        </Panel>
        <Panel title="Cupons usados">
          <DataTable head={["Cupom", "Usos", "Desconto dado", "Vendido"]} rows={cups.map((c) => [c.name, String(c.count), brl(c.revenue), brl(c.extra)])} empty="Nenhum cupom usado no período." />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Vendas por quem lançou">
          <DataTable head={["", "Pedidos", "Vendido"]} rows={sellers.map((x) => [x.name, String(x.count), brl(x.revenue)])} />
        </Panel>
        <Panel title="Taxa de serviço por garçom">
          <DataTable head={["", "Mesas", "Consumo", "Taxa"]} rows={waiters.map((x) => [x.name, String(x.count), brl(x.revenue), brl(x.extra)])} empty="Nenhuma conta de mesa fechada no período." />
        </Panel>
        <Panel title="Entregas por entregador">
          <DataTable head={["", "Entregas", "Taxas"]} rows={riders.map((x) => [x.name, String(x.count), brl(x.extra)])} empty="Nenhuma entrega com entregador no período." />
        </Panel>
      </div>

      <Panel title="Baixar planilha" className="mt-4">
        <p className="text-sm text-muted">Abre no Excel ou no Google Planilhas, com os mesmos filtros do período acima.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`/painel/relatorios/exportar?tipo=pedidos&${qs}`} className="btn-ghost" download>
            <Download className="h-4 w-4" /> Pedidos do período
          </a>
          <a href={`/painel/relatorios/exportar?tipo=itens&${qs}`} className="btn-ghost" download>
            <Download className="h-4 w-4" /> Itens vendidos
          </a>
        </div>
      </Panel>
    </>
  );
}

/** Filtro de período: atalhos primeiro, datas livres depois. Vale para tudo na página. */
function Filters({ p, today }: { p: Period; today: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      {presets(today).map((x) => {
        const active = x.from === p.from && x.to === p.to;
        return (
          <Link key={x.label} href={`/painel/relatorios?de=${x.from}&ate=${x.to}`} data-active={active} className="chip" aria-current={active ? "true" : undefined}>
            {x.label}
          </Link>
        );
      })}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-muted">
          De
          <input type="date" name="de" defaultValue={p.from} max={today} className="field mt-0.5 !w-auto !py-1.5 text-sm" />
        </label>
        <label className="text-xs font-bold text-muted">
          Até
          <input type="date" name="ate" defaultValue={p.to} max={today} className="field mt-0.5 !w-auto !py-1.5 text-sm" />
        </label>
        <button className="btn-dark !py-2 text-sm">Ver</button>
      </form>
    </div>
  );
}

function Kpi({ label, value, hint, delta, upIsGood = false }: { label: string; value: string; hint?: string; delta?: number | null; upIsGood?: boolean }) {
  const good = delta != null && delta !== 0 && delta > 0 === upIsGood;
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
      {delta != null ? (
        <p className={`mt-0.5 flex items-center gap-1 text-xs font-bold ${delta === 0 ? "text-muted" : good ? "text-success" : "text-danger"}`}>
          {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
          {delta > 0 ? "+" : ""}
          {delta}% <span className="font-normal text-muted">vs período anterior</span>
        </p>
      ) : (
        hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>
      )}
      {delta != null && hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

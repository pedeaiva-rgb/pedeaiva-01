import { avgDelivery, avgPrep, type DashEvent } from "./dashboard";
import { spClock, STORE_TZ } from "./hours";
import type { Channel, Fulfillment, OrderStatus, PaymentMethod } from "./types";

/** Contas dos Relatórios. Tudo puro: recebe as linhas do banco e devolve os números. */
export type RItem = { name: string; size_name: string | null; qty: number; subtotal_cents: number; product_id: string | null };
export type ROrder = {
  id: string;
  number: number;
  status: OrderStatus;
  channel: Channel;
  fulfillment: Fulfillment;
  payment_method: PaymentMethod;
  payment_status: string;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  coupon_code: string | null;
  customer_name: string;
  created_at: string;
  created_by: string | null;
  courier_id: string | null;
  tab_id: string | null;
  eta_max: number | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  order_items: RItem[];
};
/** Conta de mesa fechada no período, já com o consumo somado. */
export type RTab = { id: string; opened_by: string | null; service_fee_pct: number; subtotal_cents: number };

export type Bucket = { key: string; label: string; revenue: number; count: number };

export const DAY_MS = 864e5;
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ });

/** "AAAA-MM-DD" no horário de Brasília. */
export const spDay = (d: Date | string) => fmtDay.format(typeof d === "string" ? new Date(d) : d);
/** Começo do dia (Brasília, UTC−3 o ano todo) de uma data "AAAA-MM-DD". */
export const dayStart = (day: string) => new Date(`${day}T00:00:00-03:00`);
const addDays = (day: string, n: number) => spDay(new Date(dayStart(day).getTime() + n * DAY_MS + 12 * 3600_000));

/** Pedido que valeu: confirmado em diante, sem os cancelados (mesma regra da Visão geral). */
export const sold = (o: { status: OrderStatus }) => o.status !== "novo" && o.status !== "cancelado";

export type Period = { from: string; to: string; start: Date; end: Date; days: number };

/** Período inclusivo de dias (Brasília). Datas inválidas, invertidas ou longas demais viram os últimos 7 dias. */
export function periodFrom(from: string | undefined, to: string | undefined, today: string, maxDays = 366): Period {
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayStart(s).getTime());
  let f = ok(from) ? from! : addDays(today, -6);
  let t = ok(to) ? to! : today;
  if (f > t) [f, t] = [t, f];
  const days = Math.round((dayStart(t).getTime() - dayStart(f).getTime()) / DAY_MS) + 1;
  if (days > maxDays) f = addDays(t, -(maxDays - 1));
  const start = dayStart(f);
  const end = dayStart(addDays(t, 1));
  return { from: f, to: t, start, end, days: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
}

/** Período anterior de mesmo tamanho (para comparar). */
export function previousPeriod(p: Period): Period {
  const to = addDays(p.from, -1);
  const from = addDays(p.from, -p.days);
  return { from, to, start: dayStart(from), end: p.start, days: p.days };
}

export function summary(orders: ROrder[], tabs: RTab[] = []) {
  const ok = orders.filter(sold);
  const revenue = ok.reduce((s, o) => s + o.total_cents, 0);
  const cancelled = orders.filter((o) => o.status === "cancelado");
  return {
    revenue,
    count: ok.length,
    avgTicket: ok.length ? Math.round(revenue / ok.length) : 0,
    cancelledCount: cancelled.length,
    cancelledValue: cancelled.reduce((s, o) => s + o.total_cents, 0),
    discounts: ok.reduce((s, o) => s + o.discount_cents, 0),
    deliveryFees: ok.reduce((s, o) => s + o.delivery_fee_cents, 0),
    serviceFee: tabs.reduce((s, t) => s + serviceOf(t), 0),
    customers: new Set(ok.map((o) => o.customer_name.trim().toLowerCase()).filter(Boolean)).size,
  };
}

export const serviceOf = (t: RTab) => Math.round((t.subtotal_cents * Number(t.service_fee_pct)) / 100);

function group(orders: ROrder[], keyOf: (o: ROrder) => string, labelOf: (k: string) => string): Bucket[] {
  const by = new Map<string, Bucket>();
  for (const o of orders.filter(sold)) {
    const k = keyOf(o);
    const b = by.get(k) ?? { key: k, label: labelOf(k), revenue: 0, count: 0 };
    b.revenue += o.total_cents;
    b.count += 1;
    by.set(k, b);
  }
  return [...by.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label));
}

/** Um ponto por dia do período (dias sem venda aparecem com zero). */
export function byDay(orders: ROrder[], p: Period): Bucket[] {
  const by = new Map(group(orders, (o) => spDay(o.created_at), (k) => k).map((b) => [b.key, b]));
  const out: Bucket[] = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    const [, m, dd] = d.split("-");
    out.push({ key: d, label: `${dd}/${m}`, revenue: by.get(d)?.revenue ?? 0, count: by.get(d)?.count ?? 0 });
  }
  return out;
}

export function byHour(orders: ROrder[]): Bucket[] {
  const by = new Map(group(orders, (o) => String(Math.floor(spClock(new Date(o.created_at)).min / 60)), (k) => k).map((b) => [b.key, b]));
  return Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, "0")}h`, revenue: by.get(String(h))?.revenue ?? 0, count: by.get(String(h))?.count ?? 0 }));
}

const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export function byWeekday(orders: ROrder[]): Bucket[] {
  const by = new Map(group(orders, (o) => String(spClock(new Date(o.created_at)).day), (k) => k).map((b) => [b.key, b]));
  return WEEKDAY.map((label, d) => ({ key: String(d), label, revenue: by.get(String(d))?.revenue ?? 0, count: by.get(String(d))?.count ?? 0 }));
}

export const byField = <K extends keyof ROrder>(orders: ROrder[], field: K, labels: Record<string, string>) =>
  group(orders, (o) => String(o[field]), (k) => labels[k] ?? k);

/** Entrega, retirada ou mesa (rodada de mesa é "retirada" no banco). */
export const byService = (orders: ROrder[]) =>
  group(orders, (o) => (o.tab_id ? "mesa" : o.fulfillment), (k) => ({ entrega: "Entrega", retirada: "Retirada", mesa: "Mesa" })[k] ?? k);

export type ProductRow = { name: string; qty: number; revenue: number };
/** Itens mais vendidos (por receita) e vendas por categoria. */
export function products(orders: ROrder[], categoryOf: (productId: string | null) => string) {
  const items = orders.filter(sold).flatMap((o) => o.order_items);
  const byName = new Map<string, ProductRow>();
  const byCat = new Map<string, ProductRow>();
  for (const i of items) {
    const n = i.size_name ? `${i.name} (${i.size_name})` : i.name;
    const a = byName.get(n) ?? { name: n, qty: 0, revenue: 0 };
    a.qty += i.qty;
    a.revenue += i.subtotal_cents;
    byName.set(n, a);
    const c = categoryOf(i.product_id);
    const b = byCat.get(c) ?? { name: c, qty: 0, revenue: 0 };
    b.qty += i.qty;
    b.revenue += i.subtotal_cents;
    byCat.set(c, b);
  }
  const sort = (l: ProductRow[]) => l.sort((x, y) => y.revenue - x.revenue || y.qty - x.qty || x.name.localeCompare(y.name));
  return { items: sort([...byName.values()]), categories: sort([...byCat.values()]) };
}

export type PersonRow = { name: string; count: number; revenue: number; extra: number };
/** Quem lançou cada venda (PDV, mesas). Pedidos do site entram como "Loja online". */
export function bySeller(orders: ROrder[], nameOf: (userId: string) => string): PersonRow[] {
  const by = new Map<string, PersonRow>();
  for (const o of orders.filter(sold)) {
    const n = o.created_by ? nameOf(o.created_by) : o.channel === "mesa" ? "Cliente pelo QR da mesa" : "Loja online";
    const r = by.get(n) ?? { name: n, count: 0, revenue: 0, extra: 0 };
    r.count += 1;
    r.revenue += o.total_cents;
    by.set(n, r);
  }
  return [...by.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Taxa de serviço das mesas por quem abriu a conta (o garçom da mesa). extra = taxa. */
export function serviceByWaiter(tabs: RTab[], nameOf: (userId: string) => string): PersonRow[] {
  const by = new Map<string, PersonRow>();
  for (const t of tabs) {
    const n = t.opened_by ? nameOf(t.opened_by) : "Aberta pelo cliente (QR)";
    const r = by.get(n) ?? { name: n, count: 0, revenue: 0, extra: 0 };
    r.count += 1;
    r.revenue += t.subtotal_cents;
    r.extra += serviceOf(t);
    by.set(n, r);
  }
  return [...by.values()].sort((a, b) => b.extra - a.extra);
}

/** Entregas feitas por entregador. extra = taxas de entrega cobradas. */
export function byCourier(orders: ROrder[], nameOf: (courierId: string) => string): PersonRow[] {
  const by = new Map<string, PersonRow>();
  for (const o of orders) {
    if (o.status !== "entregue" || o.fulfillment !== "entrega" || !o.courier_id) continue;
    const n = nameOf(o.courier_id);
    const r = by.get(n) ?? { name: n, count: 0, revenue: 0, extra: 0 };
    r.count += 1;
    r.revenue += o.total_cents;
    r.extra += o.delivery_fee_cents;
    by.set(n, r);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** Cupons usados nos pedidos que valeram. revenue = desconto dado. */
export function coupons(orders: ROrder[]): PersonRow[] {
  const by = new Map<string, PersonRow>();
  for (const o of orders.filter(sold)) {
    if (!o.coupon_code) continue;
    const r = by.get(o.coupon_code) ?? { name: o.coupon_code, count: 0, revenue: 0, extra: 0 };
    r.count += 1;
    r.revenue += o.discount_cents;
    r.extra += o.total_cents;
    by.set(o.coupon_code, r);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export const times = (orders: ROrder[], events: DashEvent[]) => ({ prep: avgPrep(events), delivery: avgDelivery(orders) });

/** Planilha (CSV) que abre certo no Excel em português: separador ";", vírgula decimal e BOM. */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    // Fórmula no começo vira texto (evita "injeção de fórmula" ao abrir no Excel).
    const formula = /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-[\d.,]+$/.test(s));
    const safe = formula && typeof v === "string" ? `'${s}` : s;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}
export const csvMoney = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

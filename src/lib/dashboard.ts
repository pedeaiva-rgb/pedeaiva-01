import type { OrderStatus } from "./types";

/** Contas da Visão geral (painel de comando do dia). */
export type DashOrder = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  eta_max: number | null;
  fulfillment: "entrega" | "retirada";
  dispatched_at: string | null;
  delivered_at: string | null;
};
export type DashEvent = { order_id: string; to_status: OrderStatus; created_at: string };
export type DashItem = { order_id: string; name: string; size_name: string | null; qty: number };

const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
const avg = (l: number[]) => (l.length ? Math.round(l.reduce((s, x) => s + x, 0) / l.length) : null);

/** Vendido = pedidos confirmados (nem "novo" nem cancelado). */
export function sales(orders: DashOrder[]) {
  const sold = orders.filter((o) => o.status !== "novo" && o.status !== "cancelado");
  const revenue = sold.reduce((s, o) => s + o.total_cents, 0);
  return { revenue, count: sold.length, avgTicket: sold.length ? Math.round(revenue / sold.length) : 0, cancelled: orders.filter((o) => o.status === "cancelado").length };
}

/** Variação em % (null quando não há base para comparar). */
export const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/** Tempo médio de preparo: da confirmação até "pronto". */
export function avgPrep(events: DashEvent[]) {
  const by = new Map<string, { c?: string; p?: string }>();
  for (const e of events) {
    const r = by.get(e.order_id) ?? {};
    if (e.to_status === "confirmado") r.c ??= e.created_at;
    if (e.to_status === "pronto") r.p ??= e.created_at;
    by.set(e.order_id, r);
  }
  return avg([...by.values()].flatMap((r) => (r.c && r.p && mins(r.c, r.p) >= 0 ? [mins(r.c, r.p)] : [])));
}

/** Tempo médio na rua: da saída até a entrega. */
export const avgDelivery = (orders: DashOrder[]) =>
  avg(orders.flatMap((o) => (o.dispatched_at && o.delivered_at && mins(o.dispatched_at, o.delivered_at) >= 0 ? [mins(o.dispatched_at, o.delivered_at)] : [])));

/** Em aberto e já passou da previsão (ou do tempo de preparo, para retirada sem previsão). */
export const lateOrders = (orders: DashOrder[], now: number, prepMinutes: number) =>
  orders.filter((o) => !["entregue", "cancelado"].includes(o.status) && (now - new Date(o.created_at).getTime()) / 60_000 > (o.eta_max ?? prepMinutes));

/** Mais vendidos (por quantidade), só de pedidos que valeram. */
export function topItems(items: DashItem[], valid: Set<string>, n = 5) {
  const by = new Map<string, number>();
  for (const i of items) {
    if (!valid.has(i.order_id)) continue;
    const k = i.size_name ? `${i.name} (${i.size_name})` : i.name;
    by.set(k, (by.get(k) ?? 0) + i.qty);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** Hora atual do servidor (a página é recalculada a cada visita/atualização). */
export const serverNow = () => Date.now();

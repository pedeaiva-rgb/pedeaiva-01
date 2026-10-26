import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashEvent } from "./dashboard";
import { ROLE_LABEL } from "./order-labels";
import type { Period, ROrder, RTab } from "./reports";
import type { Role } from "./types";

const PAGE = 1000;
/** Limite de segurança: períodos enormes param aqui (o relatório avisa). */
export const MAX_ORDERS = 20_000;

const ORDER_COLS =
  "id,number,status,channel,fulfillment,payment_method,payment_status,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,coupon_code,customer_name,created_at,created_by,courier_id,tab_id,eta_max,dispatched_at,delivered_at";

/** Busca em páginas de 1.000 (o banco devolve no máximo isso por vez). */
async function paged<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = MAX_ORDERS): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error("Não foi possível carregar o relatório");
    const list = (data ?? []) as T[];
    rows.push(...list);
    if (list.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const chunks = <T,>(l: T[], size = 150) => Array.from({ length: Math.ceil(l.length / size) }, (_, i) => l.slice(i * size, (i + 1) * size));

export async function loadOrders(sb: SupabaseClient, pizzeriaId: string, p: Period, withItems = true) {
  const cols = withItems ? `${ORDER_COLS}, order_items(name,size_name,qty,subtotal_cents,product_id)` : ORDER_COLS;
  return paged<ROrder>((from, to) =>
    sb
      .from("orders")
      .select(cols)
      .eq("pizzeria_id", pizzeriaId)
      .gte("created_at", p.start.toISOString())
      .lt("created_at", p.end.toISOString())
      .order("created_at")
      .range(from, to),
  );
}

/** Tudo o que a tela de Relatórios precisa, com a sessão da pessoa (as regras do banco valem). */
export async function loadReport(sb: SupabaseClient, pizzeriaId: string, p: Period, prev: Period) {
  const [cur, before, events, closed, members, couriers, prods, cats] = await Promise.all([
    loadOrders(sb, pizzeriaId, p),
    loadOrders(sb, pizzeriaId, prev, false),
    paged<DashEvent>((from, to) =>
      sb
        .from("order_events")
        .select("order_id,to_status,created_at")
        .eq("pizzeria_id", pizzeriaId)
        .in("to_status", ["confirmado", "pronto"])
        .gte("created_at", p.start.toISOString())
        .lt("created_at", p.end.toISOString())
        .range(from, to),
    ),
    // Mesas: contas fechadas no período (a taxa de serviço entra no dia em que a conta fecha).
    sb
      .from("tabs")
      .select("id,opened_by,service_fee_pct")
      .eq("pizzeria_id", pizzeriaId)
      .eq("status", "fechada")
      .gte("closed_at", p.start.toISOString())
      .lt("closed_at", p.end.toISOString())
      .then((r) => (r.error ? { data: [] } : r)),
    sb.from("members").select("user_id,display_name,role").eq("pizzeria_id", pizzeriaId),
    sb.from("couriers").select("id,name").eq("pizzeria_id", pizzeriaId),
    sb.from("products").select("id,category_id").eq("pizzeria_id", pizzeriaId),
    sb.from("categories").select("id,name").eq("pizzeria_id", pizzeriaId),
  ]);

  // Consumo de cada conta fechada (as rodadas podem ter sido lançadas antes do período).
  const tabRows = (closed.data ?? []) as { id: string; opened_by: string | null; service_fee_pct: number }[];
  const sub = new Map<string, number>();
  for (const ids of chunks(tabRows.map((t) => t.id))) {
    const { data } = await sb.from("orders").select("tab_id,total_cents,status").in("tab_id", ids);
    for (const o of (data ?? []) as { tab_id: string; total_cents: number; status: string }[]) {
      if (o.status === "cancelado" || o.status === "novo") continue;
      sub.set(o.tab_id, (sub.get(o.tab_id) ?? 0) + o.total_cents);
    }
  }
  const tabs: RTab[] = tabRows.map((t) => ({ ...t, subtotal_cents: sub.get(t.id) ?? 0 }));

  // Sem nome cadastrado, mostra a função (ex.: "Caixa").
  const people = new Map(((members.data ?? []) as { user_id: string; display_name: string | null; role: Role }[]).map((m) => [m.user_id, m.display_name || ROLE_LABEL[m.role]]));
  const riders = new Map(((couriers.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const catName = new Map(((cats.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const catOf = new Map(((prods.data ?? []) as { id: string; category_id: string }[]).map((x) => [x.id, catName.get(x.category_id) ?? "Sem categoria"]));

  return {
    orders: cur.rows,
    previous: before.rows,
    events: events.rows,
    tabs,
    truncated: cur.truncated,
    personName: (id: string) => people.get(id) ?? "Ex-membro da equipe",
    courierName: (id: string) => riders.get(id) ?? "Entregador removido",
    categoryOf: (productId: string | null) => (productId ? (catOf.get(productId) ?? "Produto removido") : "Sem categoria"),
  };
}

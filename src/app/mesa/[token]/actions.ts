"use server";

import { z } from "zod";
import { loadMenu } from "@/lib/menu";
import { firstIssue, lineSchema } from "@/lib/order-schema";
import { submitOrder } from "@/lib/orders";
import { qrTokenSchema as tokenSchema, tableByToken } from "@/lib/mesa-qr";
import { adminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/lib/types";

export type GuestRound = {
  id: string;
  number: number;
  status: OrderStatus;
  created_at: string;
  total_cents: number;
  items: { id: string; name: string; qty: number; size_name: string | null; subtotal_cents: number; extras: { name: string }[] }[];
};
export type GuestState = {
  rounds: GuestRound[];
  totals: { subtotal: number; service_pct: number; service: number; total: number; paid: number; remaining: number } | null;
  calls: ("garcom" | "conta")[];
};

/** O que o cliente vê da conta da mesa: rodadas, total e se o garçom já foi chamado. Nada da equipe ou de outras mesas. */
export async function tableState(token: string): Promise<GuestState | null> {
  const t = await tableByToken(token);
  if (!t) return null;
  const admin = adminClient();
  const [{ data: tab }, { data: calls }] = await Promise.all([
    admin.from("tabs").select("id, service_fee_pct").eq("table_id", t.id).eq("status", "aberta").maybeSingle(),
    admin.from("table_calls").select("kind").eq("table_id", t.id).is("resolved_at", null),
  ]);
  const open = ((calls ?? []) as { kind: "garcom" | "conta" }[]).map((c) => c.kind);
  if (!tab) return { rounds: [], totals: null, calls: open };
  const [{ data: orders }, { data: pays }] = await Promise.all([
    admin
      .from("orders")
      .select("id, number, status, created_at, total_cents, items:order_items(id, name, qty, size_name, subtotal_cents, extras)")
      .eq("tab_id", tab.id)
      .order("created_at"),
    admin.from("payments").select("kind, amount_cents").eq("tab_id", tab.id),
  ]);
  const rounds = (orders ?? []) as GuestRound[];
  // Mesma conta de public.tab_totals: pedido esperando confirmação e cancelado não entram.
  const subtotal = rounds.filter((r) => r.status !== "cancelado" && r.status !== "novo").reduce((s, r) => s + r.total_cents, 0);
  const pct = Number(tab.service_fee_pct);
  const service = Math.round((subtotal * pct) / 100);
  const paid = ((pays ?? []) as { kind: string; amount_cents: number }[]).reduce((s, p) => s + (p.kind === "recebimento" ? p.amount_cents : -p.amount_cents), 0);
  return { rounds, totals: { subtotal, service_pct: pct, service, total: subtotal + service, paid, remaining: subtotal + service - paid }, calls: open };
}

const orderSchema = z.object({
  token: tokenSchema,
  idempotency_key: z.string().min(16).max(80),
  items: z.array(lineSchema).min(1, "Escolha pelo menos um item").max(30),
  name: z.string().trim().max(30).default(""),
  notes: z.string().trim().max(300).default(""),
});
export type GuestOrderInput = z.input<typeof orderSchema>;

/** Pedido do cliente pela mesa: preço do servidor e chega para a equipe confirmar. */
export async function placeGuestOrder(input: GuestOrderInput): Promise<{ ok: true; number: number; confirmed: boolean } | { ok: false; error: string }> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const t = await tableByToken(d.token);
  if (!t || !t.active) return { ok: false, error: "Esta mesa não está disponível. Chame o garçom." };
  const admin = adminClient();
  const menu = await loadMenu(admin, { id: t.pizzeria_id });
  if (!menu) return { ok: false, error: "Loja não encontrada." };
  if (menu.pizzeria.qr_ordering === false) return { ok: false, error: "Nesta loja o pedido é feito com o garçom." };

  // Antes de gravar: não deixa acumular pedidos sem confirmação (brincadeira ou clique repetido).
  const { data: tab } = await admin.from("tabs").select("id").eq("table_id", t.id).eq("status", "aberta").maybeSingle();
  if (tab) {
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("tab_id", tab.id).eq("status", "novo");
    if ((count ?? 0) >= 3) return { ok: false, error: "Espere a equipe confirmar os pedidos anteriores." };
  }

  const r = await submitOrder(
    menu,
    {
      items: d.items,
      fulfillment: "retirada",
      neighborhood: "",
      coupon: "",
      idempotency_key: d.idempotency_key,
      customer_name: d.name ? `Mesa ${t.name} · ${d.name}` : `Mesa ${t.name}`,
      customer_phone: "",
      address: null,
      payment_method: "dinheiro",
      change_for_cents: null,
      notes: d.notes,
    },
    "mesa",
    null,
  );
  if (!r.ok) return r;
  const { data, error } = await admin.rpc("attach_qr_round", { _order: r.id, _table: t.id });
  if (error) {
    // Mesmo pedido enviado de novo (internet caiu na volta): já está na mesa.
    const { data: o } = await admin.from("orders").select("tab_id, status").eq("id", r.id).maybeSingle();
    if (o?.tab_id) return { ok: true, number: r.number, confirmed: o.status !== "novo" };
    // Não ficou na mesa: não deixa um pedido solto aparecendo para a equipe.
    await admin.from("orders").update({ status: "cancelado", updated_at: new Date().toISOString() }).eq("id", r.id);
    return { ok: false, error: /Espere a equipe/.test(error.message) ? "Espere a equipe confirmar os pedidos anteriores." : "Não foi possível enviar o pedido. Chame o garçom." };
  }
  return { ok: true, number: r.number, confirmed: (data as { confirmed: boolean }).confirmed };
}

/** "Chamar garçom" e "Pedir a conta". Apertar de novo não duplica o chamado. */
export async function callStaff(token: string, kind: "garcom" | "conta"): Promise<{ ok: boolean; error?: string }> {
  if (kind !== "garcom" && kind !== "conta") return { ok: false };
  const t = await tableByToken(token);
  if (!t || !t.active) return { ok: false, error: "Esta mesa não está disponível." };
  const { error } = await adminClient().rpc("qr_call", { _table: t.id, _kind: kind });
  return error ? { ok: false, error: "Não foi possível chamar. Tente de novo." } : { ok: true };
}

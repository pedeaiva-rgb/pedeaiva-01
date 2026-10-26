"use server";

import { loadMenu } from "@/lib/menu";
import { firstIssue, pdvOrderSchema, type PdvOrderInput, type QuoteInput } from "@/lib/order-schema";
import { quoteFor, submitOrder, type QuoteResult, type SubmitResult } from "@/lib/orders";
import { adminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { ACCESS, hasRole } from "@/lib/tenant";

export async function quotePdvOrder(pizzeriaId: string, input: QuoteInput): Promise<QuoteResult> {
  if (!(await hasRole(pizzeriaId, ACCESS.pdv))) return { ok: false, error: "Você não tem acesso ao PDV desta loja." };
  return quoteFor({ id: pizzeriaId }, input, "balcao");
}

export type PdvResult = SubmitResult & { payment_error?: string };

/** Pedido do balcão/telefone/WhatsApp: mesma criação da loja online, com o atendente registrado. */
export async function placePdvOrder(input: PdvOrderInput): Promise<PdvResult> {
  const parsed = pdvOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;
  const user = await getUser();
  if (!user || !(await hasRole(data.pizzeria_id, ACCESS.pdv))) return { ok: false, error: "Você não tem acesso ao PDV desta loja." };
  const menu = await loadMenu(adminClient(), { id: data.pizzeria_id });
  if (!menu) return { ok: false, error: "Loja não encontrada" };

  const r = await submitOrder(menu, data, data.channel, user.id);
  if (!r.ok || !data.received_now) return r;
  // Recebimento registrado em nome de quem está no caixa (com a sessão dele, não com a chave secreta).
  const sb = await createClient();
  const { error } = await sb.rpc("register_payment", { _order: r.id, _method: data.payment_method, _note: "Recebido no PDV" });
  return error ? { ...r, payment_error: "Pedido criado, mas o recebimento não foi registrado. Registre em Pedidos." } : r;
}

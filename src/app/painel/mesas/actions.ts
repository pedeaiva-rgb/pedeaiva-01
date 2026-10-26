"use server";

import { z } from "zod";
import { loadMenu } from "@/lib/menu";
import { firstIssue, lineSchema } from "@/lib/order-schema";
import { submitOrder } from "@/lib/orders";
import { adminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { ACCESS, hasRole } from "@/lib/tenant";

const roundSchema = z.object({
  tab_id: z.uuid(),
  idempotency_key: z.string().min(16).max(80),
  items: z.array(lineSchema).min(1, "Adicione os itens da rodada").max(40),
  notes: z.string().trim().max(300).default(""),
});
export type RoundInput = z.input<typeof roundSchema>;

/**
 * Lança uma rodada na conta da mesa: preço recalculado no servidor (igual ao PDV), pedido do canal "mesa"
 * e já confirmado, para aparecer na tela da cozinha.
 */
export async function placeRound(input: RoundInput): Promise<{ ok: true; number: number } | { ok: false; error: string }> {
  const parsed = roundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const user = await getUser();
  if (!user) return { ok: false, error: "Faça login de novo." };
  // A leitura com a sessão da pessoa já confere se ela vê esta conta.
  const sb = await createClient();
  const { data: tab } = await sb.from("tabs").select("id, pizzeria_id, status, table:dining_tables(name)").eq("id", d.tab_id).maybeSingle();
  if (!tab) return { ok: false, error: "Mesa não encontrada." };
  if (tab.status !== "aberta") return { ok: false, error: "Esta conta já foi fechada." };
  if (!(await hasRole(tab.pizzeria_id, ACCESS.mesas))) return { ok: false, error: "Você não tem acesso às mesas." };
  const admin = adminClient();
  const menu = await loadMenu(admin, { id: tab.pizzeria_id });
  if (!menu) return { ok: false, error: "Pizzaria não encontrada." };
  const tableName = (tab.table as unknown as { name: string } | null)?.name ?? "?";

  const r = await submitOrder(
    menu,
    {
      items: d.items,
      fulfillment: "retirada",
      neighborhood: "",
      coupon: "",
      idempotency_key: d.idempotency_key,
      customer_name: `Mesa ${tableName}`,
      customer_phone: "",
      address: null,
      payment_method: "dinheiro",
      change_for_cents: null,
      notes: d.notes,
    },
    "mesa",
    user.id,
  );
  if (!r.ok) return r;
  const { error } = await admin.rpc("attach_round", { _order: r.id, _tab: d.tab_id });
  if (error) return { ok: false, error: "A rodada foi criada, mas não entrou na mesa. Avise o responsável." };
  return { ok: true, number: r.number };
}

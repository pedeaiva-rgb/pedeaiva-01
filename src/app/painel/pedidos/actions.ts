"use server";

import { refundOnline } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/tenant";

/**
 * Depois que a loja registrou o estorno (com as regras e o PIN de sempre), devolve o Pix online ao cliente
 * pelo provedor. Só age em pedido já marcado como estornado: quem não podia estornar não chega aqui.
 */
export async function refundOrderOnline(orderId: string): Promise<{ ok: true; online: boolean } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: o } = await sb.from("orders").select("id, pizzeria_id, payment_status").eq("id", orderId).maybeSingle();
  if (!o || o.payment_status !== "estornado") return { ok: false, error: "Registre o estorno antes." };
  if (!(await hasRole(o.pizzeria_id as string, ["owner", "manager", "cashier"]))) return { ok: false, error: "Sem permissão." };
  return refundOnline(orderId);
}

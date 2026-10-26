"use server";

import { headers } from "next/headers";
import { loadMenu } from "@/lib/menu";
import { firstIssue, siteOrderSchema, type QuoteInput, type SiteOrderInput } from "@/lib/order-schema";
import { prepareOrder, quoteFor, submitOrder, type QuoteResult, type SubmitResult } from "@/lib/orders";
import { pixReady, simulatorEnabled, startPix, syncCharge, type PixView } from "@/lib/payments";
import { simulatePay } from "@/lib/payments/simulado";
import { normalizeBrPhone } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";

export async function quoteSiteOrder(slug: string, input: QuoteInput): Promise<QuoteResult> {
  return quoteFor({ slug }, input, "site");
}

export async function placeSiteOrder(input: SiteOrderInput): Promise<SubmitResult> {
  const parsed = siteOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;
  if (data.website) return { ok: false, error: "Não foi possível registrar o pedido." };
  const menu = await loadMenu(adminClient(), { slug: data.slug });
  if (!menu) return { ok: false, error: "Loja não encontrada" };
  return submitOrder(menu, data, "site", null);
}

/**
 * Pedido com Pix pago agora: calcula o pedido, gera o Pix e devolve o QR. O pedido só é criado
 * quando o pagamento for confirmado (pela consulta da tela ou pelo aviso do provedor).
 */
export async function startSitePix(input: SiteOrderInput): Promise<{ ok: true; pix: PixView } | { ok: false; error: string }> {
  const parsed = siteOrderSchema.safeParse({ ...input, payment_method: "pix", change_for_cents: null });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;
  if (data.website) return { ok: false, error: "Não foi possível registrar o pedido." };
  const admin = adminClient();
  const menu = await loadMenu(admin, { slug: data.slug });
  if (!menu) return { ok: false, error: "Loja não encontrada" };
  if (!(await pixReady(menu.pizzeria.id))) return { ok: false, error: "Esta loja não está recebendo Pix pelo site agora. Escolha outra forma de pagamento." };

  // Mesma trava da loja online (4 pedidos em 10 min por telefone), conferida antes de cobrar.
  const phone = normalizeBrPhone(data.customer_phone);
  const { count } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("pizzeria_id", menu.pizzeria.id)
    .eq("customer_phone", phone ?? "")
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 4) return { ok: false, error: "Muitos pedidos seguidos com este telefone. Aguarde alguns minutos." };

  const prep = await prepareOrder(menu, data, "site", null);
  if (!prep.ok) return prep;
  const h = await headers();
  const origin = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return startPix(prep.payload, { storeName: menu.pizzeria.name, customerName: data.customer_name, origin });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A tela do Pix pergunta de tempos em tempos se já pagou (e o servidor confere no provedor). */
export async function sitePixStatus(chargeId: string): Promise<{ status: string; order_token: string | null } | null> {
  if (!UUID.test(chargeId)) return null;
  const v = await syncCharge(chargeId);
  return v ? { status: v.status, order_token: v.order_token } : null;
}

/** Só no computador de teste: "paga" o Pix do simulador. */
export async function simulateSitePix(chargeId: string) {
  if (!simulatorEnabled() || !UUID.test(chargeId)) return null;
  const { data } = await adminClient().from("online_charges").select("external_id, provider").eq("id", chargeId).maybeSingle();
  if (data?.provider !== "simulado" || !data.external_id) return null;
  simulatePay(data.external_id as string);
  return sitePixStatus(chargeId);
}

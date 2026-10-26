import type { NextRequest } from "next/server";
import { PROVIDERS, syncCharge } from "@/lib/payments";
import type { ProviderId } from "@/lib/payments/types";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Aviso do provedor de pagamento ("o Pix X mudou"). O aviso só diz QUAL cobrança olhar:
 * a situação é sempre consultada no próprio provedor antes de criar o pedido (aviso falso não paga nada).
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/pagamentos/webhook/[provider]">) {
  const { provider: id } = await ctx.params;
  const provider = PROVIDERS[id as ProviderId];
  if (!provider || id === "simulado") return new Response(null, { status: 404 });
  const body = await req.text();
  const hint = provider.parseWebhook(req, body.slice(0, 20_000));
  if (!hint.valid) console.warn("aviso de pagamento sem assinatura válida", id);
  let q = adminClient().from("online_charges").select("id, external_id").eq("provider", id);
  if (hint.charge_id && /^[0-9a-f-]{36}$/.test(hint.charge_id)) q = q.eq("id", hint.charge_id);
  else if (hint.external_id) q = q.eq("external_id", hint.external_id);
  else return new Response(null, { status: 200 });
  const { data: c } = await q.maybeSingle();
  // O aviso precisa bater com a cobrança (id nosso + id do provedor), senão é ignorado.
  if (c && (!hint.external_id || c.external_id === hint.external_id)) await syncCharge(c.id as string);
  return new Response(null, { status: 200 });
}

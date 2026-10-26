import "server-only";
import { adminClient } from "../supabase/admin";
import type { OrderPayload } from "../orders";
import { mercadoPago } from "./mercadopago";
import { loadCredentials, saveCredentials, secretsConfigured } from "./secrets";
import { simulado, simulatorEnabled } from "./simulado";
import { PaymentError, type Credentials, type PaymentAccount, type PaymentProvider, type ProviderId } from "./types";

/** Provedores disponíveis. Novo gateway (Tuna, Pagar.me, Asaas...) = novo arquivo que implementa PaymentProvider + uma linha aqui. */
export const PROVIDERS: Record<ProviderId, PaymentProvider> = { mercadopago: mercadoPago, simulado };

/** Tempo para o cliente pagar o Pix. */
export const PIX_MINUTES = 15;

export async function getAccount(pizzeriaId: string): Promise<PaymentAccount | null> {
  const { data } = await adminClient()
    .from("payment_accounts")
    .select("pizzeria_id, provider, mode, status, external_account_id, account_label")
    .eq("pizzeria_id", pizzeriaId)
    .maybeSingle();
  return (data as PaymentAccount | null) ?? null;
}

/** A loja recebe Pix pelo site agora? (ligado, conta ativa e provedor configurado neste servidor) */
export async function pixReady(pizzeriaId: string): Promise<boolean> {
  if (!secretsConfigured()) return false;
  const { data: pz } = await adminClient().from("pizzerias").select("online_pix").eq("id", pizzeriaId).maybeSingle();
  if (!pz?.online_pix) return false;
  const acc = await getAccount(pizzeriaId);
  return !!acc && acc.status === "ativa" && !!PROVIDERS[acc.provider]?.configured();
}

async function credentialsFor(acc: PaymentAccount): Promise<Credentials> {
  const c = await loadCredentials(acc.pizzeria_id);
  if (!c) throw new PaymentError("A conta de pagamento da loja não está conectada.");
  const p = PROVIDERS[acc.provider];
  const renewed = p.refresh ? await p.refresh(c) : null;
  if (renewed) await saveCredentials(acc.pizzeria_id, renewed);
  return renewed ?? c;
}

/** Parte da plataforma em cada Pix (PAYMENTS_PLATFORM_FEE_PCT, ex.: 0.5 = 0,5%). Hoje: 0. */
const platformFee = (cents: number) => {
  const pct = Number(process.env.PAYMENTS_PLATFORM_FEE_PCT ?? 0);
  return pct > 0 && pct < 10 ? Math.round((cents * pct) / 100) : 0;
};

export type PixView = { id: string; status: string; amount_cents: number; qr_code: string | null; qr_image: string | null; expires_at: string; order_token: string | null; simulated: boolean };

const view = (c: Record<string, unknown>): PixView => ({
  id: c.id as string,
  status: c.status as string,
  amount_cents: c.amount_cents as number,
  qr_code: (c.qr_code as string | null) ?? null,
  qr_image: (c.qr_image as string | null) ?? null,
  expires_at: c.expires_at as string,
  order_token: (c.order_token as string | null) ?? null,
  simulated: c.provider === "simulado",
});
const COLS = "id, pizzeria_id, provider, external_id, status, amount_cents, qr_code, qr_image, expires_at, order_token, order_id";

/**
 * Cria (ou devolve) a cobrança Pix de um pedido já calculado. O pedido fica guardado e só é criado
 * quando o pagamento for confirmado. Mesmo pedido enviado de novo (clique duplo, internet caiu) = mesma cobrança.
 */
export async function startPix(payload: OrderPayload, opts: { storeName: string; customerName: string; origin: string }): Promise<{ ok: true; pix: PixView } | { ok: false; error: string }> {
  const admin = adminClient();
  const acc = await getAccount(payload.pizzeria_id);
  if (!acc || acc.status !== "ativa") return { ok: false, error: "Esta loja não está recebendo Pix pelo site agora. Escolha outra forma de pagamento." };
  const provider = PROVIDERS[acc.provider];
  if (!provider?.configured()) return { ok: false, error: "Pix pelo site indisponível no momento. Escolha outra forma de pagamento." };

  const { data: prev } = await admin.from("online_charges").select(COLS).eq("pizzeria_id", payload.pizzeria_id).eq("idempotency_key", payload.idempotency_key).maybeSingle();
  if (prev) {
    if (prev.status === "pago" || (prev.status === "pendente" && prev.qr_code && new Date(prev.expires_at as string) > new Date())) return { ok: true, pix: view(prev) };
    return { ok: false, error: "Este Pix expirou. Toque em fazer pedido de novo para gerar outro." };
  }

  const expires = new Date(Date.now() + PIX_MINUTES * 60_000);
  const { data: row, error } = await admin
    .from("online_charges")
    .insert({ pizzeria_id: payload.pizzeria_id, idempotency_key: payload.idempotency_key, provider: acc.provider, amount_cents: payload.total_cents, order_payload: payload, expires_at: expires.toISOString() })
    .select(COLS)
    .single();
  if (error || !row) return { ok: false, error: "Não foi possível gerar o Pix. Tente de novo." };

  try {
    const creds = acc.provider === "simulado" ? {} : await credentialsFor(acc);
    // Endereço público para o aviso do provedor (no computador de teste não existe: a tela consulta sozinha).
    const publicUrl = /localhost|127\.0\.0\.1/.test(opts.origin) ? null : `${opts.origin}/api/pagamentos/webhook/${acc.provider}?c=${row.id}`;
    const pix = await provider.createPix(creds, {
      charge_id: row.id as string,
      amount_cents: payload.total_cents,
      description: `Pedido ${opts.storeName}`,
      expires_at: expires,
      payer: { name: opts.customerName || "Cliente", email: `pix-${(row.id as string).slice(0, 8)}@${process.env.PIX_PAYER_EMAIL_DOMAIN ?? "pede-ai-e-va.vercel.app"}` },
      notification_url: publicUrl,
      platform_fee_cents: platformFee(payload.total_cents),
    });
    const { data: done } = await admin
      .from("online_charges")
      .update({ external_id: pix.external_id, qr_code: pix.qr_code, qr_image: pix.qr_image, expires_at: pix.expires_at.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .select(COLS)
      .single();
    return { ok: true, pix: view(done ?? row) };
  } catch (e) {
    await admin.from("online_charges").update({ status: "erro", error: String((e as Error).message).slice(0, 500) }).eq("id", row.id);
    return { ok: false, error: e instanceof PaymentError ? e.message : "Não foi possível gerar o Pix. Tente de novo ou escolha outra forma de pagamento." };
  }
}

/**
 * Confere a cobrança no provedor (nunca confia só no aviso) e, se pagou, cria o pedido.
 * Chamada pelo aviso do provedor e pela tela do cliente enquanto espera.
 */
export async function syncCharge(chargeId: string): Promise<PixView | null> {
  const admin = adminClient();
  const { data: c } = await admin.from("online_charges").select(COLS).eq("id", chargeId).maybeSingle();
  if (!c) return null;
  if (!["pendente", "expirado"].includes(c.status as string) || !c.external_id) return view(c);
  const acc = await getAccount(c.pizzeria_id as string);
  const provider = PROVIDERS[c.provider as ProviderId];
  if (!acc || !provider) return view(c);
  try {
    const creds = c.provider === "simulado" ? {} : await credentialsFor(acc);
    const st = await provider.getCharge(creds, c.external_id as string);
    if (st.reference && st.reference !== c.id) throw new PaymentError("Cobrança não confere");
    if (st.status === "pago") {
      const { data: r, error } = await admin.rpc("settle_online_charge", { _charge: c.id, _paid_cents: st.paid_cents ?? 0 });
      const res = r as { order_id: string | null; token?: string; error?: string } | null;
      if (error || !res?.order_id) {
        // Pagou mas o pedido não pôde ser criado: devolve o dinheiro na hora.
        console.error("Pix pago sem pedido", c.id, error?.message ?? res?.error);
        await provider.refund(creds, c.external_id as string, `estorno-${c.id}`).catch((e) => console.error("estorno automático falhou", c.id, e));
        await admin.from("online_charges").update({ status: "estornado", refunded_at: new Date().toISOString() }).eq("id", c.id);
      }
    } else if (st.status !== "pendente") {
      await admin.from("online_charges").update({ status: st.status, updated_at: new Date().toISOString() }).eq("id", c.id).in("status", ["pendente", "expirado"]);
    } else if (new Date(c.expires_at as string).getTime() < Date.now() - 2 * 60_000) {
      await admin.from("online_charges").update({ status: "expirado", updated_at: new Date().toISOString() }).eq("id", c.id).eq("status", "pendente");
    }
  } catch (e) {
    console.error("conferir Pix falhou", c.id, (e as Error).message);
  }
  const { data: after } = await admin.from("online_charges").select(COLS).eq("id", chargeId).single();
  return view(after ?? c);
}

/** Devolve ao cliente o Pix online de um pedido (depois que a loja registrou o estorno). */
export async function refundOnline(orderId: string): Promise<{ ok: true; online: boolean } | { ok: false; error: string }> {
  const admin = adminClient();
  const { data: c } = await admin.from("online_charges").select(COLS).eq("order_id", orderId).eq("status", "pago").maybeSingle();
  if (!c) return { ok: true, online: false };
  const acc = await getAccount(c.pizzeria_id as string);
  const provider = PROVIDERS[c.provider as ProviderId];
  try {
    if (!acc || !provider) throw new PaymentError("Conta de pagamento desconectada.");
    const creds = c.provider === "simulado" ? {} : await credentialsFor(acc);
    await provider.refund(creds, c.external_id as string, `estorno-${c.id}`);
    await admin.from("online_charges").update({ status: "estornado", refunded_at: new Date().toISOString() }).eq("id", c.id);
    return { ok: true, online: true };
  } catch (e) {
    await admin.from("online_charges").update({ error: `Estorno no provedor falhou: ${(e as Error).message}`.slice(0, 500) }).eq("id", c.id);
    return { ok: false, error: e instanceof PaymentError ? e.message : "O provedor recusou o estorno." };
  }
}

export { simulatorEnabled };

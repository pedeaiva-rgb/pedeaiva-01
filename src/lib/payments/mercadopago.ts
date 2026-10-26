import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentError, type ChargeState, type Credentials, type PaymentProvider } from "./types";

/**
 * Mercado Pago com a conta da própria pizzaria (OAuth): a loja autoriza a plataforma e o Pix
 * é criado com o token dela, então o dinheiro cai direto na conta da loja.
 * Chaves do aplicativo da plataforma: MP_CLIENT_ID, MP_CLIENT_SECRET e (opcional) MP_WEBHOOK_SECRET.
 */
const API = "https://api.mercadopago.com";

async function mp<T>(path: string, init: { method?: string; token?: string; body?: unknown; idempotency?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.idempotency ? { "X-Idempotency-Key": init.idempotency } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T & { message?: string }) : ({} as T & { message?: string });
  if (!res.ok) {
    console.error("Mercado Pago recusou", path, res.status, json.message);
    throw new PaymentError(res.status === 401 ? "A conexão com o Mercado Pago expirou. Conecte a conta de novo." : "O Mercado Pago recusou a operação.");
  }
  return json;
}

type MpPayment = {
  id: number;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  transaction_details?: { total_paid_amount?: number };
  date_of_expiration?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
};

/** Mercado Pago → situação da nossa cobrança. */
export function mapStatus(p: Pick<MpPayment, "status" | "status_detail">): ChargeState["status"] {
  switch (p.status) {
    case "approved":
      return "pago";
    case "refunded":
    case "charged_back":
      return "estornado";
    case "cancelled":
    case "rejected":
      return p.status_detail === "expired" ? "expirado" : "cancelado";
    default:
      return "pendente";
  }
}

/** Horário no formato que o Mercado Pago aceita: 2026-10-26T12:00:00.000-03:00. */
export function mpDate(d: Date) {
  const sp = new Date(d.getTime() - 3 * 3600_000);
  return `${sp.toISOString().slice(0, 23)}-03:00`;
}

/**
 * Confere a assinatura do aviso (x-signature: "ts=...,v1=..."), quando há segredo configurado.
 * Modelo do Mercado Pago: HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
 */
export function validSignature(signature: string | null, requestId: string | null, dataId: string | null, secret: string | undefined): boolean {
  if (!secret) return true;
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const want = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const got = Buffer.from(parts.v1);
  return want.length === got.length && timingSafeEqual(want, got);
}

const token = (c: Credentials) => {
  if (!c.access_token) throw new PaymentError("Conta do Mercado Pago não conectada.");
  return c.access_token;
};

export const mercadoPago: PaymentProvider = {
  id: "mercadopago",
  label: "Mercado Pago",
  // Subconta não existe no Mercado Pago: a loja sempre usa a conta dela.
  modes: ["conta_propria"],
  configured: () => !!process.env.MP_CLIENT_ID && !!process.env.MP_CLIENT_SECRET,

  authorizeUrl(state, redirectUri) {
    const u = new URL("https://auth.mercadopago.com/authorization");
    u.searchParams.set("client_id", process.env.MP_CLIENT_ID!);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("platform_id", "mp");
    u.searchParams.set("state", state);
    u.searchParams.set("redirect_uri", redirectUri);
    return u.toString();
  },

  async connect(code, redirectUri) {
    const t = await mp<{ access_token: string; refresh_token: string; expires_in: number; user_id: number }>("/oauth/token", {
      method: "POST",
      body: { client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri },
    });
    const me = await mp<{ nickname?: string; email?: string }>("/users/me", { token: t.access_token }).catch(() => ({}) as { nickname?: string; email?: string });
    return {
      credentials: { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() },
      external_account_id: String(t.user_id),
      account_label: me.email ?? me.nickname ?? `Conta ${t.user_id}`,
    };
  },

  async refresh(c) {
    // O token dura 180 dias: renova quando faltar menos de 15.
    if (!c.refresh_token || !c.expires_at || new Date(c.expires_at).getTime() - Date.now() > 15 * 86400_000) return null;
    const t = await mp<{ access_token: string; refresh_token: string; expires_in: number }>("/oauth/token", {
      method: "POST",
      body: { client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: c.refresh_token },
    });
    return { ...c, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  },

  async createPix(c, req) {
    const p = await mp<MpPayment>("/v1/payments", {
      method: "POST",
      token: token(c),
      idempotency: req.charge_id,
      body: {
        transaction_amount: req.amount_cents / 100,
        description: req.description.slice(0, 250),
        payment_method_id: "pix",
        external_reference: req.charge_id,
        date_of_expiration: mpDate(req.expires_at),
        payer: { email: req.payer.email, first_name: req.payer.name.slice(0, 60) },
        ...(req.notification_url ? { notification_url: req.notification_url } : {}),
        ...(req.platform_fee_cents > 0 ? { application_fee: req.platform_fee_cents / 100 } : {}),
      },
    });
    const qr = p.point_of_interaction?.transaction_data;
    if (!qr?.qr_code) throw new PaymentError("O Mercado Pago não devolveu o código do Pix.");
    return {
      external_id: String(p.id),
      qr_code: qr.qr_code,
      qr_image: qr.qr_code_base64 ? `data:image/png;base64,${qr.qr_code_base64}` : null,
      expires_at: p.date_of_expiration ? new Date(p.date_of_expiration) : req.expires_at,
    };
  },

  async getCharge(c, externalId) {
    const p = await mp<MpPayment>(`/v1/payments/${encodeURIComponent(externalId)}`, { token: token(c) });
    const paid = p.transaction_details?.total_paid_amount ?? p.transaction_amount ?? null;
    return { status: mapStatus(p), paid_cents: paid != null ? Math.round(paid * 100) : null, reference: p.external_reference ?? null };
  },

  async refund(c, externalId, idempotencyKey) {
    await mp(`/v1/payments/${encodeURIComponent(externalId)}/refunds`, { method: "POST", token: token(c), idempotency: idempotencyKey, body: {} });
  },

  parseWebhook(req, body) {
    const url = new URL(req.url);
    let json: { type?: string; topic?: string; data?: { id?: string | number } } = {};
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      // aviso no formato antigo (só na URL)
    }
    const dataId = url.searchParams.get("data.id") ?? (json.data?.id != null ? String(json.data.id) : null) ?? url.searchParams.get("id");
    const kind = json.type ?? json.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
    const valid = validSignature(req.headers.get("x-signature"), req.headers.get("x-request-id"), url.searchParams.get("data.id") ?? dataId, process.env.MP_WEBHOOK_SECRET);
    return { external_id: kind && kind !== "payment" ? null : dataId, charge_id: url.searchParams.get("c"), valid };
  },
};

import "server-only";
import { z } from "zod";
import { storeStatus } from "./hours";
import { loadMenu } from "./menu";
import { brl } from "./money";
import { firstIssue, quoteSchema, type QuoteInput } from "./order-schema";
import { normalizeBrPhone } from "./phone";
import { applyCoupon, normalizeCouponCode, priceLine, PricingError, quoteDelivery, type DeliveryQuote, type PricedLine } from "./pricing";
import { rememberPoint } from "./address-points";
import { distanceKm } from "./geo";
import { adminClient } from "./supabase/admin";
import type { Address, Channel, Coupon, Fulfillment, Menu, PaymentMethod } from "./types";

export type Quote = {
  lines: PricedLine[];
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  delivery: DeliveryQuote;
  coupon: { id: string; code: string } | null;
  coupon_error: string | null;
  min_order_error: string | null;
  blocked: string | null;
};

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: string };

/** Preço do pedido calculado no servidor, a partir do cardápio atual do banco. */
export async function computeQuote(menu: Menu, input: z.output<typeof quoteSchema>, channel: Channel): Promise<Quote> {
  const pz = menu.pizzeria;
  const lines = input.items.map((l) => priceLine(l, menu, pz.half_pricing));
  const subtotal = lines.reduce((a, l) => a + l.subtotal_cents, 0);

  let coupon: Quote["coupon"] = null;
  let discount = 0;
  let couponError: string | null = null;
  const code = normalizeCouponCode(input.coupon);
  if (code) {
    // Busca exata pelo código: nada de curinga.
    const { data } = await adminClient().from("coupons").select("*").eq("pizzeria_id", pz.id).eq("code", code).maybeSingle();
    const r = applyCoupon(data as Coupon | null, subtotal);
    if (r.ok) {
      discount = r.discount_cents;
      coupon = { id: (data as Coupon).id, code };
    } else couponError = r.reason;
  }

  let delivery: DeliveryQuote;
  if (input.fulfillment === "entrega") delivery = quoteDelivery(pz, menu.zones, input.neighborhood);
  else if (!pz.allow_pickup && channel === "site") delivery = { ok: false, reason: "Esta loja não aceita retirada no momento." };
  else delivery = { ok: true, fee_cents: 0, zone_name: null, eta_min: pz.prep_minutes, eta_max: pz.prep_minutes + 15 };

  const fee = delivery.ok ? delivery.fee_cents : 0;
  // Horário, pausa e pedido mínimo valem para a loja online; o balcão continua vendendo.
  const status = channel === "site" ? storeStatus(pz) : { open: true as const };
  return {
    lines,
    subtotal_cents: subtotal,
    discount_cents: discount,
    delivery_fee_cents: fee,
    total_cents: subtotal - discount + fee,
    delivery,
    coupon,
    coupon_error: couponError,
    min_order_error: channel === "site" && subtotal < pz.min_order_cents ? `Pedido mínimo de ${brl(pz.min_order_cents)}` : null,
    blocked: status.open ? null : status.message,
  };
}

export async function quoteFor(by: { slug: string } | { id: string }, raw: QuoteInput, channel: Channel): Promise<QuoteResult> {
  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const menu = await loadMenu(adminClient(), by);
    if (!menu) return { ok: false, error: "Loja não encontrada" };
    return { ok: true, quote: await computeQuote(menu, parsed.data, channel) };
  } catch (e) {
    return { ok: false, error: e instanceof PricingError ? e.message : "Não foi possível calcular o pedido. Tente novamente." };
  }
}

export type SubmitInput = z.output<typeof quoteSchema> & {
  idempotency_key: string;
  customer_name: string;
  customer_phone: string;
  address: Address | null;
  payment_method: PaymentMethod;
  change_for_cents: number | null;
  notes: string;
  location?: { lat: number; lng: number; accuracy?: number } | null;
};

export type SubmitResult = { ok: true; id: string; token: string; number: number; total_cents: number } | { ok: false; error: string };

/** Mesmo caminho para a loja online e para o PDV: preço do servidor, gravação atômica e sem duplicar. */
export async function submitOrder(menu: Menu, data: SubmitInput, channel: Channel, actorId: string | null): Promise<SubmitResult> {
  let q: Quote;
  try {
    q = await computeQuote(menu, data, channel);
  } catch (e) {
    return { ok: false, error: e instanceof PricingError ? e.message : "Não foi possível calcular o pedido." };
  }
  if (q.blocked) return { ok: false, error: q.blocked };
  if (q.min_order_error) return { ok: false, error: q.min_order_error };
  if (!q.delivery.ok) return { ok: false, error: q.delivery.reason };
  if (q.coupon_error) return { ok: false, error: q.coupon_error };

  const fulfillment: Fulfillment = data.fulfillment;
  if (fulfillment === "entrega") {
    const a = data.address;
    if (!a || !a.street || !a.number || !a.neighborhood) return { ok: false, error: "Informe rua, número e bairro para a entrega" };
    if (!data.customer_name || !normalizeBrPhone(data.customer_phone)) return { ok: false, error: "Para entrega, informe nome e telefone" };
  }
  if (data.payment_method === "dinheiro" && data.change_for_cents != null && data.change_for_cents > 0 && data.change_for_cents < q.total_cents) {
    return { ok: false, error: `O troco precisa ser para um valor igual ou maior que ${brl(q.total_cents)}` };
  }

  const payload = {
    pizzeria_id: menu.pizzeria.id,
    idempotency_key: data.idempotency_key,
    channel,
    fulfillment,
    customer_name: data.customer_name || "Cliente balcão",
    customer_phone: data.customer_phone,
    address: fulfillment === "entrega" ? data.address : null,
    zone_name: q.delivery.ok ? q.delivery.zone_name : null,
    subtotal_cents: q.subtotal_cents,
    discount_cents: q.discount_cents,
    delivery_fee_cents: q.delivery_fee_cents,
    total_cents: q.total_cents,
    coupon_id: q.coupon?.id ?? "",
    coupon_code: q.coupon?.code ?? "",
    payment_method: data.payment_method,
    change_for_cents: data.payment_method === "dinheiro" && data.change_for_cents ? data.change_for_cents : "",
    notes: data.notes,
    eta_min: q.delivery.ok ? (q.delivery.eta_min ?? "") : "",
    eta_max: q.delivery.ok ? (q.delivery.eta_max ?? "") : "",
    created_by: actorId ?? "",
    items: q.lines,
  };
  const { data: rows, error } = await adminClient().rpc("create_order", { p: payload });
  const row = (rows as { order_id: string; public_token: string; number: number }[] | null)?.[0];
  if (error || !row) {
    const msg = error?.message ?? "";
    console.error("create_order falhou", error?.code, msg);
    const known = /Cupom|Telefone|telefone|Muitos pedidos/.test(msg);
    return { ok: false, error: known ? msg : "Não foi possível registrar o pedido. Tente novamente." };
  }
  if (fulfillment === "entrega" && data.location && data.address) await saveCustomerPoint(menu, row.order_id, data.address, data.location);
  return { ok: true, id: row.order_id, token: row.public_token, number: row.number, total_cents: q.total_cents };
}

/**
 * Localização que o cliente marcou no celular vira o ponto da entrega (e fica guardada para o endereço).
 * Ignora GPS impreciso ou longe da loja (ex.: cliente pedindo do trabalho para entregar em casa).
 */
async function saveCustomerPoint(menu: Menu, orderId: string, address: Address, loc: { lat: number; lng: number; accuracy?: number }) {
  try {
    if (loc.accuracy != null && loc.accuracy > 150) return;
    const z = menu.pizzeria;
    if (z.lat != null && z.lng != null && distanceKm({ lat: z.lat, lng: z.lng }, loc) > 30) return;
    await adminClient().from("orders").update({ dest_lat: loc.lat, dest_lng: loc.lng, geo_status: "ok" }).eq("id", orderId);
    await rememberPoint(z.id, address, loc, "cliente");
  } catch (e) {
    // O ponto no mapa é um extra: o pedido já foi feito.
    console.error("ponto do cliente não salvo", e);
  }
}

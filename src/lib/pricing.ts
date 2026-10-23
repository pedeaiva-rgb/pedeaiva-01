/**
 * Motor de preços puro, usado na prévia do navegador e no servidor.
 * Só o resultado do SERVIDOR é gravado; o do navegador é apenas prévia. Dinheiro em centavos inteiros.
 */
import type { Coupon, DeliveryZone, Extra, HalfPricing, Menu, Pizzeria, Product, ProductPrice, Size } from "./types";

export class PricingError extends Error {}

export type CartLine = {
  product_id: string;
  size_id?: string | null;
  flavor_ids?: string[];
  extra_ids?: string[];
  qty: number;
  note?: string | null;
};

export type PricedLine = {
  product_id: string;
  size_id: string | null;
  name: string;
  size_name: string | null;
  flavors: { product_id: string; name: string; fraction: number }[];
  extras: { id: string; name: string; price_cents: number }[];
  qty: number;
  unit_price_cents: number;
  subtotal_cents: number;
  note: string | null;
};

type PricingMenu = Pick<Menu, "products" | "sizes" | "prices" | "extras">;

/** Preço da base da pizza conforme a regra de meio a meio da loja. */
export function pizzaBasePrice(flavorPrices: number[], rule: HalfPricing): number {
  if (flavorPrices.length === 0) throw new PricingError("Escolha ao menos um sabor");
  if (rule === "media") return Math.round(flavorPrices.reduce((a, p) => a + p, 0) / flavorPrices.length);
  return Math.max(...flavorPrices);
}

export const sellable = (p: Product) => p.available && !p.archived;

export function priceLine(line: CartLine, menu: PricingMenu, rule: HalfPricing): PricedLine {
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 50) throw new PricingError("Quantidade inválida");
  const product = menu.products.find((p) => p.id === line.product_id);
  if (!product || !sellable(product)) throw new PricingError("Produto indisponível");

  const extraIds = line.extra_ids ?? [];
  if (new Set(extraIds).size !== extraIds.length) throw new PricingError("Adicional repetido");
  const extras = extraIds.map((id) => {
    const e = menu.extras.find((x: Extra) => x.id === id);
    if (!e || !e.available) throw new PricingError("Adicional indisponível");
    if (e.pizza_only && !product.is_pizza) throw new PricingError("Adicional não permitido para este produto");
    return { id: e.id, name: e.name, price_cents: e.price_cents };
  });
  const extrasTotal = extras.reduce((a, e) => a + e.price_cents, 0);
  const note = line.note?.trim() ? line.note.trim().slice(0, 200) : null;

  if (!product.is_pizza) {
    const unit = product.price_cents + extrasTotal;
    return {
      product_id: product.id,
      size_id: null,
      name: product.name,
      size_name: null,
      flavors: [],
      extras,
      qty: line.qty,
      unit_price_cents: unit,
      subtotal_cents: unit * line.qty,
      note,
    };
  }

  const size = menu.sizes.find((s: Size) => s.id === line.size_id);
  if (!size || !size.active) throw new PricingError("Escolha um tamanho válido");
  const flavorIds = line.flavor_ids?.length ? line.flavor_ids : [product.id];
  if (new Set(flavorIds).size !== flavorIds.length) throw new PricingError("Sabor repetido");
  if (flavorIds.length > size.max_flavors) throw new PricingError(`A ${size.name} permite até ${size.max_flavors} sabor(es)`);
  const fraction = 1 / flavorIds.length;
  const priced = flavorIds.map((fid) => {
    const fp = menu.products.find((p) => p.id === fid);
    const price = menu.prices.find((x: ProductPrice) => x.product_id === fid && x.size_id === size.id);
    if (!fp || !fp.is_pizza || !sellable(fp) || !price) throw new PricingError("Sabor indisponível neste tamanho");
    return { product_id: fp.id, name: fp.name, fraction, price: price.price_cents };
  });
  const unit = pizzaBasePrice(
    priced.map((f) => f.price),
    rule,
  ) + extrasTotal;
  return {
    product_id: product.id,
    size_id: size.id,
    name: priced.length > 1 ? `Pizza ${priced.map((f) => f.name).join(" / ")}` : product.name,
    size_name: size.name,
    flavors: priced.map(({ product_id, name, fraction }) => ({ product_id, name, fraction })),
    extras,
    qty: line.qty,
    unit_price_cents: unit,
    subtotal_cents: unit * line.qty,
    note,
  };
}

/** Menor preço para mostrar "a partir de" no cartão do produto. */
export function startingPrice(p: Product, prices: ProductPrice[]): number | null {
  if (!p.is_pizza) return p.price_cents;
  const list = prices.filter((x) => x.product_id === p.id).map((x) => x.price_cents);
  return list.length ? Math.min(...list) : null;
}

// ---------- Entrega ----------
export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type DeliveryQuote = { ok: true; fee_cents: number; zone_name: string | null; eta_min: number | null; eta_max: number | null } | { ok: false; reason: string };

export function quoteDelivery(
  pz: Pick<Pizzeria, "allow_delivery" | "delivery_mode" | "delivery_fee_cents" | "delivery_eta_min" | "delivery_eta_max">,
  zones: DeliveryZone[],
  neighborhood: string,
): DeliveryQuote {
  if (!pz.allow_delivery) return { ok: false, reason: "Esta loja não faz entregas no momento. Escolha retirada." };
  if (pz.delivery_mode === "fixa") {
    return { ok: true, fee_cents: pz.delivery_fee_cents, zone_name: null, eta_min: pz.delivery_eta_min, eta_max: pz.delivery_eta_max };
  }
  const n = normalizeText(neighborhood);
  if (!n) return { ok: false, reason: "Informe o bairro para calcular a entrega." };
  const zone = zones.find((z) => z.active && z.neighborhoods.some((b) => normalizeText(b) === n));
  if (!zone) return { ok: false, reason: "Ainda não entregamos nesse bairro. Confira a grafia ou escolha retirada." };
  return { ok: true, fee_cents: zone.fee_cents, zone_name: zone.name, eta_min: zone.eta_min, eta_max: zone.eta_max };
}

// ---------- Cupom ----------
/** Código como o banco guarda: maiúsculas, sem espaços. A busca é sempre exata (nada de curinga). */
export const normalizeCouponCode = (code: string) => code.trim().toUpperCase();

export function applyCoupon(c: Coupon | null | undefined, subtotal: number, now = new Date()): { ok: true; discount_cents: number } | { ok: false; reason: string } {
  if (!c || !c.active) return { ok: false, reason: "Cupom inválido" };
  if (c.starts_at && new Date(c.starts_at) > now) return { ok: false, reason: "Este cupom ainda não começou a valer" };
  if (c.ends_at && new Date(c.ends_at) < now) return { ok: false, reason: "Cupom expirado" };
  if (c.max_uses != null && c.uses >= c.max_uses) return { ok: false, reason: "Cupom esgotado" };
  if (subtotal < c.min_order_cents) return { ok: false, reason: "Pedido abaixo do mínimo para este cupom" };
  const raw = c.discount_type === "percentual" ? Math.round((subtotal * Number(c.value)) / 100) : Math.round(Number(c.value) * 100);
  return { ok: true, discount_cents: Math.min(raw, subtotal) };
}

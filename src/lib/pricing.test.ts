import { describe, expect, it } from "vitest";
import { applyCoupon, normalizeCouponCode, priceLine, PricingError, quoteDelivery, startingPrice } from "./pricing";
import type { Coupon, DeliveryZone, Extra, Product, ProductPrice, Size } from "./types";

const pz = "pz";
const prod = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  pizzeria_id: pz,
  category_id: "c",
  name: id,
  description: "",
  image_url: null,
  is_pizza: true,
  price_cents: 0,
  available: true,
  featured: false,
  archived: false,
  sort: 0,
  ...over,
});
const sizes: Size[] = [
  { id: "M", pizzeria_id: pz, name: "Média", description: "", max_flavors: 2, sort: 1, active: true },
  { id: "B", pizzeria_id: pz, name: "Broto", description: "", max_flavors: 1, sort: 0, active: true },
];
const products = [prod("Calabresa"), prod("Portuguesa"), prod("Refri", { is_pizza: false, price_cents: 1200 }), prod("Antiga", { archived: true })];
const prices: ProductPrice[] = [
  { pizzeria_id: pz, product_id: "Calabresa", size_id: "M", price_cents: 4000 },
  { pizzeria_id: pz, product_id: "Portuguesa", size_id: "M", price_cents: 5000 },
  { pizzeria_id: pz, product_id: "Calabresa", size_id: "B", price_cents: 2500 },
  { pizzeria_id: pz, product_id: "Antiga", size_id: "M", price_cents: 100 },
];
const extras: Extra[] = [
  { id: "borda", pizzeria_id: pz, name: "Borda", price_cents: 800, pizza_only: true, available: true, sort: 0 },
  { id: "gelo", pizzeria_id: pz, name: "Gelo", price_cents: 100, pizza_only: false, available: true, sort: 1 },
];
const menu = { products, sizes, prices, extras };

describe("priceLine", () => {
  it("pizza de um sabor com adicional", () => {
    const l = priceLine({ product_id: "Calabresa", size_id: "M", extra_ids: ["borda"], qty: 2 }, menu, "mais_caro");
    expect(l).toMatchObject({ name: "Calabresa", size_name: "Média", unit_price_cents: 4800, subtotal_cents: 9600 });
  });
  it("meio a meio pelo sabor mais caro ou pela média", () => {
    const line = { product_id: "Calabresa", size_id: "M", flavor_ids: ["Calabresa", "Portuguesa"], qty: 1 };
    expect(priceLine(line, menu, "mais_caro").unit_price_cents).toBe(5000);
    expect(priceLine(line, menu, "media").unit_price_cents).toBe(4500);
    expect(priceLine(line, menu, "media").flavors.map((f) => f.fraction)).toEqual([0.5, 0.5]);
  });
  it("respeita o limite de sabores do tamanho", () => {
    expect(() => priceLine({ product_id: "Calabresa", size_id: "B", flavor_ids: ["Calabresa", "Portuguesa"], qty: 1 }, menu, "mais_caro")).toThrow(/até 1/);
  });
  it("recusa sabor sem preço no tamanho, produto arquivado e quantidade inválida", () => {
    expect(() => priceLine({ product_id: "Portuguesa", size_id: "B", qty: 1 }, menu, "mais_caro")).toThrow(PricingError);
    expect(() => priceLine({ product_id: "Antiga", size_id: "M", qty: 1 }, menu, "mais_caro")).toThrow(/indisponível/);
    expect(() => priceLine({ product_id: "Calabresa", size_id: "M", qty: 0 }, menu, "mais_caro")).toThrow(/Quantidade/);
  });
  it("produto simples não aceita adicional só de pizza", () => {
    expect(priceLine({ product_id: "Refri", extra_ids: ["gelo"], qty: 3 }, menu, "mais_caro").subtotal_cents).toBe(3900);
    expect(() => priceLine({ product_id: "Refri", extra_ids: ["borda"], qty: 1 }, menu, "mais_caro")).toThrow(/não permitido/);
  });
  it("preço inicial do cartão", () => {
    expect(startingPrice(products[0]!, prices)).toBe(2500);
    expect(startingPrice(products[2]!, prices)).toBe(1200);
  });
});

describe("entrega", () => {
  const base = { allow_delivery: true, delivery_fee_cents: 700, delivery_eta_min: 30, delivery_eta_max: 50 };
  const zones: DeliveryZone[] = [
    { id: "z", pizzeria_id: pz, name: "Centro", neighborhoods: ["Barra", "Rio Vermelho"], fee_cents: 500, eta_min: 20, eta_max: 40, active: true },
  ];
  it("taxa fixa", () => {
    expect(quoteDelivery({ ...base, delivery_mode: "fixa" }, [], "")).toMatchObject({ ok: true, fee_cents: 700 });
  });
  it("por bairro ignora acento e maiúsculas", () => {
    expect(quoteDelivery({ ...base, delivery_mode: "bairro" }, zones, "  rio  vermelho ")).toMatchObject({ ok: true, fee_cents: 500, zone_name: "Centro" });
    expect(quoteDelivery({ ...base, delivery_mode: "bairro" }, zones, "Pituba")).toMatchObject({ ok: false });
  });
  it("loja sem entrega", () => {
    expect(quoteDelivery({ ...base, allow_delivery: false, delivery_mode: "fixa" }, [], "")).toMatchObject({ ok: false });
  });
});

describe("cupom", () => {
  const c: Coupon = {
    id: "x",
    pizzeria_id: pz,
    code: "BEMVINDO",
    discount_type: "percentual",
    value: 10,
    min_order_cents: 3000,
    starts_at: null,
    ends_at: null,
    max_uses: 2,
    uses: 0,
    active: true,
    show_in_store: false,
    description: "",
  };
  it("percentual e valor fixo, nunca maior que o subtotal", () => {
    expect(applyCoupon(c, 5000)).toEqual({ ok: true, discount_cents: 500 });
    expect(applyCoupon({ ...c, discount_type: "valor", value: 80, min_order_cents: 0 }, 5000)).toEqual({ ok: true, discount_cents: 5000 });
  });
  it("mínimo, esgotado, expirado e pausado", () => {
    expect(applyCoupon(c, 2000)).toMatchObject({ ok: false });
    expect(applyCoupon({ ...c, uses: 2 }, 5000)).toMatchObject({ ok: false, reason: "Cupom esgotado" });
    expect(applyCoupon({ ...c, ends_at: "2020-01-01T00:00:00Z" }, 5000)).toMatchObject({ ok: false, reason: "Cupom expirado" });
    expect(applyCoupon({ ...c, active: false }, 5000)).toMatchObject({ ok: false });
  });
  it("código é normalizado, e curinga continua sendo só texto", () => {
    expect(normalizeCouponCode("  bemvindo ")).toBe("BEMVINDO");
    expect(normalizeCouponCode("%")).toBe("%");
  });
});
